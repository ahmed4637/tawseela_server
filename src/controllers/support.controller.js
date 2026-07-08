const SupportTicket = require('../models/supportTicket.model');
const SupportMessage = require('../models/supportMessage.model');

const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const { createAdminAuditLog } = require('../services/adminAuditLog.service');
const {
  normalizeRole,
  normalizeAttachments,
  assertRequestPartyOrAdmin,
  assertTicketAccess,
  addSupportMessage,
  notifyTicketUpdate,
} = require('../services/support.service');

const emitAdminSupportEvent = (eventName, payload) => {
  try {
    // eslint-disable-next-line global-require
    const { emitToAdmins } = require('../sockets/socket.server');
    emitToAdmins(eventName, payload);
  } catch (error) {
    // Socket may be unavailable in CLI or scripts.
  }
};

const emitUserSupportEvent = (accountId, eventName, payload) => {
  try {
    if (!accountId) return;
    // eslint-disable-next-line global-require
    const { emitToAccount } = require('../sockets/socket.server');
    emitToAccount(accountId.toString(), eventName, payload);
  } catch (error) {
    // Socket may be unavailable in CLI or scripts.
  }
};

const countUserUnreadSupportMessages = async (accountId) => {
  const tickets = await SupportTicket.find({ accountId }).select('_id');
  const ticketIds = tickets.map((item) => item._id);
  if (ticketIds.length === 0) return 0;

  return SupportMessage.countDocuments({
    ticketId: { $in: ticketIds },
    senderType: 'admin',
    readByUserAt: null,
  });
};

const countAdminUnreadSupportMessages = async () => {
  return SupportMessage.countDocuments({
    senderType: 'user',
    readByAdminAt: null,
  });
};

const appendUnreadCountsToTickets = async ({ docs = [], forAdmin = false }) => {
  const plainDocs = docs.map((doc) => (typeof doc.toObject === 'function' ? doc.toObject() : doc));
  const ticketIds = plainDocs.map((doc) => doc._id).filter(Boolean);

  if (ticketIds.length === 0) {
    return plainDocs.map((doc) => ({ ...doc, unreadCount: 0 }));
  }

  const grouped = await SupportMessage.aggregate([
    {
      $match: {
        ticketId: { $in: ticketIds },
        ...(forAdmin
          ? { senderType: 'user', readByAdminAt: null }
          : { senderType: 'admin', readByUserAt: null }),
      },
    },
    { $group: { _id: '$ticketId', count: { $sum: 1 } } },
  ]);

  const unreadByTicket = new Map(
    grouped.map((item) => [item._id.toString(), Number(item.count) || 0]),
  );

  return plainDocs.map((doc) => ({
    ...doc,
    unreadCount: unreadByTicket.get(doc._id.toString()) || 0,
  }));
};

const emitSupportUnreadCountForUser = async (accountId) => {
  const unreadCount = await countUserUnreadSupportMessages(accountId);
  emitUserSupportEvent(accountId, 'support:unread-count', { unreadCount });
  return unreadCount;
};

const emitSupportUnreadCountForAdmins = async () => {
  const unreadCount = await countAdminUnreadSupportMessages();
  emitAdminSupportEvent('admin:support-unread-count', { unreadCount });
  return unreadCount;
};

const populateTicket = (query) => query
  .populate('accountId', 'name phone email roles')
  .populate('relatedServiceRequestId')
  .populate('relatedComplaintId', 'complaintCode status priority title')
  .populate('assignedAdminId', 'name phone email')
  .populate('closedByAdminId', 'name phone email');

const createSupportTicket = asyncHandler(async (req, res) => {
  const {
    subject,
    message,
    category = 'other',
    priority = 'medium',
    relatedServiceRequestId = null,
    relatedComplaintId = null,
    attachments = [],
  } = req.body;

  const cleanSubject = subject?.toString().trim();
  const cleanMessage = message?.toString().trim();
  const cleanCategory = [
    'account',
    'request',
    'trip',
    'payment',
    'promo',
    'loyalty',
    'driver_review',
    'technical',
    'complaint_followup',
    'other',
  ].includes(category)
    ? category
    : 'other';
  const cleanPriority = ['low', 'medium', 'high', 'urgent'].includes(priority)
    ? priority
    : 'medium';

  await assertRequestPartyOrAdmin({
    serviceRequestId: relatedServiceRequestId,
    accountId: req.accountId,
    isAdmin: false,
  });

  const ticket = await SupportTicket.create({
    accountId: req.accountId,
    accountRole: normalizeRole(req.account),
    relatedServiceRequestId: relatedServiceRequestId || null,
    relatedComplaintId: relatedComplaintId || null,
    subject: cleanSubject,
    category: cleanCategory,
    priority: cleanPriority,
    status: 'pending_admin',
  });

  const firstMessage = await addSupportMessage({
    ticket,
    senderAccountId: req.accountId,
    senderType: 'user',
    text: cleanMessage,
    attachments: normalizeAttachments(attachments),
  });

  const ticketPayload = {
    ticketId: ticket._id,
    ticketCode: ticket.ticketCode,
    priority: ticket.priority,
    status: ticket.status,
    category: ticket.category,
  };

  emitAdminSupportEvent('admin:support-ticket-created', ticketPayload);
  await emitSupportUnreadCountForAdmins();

  const populatedTicket = await populateTicket(SupportTicket.findById(ticket._id));

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم إنشاء تذكرة الدعم بنجاح',
    doc: populatedTicket,
    extra: {
      firstMessage,
    },
  });
});

