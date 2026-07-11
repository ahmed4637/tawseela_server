const mongoose = require('mongoose');

const ChatRoom = require('../models/chatRoom.model');
const ChatMessage = require('../models/chatMessage.model');
const ServiceRequest = require('../models/serviceRequest.model');

const accountPublicFields = 'name phone profileImage image photo avatar';

const isValidObjectId = (value) => {
  return mongoose.Types.ObjectId.isValid(value?.toString() || '');
};

const ensureValidObjectId = (value, message = 'رقم غير صحيح') => {
  if (!isValidObjectId(value)) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  }
};

const toPlainObject = (doc) => {
  if (!doc) return null;

  return doc.toObject && typeof doc.toObject === 'function'
    ? doc.toObject()
    : { ...doc };
};

const normalizeMessageType = (messageType) => {
  if (['text', 'image', 'location'].includes(messageType)) {
    return messageType;
  }

  return 'text';
};

const populateRoom = (query) => {
  return query
    .populate('customerAccountId', accountPublicFields)
    .populate('driverAccountId', accountPublicFields)
    .populate('acceptedOfferId')
    .populate('serviceRequestId');
};

const populateMessage = (query) => {
  return query
    .populate('senderAccountId', accountPublicFields)
    .populate('receiverAccountId', accountPublicFields);
};

const isRoomParticipant = ({ room, accountId }) => {
  const currentAccountId = accountId?.toString();

  return (
    room.customerAccountId?.toString() === currentAccountId ||
    room.driverAccountId?.toString() === currentAccountId
  );
};

const createChatRoomForAcceptedRequest = async ({ request, offer }) => {
  if (!request?._id || !offer?._id) {
    return null;
  }

  const customerAccountId = request.customerAccountId;
  const driverAccountId = offer.driverAccountId || request.acceptedDriverAccountId;

  if (!customerAccountId || !driverAccountId) {
    return null;
  }

  const existingRoom = await ChatRoom.findOne({
    serviceRequestId: request._id,
  });

  if (existingRoom) {
    existingRoom.acceptedOfferId = offer._id;
    existingRoom.customerAccountId = customerAccountId;
    existingRoom.driverAccountId = driverAccountId;
    existingRoom.status = 'active';
    existingRoom.closedAt = null;
    await existingRoom.save();
    return existingRoom;
  }

  return ChatRoom.create({
    serviceRequestId: request._id,
    acceptedOfferId: offer._id,
    customerAccountId,
    driverAccountId,
    status: 'active',
  });
};

const getRoomForRequest = async ({ serviceRequestId, accountId, roles = [] }) => {
  ensureValidObjectId(serviceRequestId, 'رقم الطلب غير صحيح');

  let room = await ChatRoom.findOne({ serviceRequestId });

  if (!room) {
    const request = await ServiceRequest.findById(serviceRequestId).select(
      'customerAccountId acceptedDriverAccountId acceptedOfferId status'
    );

    if (!request) {
      const error = new Error('الطلب غير موجود');
      error.statusCode = 404;
      throw error;
    }

    const isParticipant =
      request.customerAccountId?.toString() === accountId?.toString() ||
      request.acceptedDriverAccountId?.toString() === accountId?.toString();

    if (!roles.includes('admin') && !isParticipant) {
      const error = new Error('غير مسموح لك بعرض شات هذا الطلب');
      error.statusCode = 403;
      throw error;
    }

    const canCreateRoom =
      !!request.acceptedOfferId &&
      !!request.acceptedDriverAccountId &&
      [
        'offer_accepted',
        'driver_arriving',
        'arrived_to_pickup',
        'in_progress',
        'completed',
      ].includes(request.status);

    if (!canCreateRoom) {
      const error = new Error('الشات يفتح بعد قبول العرض فقط');
      error.statusCode = 404;
      throw error;
    }

    room = await createChatRoomForAcceptedRequest({
      request,
      offer: {
        _id: request.acceptedOfferId,
        driverAccountId: request.acceptedDriverAccountId,
      },
    });
  }

  if (!roles.includes('admin') && !isRoomParticipant({ room, accountId })) {
    const error = new Error('غير مسموح لك بعرض شات هذا الطلب');
    error.statusCode = 403;
    throw error;
  }

  return populateRoom(ChatRoom.findById(room._id));
};

const ensureChatRoomAccess = async ({ roomId, accountId, roles = [] }) => {
  ensureValidObjectId(roomId, 'رقم غرفة الشات غير صحيح');

  const room = await ChatRoom.findById(roomId);

  if (!room) {
    const error = new Error('غرفة الشات غير موجودة');
    error.statusCode = 404;
    throw error;
  }

  if (!roles.includes('admin') && !isRoomParticipant({ room, accountId })) {
    const error = new Error('غير مسموح لك باستخدام هذه المحادثة');
    error.statusCode = 403;
    throw error;
  }

  return room;
};

const getMessagesForRoom = async ({ roomId, accountId, roles = [], page = 1, limit = 50 }) => {
  const room = await ensureChatRoomAccess({ roomId, accountId, roles });

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const skip = (safePage - 1) * safeLimit;

  const [messages, total] = await Promise.all([
    populateMessage(
      ChatMessage.find({ roomId: room._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
    ),
    ChatMessage.countDocuments({ roomId: room._id }),
  ]);

  return {
    room,
    messages: messages.reverse(),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit),
    },
  };
};

