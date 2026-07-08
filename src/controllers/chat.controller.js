const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const { emitToAccount, emitToRequest, emitToAdmins, getIO } = require('../sockets/socket.server');
const {
  getRoomForRequest,
  ensureChatRoomAccess,
  getMessagesForRoom,
  createChatMessage,
  getUnreadCountForRoom,
  getUnreadCountForRequest,
  markRoomMessagesAsRead,
} = require('../services/chat.service');
const { createNotification } = require('../services/notification.service');

const safeSocketEmit = (callback) => {
  try {
    callback();
  } catch (error) {
    console.error('Socket emit error:', error.message);
  }
};

const readObjectId = (value) => {
  return (value?._id || value || '').toString();
};

const safeCreateNotification = async ({
  accountId,
  title,
  body,
  type = 'chat',
  data = {},
}) => {
  try {
    await createNotification({
      accountId,
      title,
      body,
      type,
      data,
    });
  } catch (error) {
    console.error('Create chat notification error:', error.message);
  }
};

const getChatRoomByRequest = asyncHandler(async (req, res) => {
  const room = await getRoomForRequest({
    serviceRequestId: req.params.serviceRequestId,
    accountId: req.accountId,
    roles: req.roles || [],
  });

  return sendSuccess({
    res,
    message: 'تم جلب غرفة الشات بنجاح',
    doc: room,
  });
});

const getChatRoomById = asyncHandler(async (req, res) => {
  const room = await ensureChatRoomAccess({
    roomId: req.params.roomId,
    accountId: req.accountId,
    roles: req.roles || [],
  });

  return sendSuccess({
    res,
    message: 'تم جلب غرفة الشات بنجاح',
    doc: room,
  });
});

const getChatMessages = asyncHandler(async (req, res) => {
  const { room, messages, pagination } = await getMessagesForRoom({
    roomId: req.params.roomId,
    accountId: req.accountId,
    roles: req.roles || [],
    page: req.query.page,
    limit: req.query.limit,
  });

  return sendSuccess({
    res,
    message: 'تم جلب رسائل الشات بنجاح',
    docs: messages,
    extra: {
      room,
      pagination,
    },
  });
});


const getChatUnreadCountByRequest = asyncHandler(async (req, res) => {
  const { room, unreadCount } = await getUnreadCountForRequest({
    serviceRequestId: req.params.serviceRequestId,
    accountId: req.accountId,
    roles: req.roles || [],
  });

  return sendSuccess({
    res,
    message: 'تم جلب عدد رسائل الشات غير المقروءة بنجاح',
    doc: {
      roomId: room._id,
      serviceRequestId: room.serviceRequestId,
      unreadCount,
    },
    extra: {
      unreadCount,
    },
  });
});

const getChatUnreadCountByRoom = asyncHandler(async (req, res) => {
  const { room, unreadCount } = await getUnreadCountForRoom({
    roomId: req.params.roomId,
    accountId: req.accountId,
    roles: req.roles || [],
  });

  return sendSuccess({
    res,
    message: 'تم جلب عدد رسائل الشات غير المقروءة بنجاح',
    doc: {
      roomId: room._id,
      serviceRequestId: room.serviceRequestId,
      unreadCount,
    },
    extra: {
      unreadCount,
    },
  });
});

const sendChatMessage = asyncHandler(async (req, res) => {
  const { room, message } = await createChatMessage({
    roomId: req.params.roomId,
    senderAccountId: req.accountId,
    messageType: req.body.messageType,
    text: req.body.text,
    mediaUrl: req.body.mediaUrl,
    location: req.body.location,
  });

  const receiverAccountId = readObjectId(message.receiverAccountId);
  const senderAccountId = readObjectId(message.senderAccountId);
  const { unreadCount } = receiverAccountId
    ? await getUnreadCountForRoom({
        roomId: room._id,
        accountId: receiverAccountId,
        roles: [],
      })
    : { unreadCount: 0 };

  const payload = {
    room,
    message,
    serviceRequestId: room.serviceRequestId,
    requestId: room.serviceRequestId,
    senderAccountId,
    receiverAccountId,
    unreadCount,
    unreadCountForReceiver: unreadCount,
  };

  safeSocketEmit(() => {
    getIO().to(`chat:${room._id}`).emit('chat:message-new', payload);
    emitToRequest(room.serviceRequestId.toString(), 'chat:message-new', payload);
    if (receiverAccountId) {
      emitToAccount(receiverAccountId, 'chat:message-new', payload);
    }
    emitToAdmins('admin:chat-message-new', payload);
  });

  setImmediate(() => {
    safeCreateNotification({
      accountId: receiverAccountId,
      title: 'رسالة جديدة',
      body: message.messageType === 'text' ? message.text : 'وصلك محتوى جديد في الشات',
      type: 'chat',
      data: {
        roomId: room._id,
        serviceRequestId: room.serviceRequestId,
        requestId: room.serviceRequestId,
        messageId: message._id,
        unreadCount,
      },
    });
  });

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم إرسال الرسالة بنجاح',
    doc: message,
    extra: {
      room,
    },
  });
});

const markChatRoomAsRead = asyncHandler(async (req, res) => {
  const { room, modifiedCount } = await markRoomMessagesAsRead({
    roomId: req.params.roomId,
    accountId: req.accountId,
    roles: req.roles || [],
  });

  safeSocketEmit(() => {
    const payload = {
      roomId: room._id,
      serviceRequestId: room.serviceRequestId,
      readerAccountId: req.accountId,
      modifiedCount,
    };

    getIO().to(`chat:${room._id}`).emit('chat:messages-read', payload);
    emitToRequest(room.serviceRequestId.toString(), 'chat:messages-read', payload);
    emitToAccount(req.accountId, 'chat:messages-read', payload);
  });

  return sendSuccess({
    res,
    message: 'تم تعليم رسائل الشات كمقروءة',
    doc: {
      roomId: room._id,
      modifiedCount,
    },
  });
});

module.exports = {
  getChatRoomByRequest,
  getChatRoomById,
  getChatMessages,
  getChatUnreadCountByRequest,
  getChatUnreadCountByRoom,
  sendChatMessage,
  markChatRoomAsRead,
};
