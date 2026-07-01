const ServiceRequest = require('../models/serviceRequest.model');
const SupportTicket = require('../models/supportTicket.model');
const SupportMessage = require('../models/supportMessage.model');
const { createNotification } = require('./notification.service');

const normalizeRole = (account) => {
  if (account?.roles?.includes('driver')) {
    return 'driver';
  }

  if (account?.roles?.includes('customer') || account?.roles?.includes('user')) {
    return 'customer';
  }

  if (account?.roles?.includes('admin')) {
    return 'admin';
  }

  return 'unknown';
};

const normalizeAttachments = (attachments = []) => {
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments
    .map((item) => {
      if (!item) {
        return null;
      }

      if (typeof item === 'string') {
        const url = item.trim();
        return url ? { url, type: 'image', name: '' } : null;
      }

      const url = item.url?.toString().trim();
      if (!url) {
        return null;
      }

      const type = ['image', 'file'].includes(item.type) ? item.type : 'image';

      return {
        url,
        type,
        name: item.name?.toString().trim() || '',
      };
    })
    .filter(Boolean)
    .slice(0, 8);
};

const assertRequestPartyOrAdmin = async ({ serviceRequestId, accountId, isAdmin = false }) => {
  if (!serviceRequestId) {
    return null;
  }

  const request = await ServiceRequest.findById(serviceRequestId);

  if (!request) {
    const error = new Error('الطلب المرتبط غير موجود');
    error.statusCode = 404;
    throw error;
  }

  if (isAdmin) {
    return request;
  }

  const isCustomer = request.customerAccountId?.toString() === accountId?.toString();
  const isDriver = request.acceptedDriverAccountId?.toString() === accountId?.toString();

  if (!isCustomer && !isDriver) {
    const error = new Error('غير مسموح لك بربط هذه التذكرة بهذا الطلب');
    error.statusCode = 403;
    throw error;
  }

  return request;
};

const assertTicketAccess = async ({ ticketId, accountId, isAdmin = false }) => {
  const ticket = await SupportTicket.findById(ticketId);

  if (!ticket) {
    const error = new Error('تذكرة الدعم غير موجودة');
    error.statusCode = 404;
    throw error;
  }

  if (!isAdmin && ticket.accountId.toString() !== accountId.toString()) {
    const error = new Error('غير مسموح لك بفتح هذه التذكرة');
    error.statusCode = 403;
    throw error;
  }

  return ticket;
};

const addSupportMessage = async ({
  ticket,
  senderAccountId,
  senderType,
  text = '',
  attachments = [],
  messageType = 'text',
}) => {
  const cleanText = text?.toString().trim() || '';
  const cleanAttachments = normalizeAttachments(attachments);

  if (!cleanText && cleanAttachments.length === 0) {
    const error = new Error('نص الرسالة أو مرفق واحد على الأقل مطلوب');
    error.statusCode = 400;
    throw error;
  }

  const finalMessageType = cleanAttachments.length > 0 && !cleanText
    ? cleanAttachments[0].type
    : messageType;

  const message = await SupportMessage.create({
    ticketId: ticket._id,
    senderAccountId,
    senderType,
    messageType: ['text', 'image', 'file', 'system'].includes(finalMessageType)
      ? finalMessageType
      : 'text',
    text: cleanText,
    attachments: cleanAttachments,
    readByUserAt: senderType === 'user' ? new Date() : null,
    readByAdminAt: senderType === 'admin' ? new Date() : null,
  });

  ticket.lastMessage = {
    text: cleanText || (cleanAttachments.length ? 'مرفق' : ''),
    senderAccountId,
    senderType,
    createdAt: message.createdAt,
  };

  if (senderType === 'user' && !['closed', 'resolved'].includes(ticket.status)) {
    ticket.status = 'pending_admin';
  }

  if (senderType === 'admin' && !['closed', 'resolved'].includes(ticket.status)) {
    ticket.status = 'pending_user';
  }

  await ticket.save();

  return message;
};

const notifyTicketUpdate = async ({ ticket, receiverAccountId, title, body, data = {} }) => {
  try {
    await createNotification({
      accountId: receiverAccountId,
      title,
      body,
      type: 'complaint',
      data: {
        ticketId: ticket._id,
        ticketCode: ticket.ticketCode,
        ...data,
      },
    });
  } catch (error) {
    console.error('Support notification error:', error.message);
  }
};

module.exports = {
  normalizeRole,
  normalizeAttachments,
  assertRequestPartyOrAdmin,
  assertTicketAccess,
  addSupportMessage,
  notifyTicketUpdate,
};