const getMySupportTickets = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 30 } = req.query;
  const query = { accountId: req.accountId };

  if (status) {
    query.status = status;
  }

  const pageNumber = Math.max(Number(page) || 1, 1);
  const limitNumber = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const skip = (pageNumber - 1) * limitNumber;

  const [docs, total] = await Promise.all([
    populateTicket(
      SupportTicket.find(query)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limitNumber),
    ),
    SupportTicket.countDocuments(query),
  ]);

  const docsWithUnread = await appendUnreadCountsToTickets({ docs, forAdmin: false });

  return sendSuccess({
    res,
    message: 'تم جلب تذاكر الدعم الخاصة بك',
    docs: docsWithUnread,
    extra: {
      pagination: {
        page: pageNumber,
        limit: limitNumber,
        total,
        pages: Math.ceil(total / limitNumber),
      },
    },
  });
});

const getSupportTicketById = asyncHandler(async (req, res) => {
  const ticket = await assertTicketAccess({
    ticketId: req.params.id,
    accountId: req.accountId,
    isAdmin: req.roles?.includes('admin'),
  });

  const doc = await populateTicket(SupportTicket.findById(ticket._id));

  return sendSuccess({
    res,
    message: 'تم جلب تذكرة الدعم',
    doc,
  });
});

const getSupportTicketMessages = asyncHandler(async (req, res) => {
  const ticket = await assertTicketAccess({
    ticketId: req.params.id,
    accountId: req.accountId,
    isAdmin: req.roles?.includes('admin'),
  });

  const docs = await SupportMessage.find({ ticketId: ticket._id })
    .populate('senderAccountId', 'name phone email roles')
    .sort({ createdAt: 1 });

  const update = req.roles?.includes('admin')
    ? { readByAdminAt: new Date() }
    : { readByUserAt: new Date() };

  await SupportMessage.updateMany(
    {
      ticketId: ticket._id,
      ...(req.roles?.includes('admin')
        ? { readByAdminAt: null }
        : { readByUserAt: null }),
    },
    update,
  );

  if (req.roles?.includes('admin')) {
    await emitSupportUnreadCountForAdmins();
  } else {
    await emitSupportUnreadCountForUser(req.accountId);
  }

  return sendSuccess({
    res,
    message: 'تم جلب رسائل الدعم',
    docs,
  });
});

const addUserSupportMessage = asyncHandler(async (req, res) => {
  const ticket = await assertTicketAccess({
    ticketId: req.params.id,
    accountId: req.accountId,
    isAdmin: false,
  });

  if (['closed', 'resolved'].includes(ticket.status)) {
    const error = new Error('لا يمكن إضافة رسالة على تذكرة مغلقة');
    error.statusCode = 400;
    throw error;
  }

  const message = await addSupportMessage({
    ticket,
    senderAccountId: req.accountId,
    senderType: 'user',
    text: req.body.message,
    attachments: normalizeAttachments(req.body.attachments || []),
  });

  const supportPayload = {
    ticketId: ticket._id,
    ticketCode: ticket.ticketCode,
    messageId: message._id,
    senderType: 'user',
    message,
  };

  emitAdminSupportEvent('admin:support-message-created', supportPayload);
  await emitSupportUnreadCountForAdmins();

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم إرسال رسالة الدعم',
    doc: message,
  });
});

const getAllSupportTicketsForAdmin = asyncHandler(async (req, res) => {
  const {
    status,
    category,
    priority,
    assignedAdminId,
    accountId,
    relatedServiceRequestId,
    relatedComplaintId,
    page = 1,
    limit = 30,
  } = req.query;

  const query = {};

  if (status) query.status = status;
  if (category) query.category = category;
  if (priority) query.priority = priority;
  if (assignedAdminId) query.assignedAdminId = assignedAdminId;
  if (accountId) query.accountId = accountId;
  if (relatedServiceRequestId) query.relatedServiceRequestId = relatedServiceRequestId;
  if (relatedComplaintId) query.relatedComplaintId = relatedComplaintId;

  const pageNumber = Math.max(Number(page) || 1, 1);
  const limitNumber = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const skip = (pageNumber - 1) * limitNumber;

  const [docs, total] = await Promise.all([
    populateTicket(
      SupportTicket.find(query)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limitNumber),
    ),
    SupportTicket.countDocuments(query),
  ]);

  const docsWithUnread = await appendUnreadCountsToTickets({ docs, forAdmin: true });

  return sendSuccess({
    res,
    message: 'تم جلب تذاكر الدعم',
    docs: docsWithUnread,
    extra: {
      pagination: {
        page: pageNumber,
        limit: limitNumber,
        total,
        pages: Math.ceil(total / limitNumber),
      },
    },
  });
});

