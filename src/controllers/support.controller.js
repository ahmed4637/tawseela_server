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

  emitAdminSupportEvent('admin:support-ticket-created', {
    ticketId: ticket._id,
    ticketCode: ticket.ticketCode,
    priority: ticket.priority,
    status: ticket.status,
    category: ticket.category,
  });

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

  return sendSuccess({
    res,
    message: 'تم جلب تذاكر الدعم الخاصة بك',
    docs,
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

  emitAdminSupportEvent('admin:support-message-created', {
    ticketId: ticket._id,
    ticketCode: ticket.ticketCode,
    messageId: message._id,
    senderType: 'user',
  });

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

  return sendSuccess({
    res,
    message: 'تم جلب تذاكر الدعم',
    docs,
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

  emitAdminSupportEvent('admin:support-message-created', {
    ticketId: ticket._id,
    ticketCode: ticket.ticketCode,
    messageId: message._id,
    senderType: 'admin',
  });

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم إرسال رد الدعم',
    doc: message,
  });
});

module.exports = {
  createSupportTicket,
  getMySupportTickets,
  getSupportTicketById,
  getSupportTicketMessages,
  addUserSupportMessage,
  getAllSupportTicketsForAdmin,
  updateSupportTicketByAdmin,
  addAdminSupportMessage,
};