const createChatMessage = async ({
  roomId,
  senderAccountId,
  messageType = 'text',
  text = '',
  mediaUrl = '',
  location = null,
  realtime = false,
}) => {
  const room = await ensureChatRoomAccess({
    roomId,
    accountId: senderAccountId,
    roles: [],
  });

  if (room.status !== 'active') {
    const error = new Error('لا يمكن إرسال رسالة في محادثة مغلقة');
    error.statusCode = 400;
    throw error;
  }

  const senderId = senderAccountId.toString();
  const customerId = room.customerAccountId.toString();
  const driverId = room.driverAccountId.toString();

  let receiverAccountId = null;

  if (senderId === customerId) {
    receiverAccountId = room.driverAccountId;
  }

  if (senderId === driverId) {
    receiverAccountId = room.customerAccountId;
  }

  if (!receiverAccountId) {
    const error = new Error('المرسل ليس طرفًا في هذه المحادثة');
    error.statusCode = 403;
    throw error;
  }

  const cleanMessageType = normalizeMessageType(messageType);
  const cleanText = (text || '').toString().trim();
  const cleanMediaUrl = (mediaUrl || '').toString().trim();
  const cleanLocation = location && typeof location === 'object' ? location : null;

  if (cleanMessageType === 'text' && !cleanText) {
    const error = new Error('نص الرسالة مطلوب');
    error.statusCode = 400;
    throw error;
  }

  if (cleanMessageType === 'image' && !cleanMediaUrl) {
    const error = new Error('رابط الصورة مطلوب');
    error.statusCode = 400;
    throw error;
  }

  if (cleanMessageType === 'location') {
    const lat = Number(cleanLocation?.lat ?? cleanLocation?.latitude);
    const lng = Number(cleanLocation?.lng ?? cleanLocation?.longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      const error = new Error('بيانات الموقع غير صحيحة');
      error.statusCode = 400;
      throw error;
    }
  }

  const message = await ChatMessage.create({
    roomId: room._id,
    serviceRequestId: room.serviceRequestId,
    senderAccountId,
    receiverAccountId,
    messageType: cleanMessageType,
    text: cleanText,
    mediaUrl: cleanMediaUrl,
    location:
      cleanMessageType === 'location'
        ? {
            lat: Number(cleanLocation.lat ?? cleanLocation.latitude),
            lng: Number(cleanLocation.lng ?? cleanLocation.longitude),
            address: cleanLocation.address || '',
          }
        : undefined,
  });

  room.lastMessageText =
    cleanMessageType === 'text'
      ? cleanText
      : cleanMessageType === 'image'
        ? 'صورة'
        : 'موقع';
  room.lastMessageAt = message.createdAt;

  if (realtime) {
    // The persisted message is already authoritative. Broadcast it immediately
    // and update the room preview in the background instead of making the
    // receiver wait for another save + populate query.
    setImmediate(() => {
      ChatRoom.updateOne(
        {
          _id: room._id,
          $or: [
            { lastMessageAt: null },
            { lastMessageAt: { $lte: message.createdAt } },
          ],
        },
        {
          $set: {
            lastMessageText: room.lastMessageText,
            lastMessageAt: message.createdAt,
          },
        },
      ).catch((error) => {
        console.error('Realtime chat room preview update error:', error.message);
      });
    });

    return {
      room,
      message: message.toObject({ depopulate: true }),
    };
  }

  await room.save();

  const populatedMessage = await populateMessage(
    ChatMessage.findById(message._id)
  );

  return {
    room,
    message: populatedMessage,
  };
};


const getUnreadCountForRoom = async ({ roomId, accountId, roles = [] }) => {
  const room = await ensureChatRoomAccess({ roomId, accountId, roles });

  if (roles.includes('admin')) {
    return {
      room,
      unreadCount: 0,
    };
  }

  const unreadCount = await ChatMessage.countDocuments({
    roomId: room._id,
    receiverAccountId: accountId,
    isRead: false,
  });

  return {
    room,
    unreadCount,
  };
};

const getUnreadCountForRequest = async ({ serviceRequestId, accountId, roles = [] }) => {
  const room = await getRoomForRequest({ serviceRequestId, accountId, roles });

  if (roles.includes('admin')) {
    return {
      room,
      unreadCount: 0,
    };
  }

  const unreadCount = await ChatMessage.countDocuments({
    roomId: room._id,
    receiverAccountId: accountId,
    isRead: false,
  });

  return {
    room,
    unreadCount,
  };
};

const markRoomMessagesAsRead = async ({ roomId, accountId, roles = [] }) => {
  const room = await ensureChatRoomAccess({ roomId, accountId, roles });

  if (roles.includes('admin')) {
    return {
      room,
      modifiedCount: 0,
    };
  }

  const result = await ChatMessage.updateMany(
    {
      roomId: room._id,
      receiverAccountId: accountId,
      isRead: false,
    },
    {
      isRead: true,
      readAt: new Date(),
    }
  );

  return {
    room,
    modifiedCount: result.modifiedCount || 0,
  };
};

module.exports = {
  createChatRoomForAcceptedRequest,
  getRoomForRequest,
  ensureChatRoomAccess,
  getMessagesForRoom,
  createChatMessage,
  getUnreadCountForRoom,
  getUnreadCountForRequest,
  markRoomMessagesAsRead,
  toPlainObject,
};