const updateSupportTicketByAdmin = asyncHandler(async (req, res) => {
  const ticket = await assertTicketAccess({
    ticketId: req.params.id,
    accountId: req.accountId,
    isAdmin: true,
  });

  const oldValue = ticket.toObject();
  const {
    status,
    priority,
    assignedAdminId,
    category,
    reason = '',
  } = req.body;

  if (status && ['open', 'pending_user', 'pending_admin', 'resolved', 'closed'].includes(status)) {
    ticket.status = status;
  }

  if (priority && ['low', 'medium', 'high', 'urgent'].includes(priority)) {
    ticket.priority = priority;
  }

  if (category) {
    ticket.category = category;
  }

  if (assignedAdminId !== undefined) {
    ticket.assignedAdminId = assignedAdminId || null;
  }

  if (['resolved', 'closed'].includes(ticket.status)) {
    ticket.closedByAdminId = req.accountId;
    ticket.closedAt = new Date();
  }

  if (!['resolved', 'closed'].includes(ticket.status)) {
    ticket.closedByAdminId = null;
    ticket.closedAt = null;
  }

  await ticket.save();

  await createAdminAuditLog({
    req,
    module: 'support',
    action: 'update_ticket',
    entityType: 'SupportTicket',
    entityId: ticket._id,
    oldValue,
    newValue: ticket,
    reason,
  });

  await notifyTicketUpdate({
    ticket,
    receiverAccountId: ticket.accountId,
    title: 'تحديث على تذكرة الدعم',
    body: `تم تحديث حالة التذكرة إلى: ${ticket.status}`,
    data: {
      status: ticket.status,
    },
  });

  emitUserSupportEvent(ticket.accountId, 'support:ticket-updated', {
    ticketId: ticket._id,
    ticketCode: ticket.ticketCode,
    status: ticket.status,
    priority: ticket.priority,
    category: ticket.category,
  });

  const doc = await populateTicket(SupportTicket.findById(ticket._id));

  return sendSuccess({
    res,
    message: 'تم تحديث تذكرة الدعم',
    doc,
  });
});

const addAdminSupportMessage = asyncHandler(async (req, res) => {
  const ticket = await assertTicketAccess({
    ticketId: req.params.id,
    accountId: req.accountId,
    isAdmin: true,
  });

  if (['closed', 'resolved'].includes(ticket.status)) {
    const error = new Error('لا يمكن إضافة رسالة على تذكرة مغلقة');
    error.statusCode = 400;
    throw error;
  }

  const message = await addSupportMessage({
    ticket,
    senderAccountId: req.accountId,
    senderType: 'admin',
    text: req.body.message,
    attachments: normalizeAttachments(req.body.attachments || []),
  });

  await notifyTicketUpdate({
    ticket,
    receiverAccountId: ticket.accountId,
    title: 'رسالة جديدة من الدعم',
    body: message.text || 'تم إرسال مرفق جديد من الدعم',
    data: {
      messageId: message._id,
    },
  });

  const supportPayload = {
    ticketId: ticket._id,
    ticketCode: ticket.ticketCode,
    messageId: message._id,
    senderType: 'admin',
    message,
  };

  emitUserSupportEvent(ticket.accountId, 'support:message-new', supportPayload);
  emitAdminSupportEvent('admin:support-message-created', supportPayload);
  await emitSupportUnreadCountForUser(ticket.accountId);

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم إرسال رد الدعم',
    doc: message,
  });
});


const getMySupportUnreadCount = asyncHandler(async (req, res) => {
  const unreadCount = await countUserUnreadSupportMessages(req.accountId);

  return sendSuccess({
    res,
    message: 'تم جلب عدد رسائل الدعم غير المقروءة',
    doc: { unreadCount },
    extra: { unreadCount },
  });
});

const getAdminSupportUnreadCount = asyncHandler(async (req, res) => {
  const unreadCount = await countAdminUnreadSupportMessages();

  return sendSuccess({
    res,
    message: 'تم جلب عدد رسائل الدعم غير المقروءة للأدمن',
    doc: { unreadCount },
    extra: { unreadCount },
  });
});

module.exports = {
  createSupportTicket,
  getMySupportTickets,
  getSupportTicketById,
  getSupportTicketMessages,
  addUserSupportMessage,
  getMySupportUnreadCount,
  getAllSupportTicketsForAdmin,
  updateSupportTicketByAdmin,
  addAdminSupportMessage,
  getAdminSupportUnreadCount,
};
