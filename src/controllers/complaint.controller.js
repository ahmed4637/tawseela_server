const Complaint = require('../models/complaint.model');
const ServiceRequest = require('../models/serviceRequest.model');
const SupportTicket = require('../models/supportTicket.model');

const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const { createNotification } = require('../services/notification.service');
const { createAdminAuditLog } = require('../services/adminAuditLog.service');
const {
  normalizeAttachments,
  addSupportMessage,
  notifyTicketUpdate,
} = require('../services/support.service');

const isAdminRequest = (req) => req.roles?.includes('admin');

const emitAdminComplaintEvent = (eventName, payload) => {
  try {
    // Lazy require avoids circular init issues while keeping dashboard live updates.
    // eslint-disable-next-line global-require
    const { getIO } = require('../sockets/socket.server');
    getIO().to('admins').emit(eventName, payload);
  } catch (error) {
    // Socket may be unavailable in CLI or during isolated controller execution.
  }
};

const normalizeComplaintStatus = (status) => {
  if (status === 'in_review') {
    return 'under_review';
  }

  return status;
};

const getComplaintRequestContext = async ({ serviceRequestId, accountId }) => {
  const request = await ServiceRequest.findById(serviceRequestId);

  if (!request) {
    const error = new Error('الطلب غير موجود');
    error.statusCode = 404;
    throw error;
  }

  const isCustomer = request.customerAccountId?.toString() === accountId.toString();
  const isDriver = request.acceptedDriverAccountId?.toString() === accountId.toString();

  if (!isCustomer && !isDriver) {
    const error = new Error('غير مسموح لك بعمل شكوى على هذا الطلب');
    error.statusCode = 403;
    throw error;
  }

  const againstAccountId = isCustomer
    ? request.acceptedDriverAccountId
    : request.customerAccountId;

  if (!againstAccountId) {
    const error = new Error('لا يوجد طرف آخر لتقديم شكوى ضده');
    error.statusCode = 400;
    throw error;
  }

  return {
    request,
    fromRole: isCustomer ? 'customer' : 'driver',
    againstRole: isCustomer ? 'driver' : 'customer',
    againstAccountId,
  };
};

const populateComplaint = (query) => query
  .populate('fromAccountId', 'name phone email roles')
  .populate('againstAccountId', 'name phone email roles')
  .populate('assignedAdminId', 'name phone email')
  .populate('resolvedByAdminId', 'name phone email')
  .populate('linkedSupportTicketId', 'ticketCode status priority')
  .populate('serviceRequestId');

const createComplaint = asyncHandler(async (req, res) => {
  const {
    serviceRequestId,
    category,
    title,
    description,
    images = [],
    attachments = [],
    priority = 'medium',
  } = req.body;

  const cleanImages = Array.isArray(images)
    ? images
        .map((item) => item.toString().trim())
        .filter((item) => item.length > 0)
        .slice(0, 5)
    : [];

  const normalizedAttachments = normalizeAttachments([
    ...cleanImages.map((url) => ({ url, type: 'image' })),
    ...attachments,
  ]).slice(0, 8);

  const cleanCategory = category?.toString().trim() || 'other';
  const cleanTitle = title?.toString().trim();
  const cleanDescription = description?.toString().trim();
  const cleanPriority = ['low', 'medium', 'high', 'urgent'].includes(priority)
    ? priority
    : 'medium';

  const {
    request,
    fromRole,
    againstRole,
    againstAccountId,
  } = await getComplaintRequestContext({
    serviceRequestId,
    accountId: req.accountId,
  });

  const existingOpenComplaint = await Complaint.findOne({
    serviceRequestId: request._id,
    fromAccountId: req.accountId,
    againstAccountId,
    status: { $in: ['open', 'under_review', 'in_review'] },
  });

  if (existingOpenComplaint) {
    const error = new Error('لديك شكوى مفتوحة بالفعل على هذا الطلب');
    error.statusCode = 409;
    throw error;
  }

  const doc = await Complaint.create({
    serviceRequestId: request._id,
    fromAccountId: req.accountId,
    againstAccountId,
    fromRole,
    againstRole,
    category: cleanCategory,
    title: cleanTitle,
    description: cleanDescription,
    images: normalizedAttachments
      .filter((item) => item.type === 'image')
      .map((item) => item.url)
      .slice(0, 5),
    attachments: normalizedAttachments,
    priority: cleanPriority,
    status: 'open',
  });

  const supportTicket = await SupportTicket.create({
    accountId: req.accountId,
    accountRole: fromRole,
    relatedServiceRequestId: request._id,
    relatedComplaintId: doc._id,
    subject: cleanTitle,
    category: 'complaint_followup',
    priority: cleanPriority,
    status: 'pending_admin',
  });

  await addSupportMessage({
    ticket: supportTicket,
    senderAccountId: req.accountId,
    senderType: 'user',
    text: cleanDescription,
    attachments: normalizedAttachments,
  });

  doc.linkedSupportTicketId = supportTicket._id;
  await doc.save();

  try {
    await createNotification({
      accountId: againstAccountId,
      title: 'تم تسجيل شكوى مرتبطة بطلب',
      body: 'تم تسجيل شكوى مرتبطة بأحد الطلبات، وسيتم مراجعتها من الإدارة',
      type: 'complaint',
      data: {
        complaintId: doc._id,
        complaintCode: doc.complaintCode,
        serviceRequestId: request._id,
      },
    });
  } catch (error) {
    console.error('Complaint notification error:', error.message);
  }

  emitAdminComplaintEvent('admin:complaint-created', {
    complaintId: doc._id,
    complaintCode: doc.complaintCode,
    serviceRequestId: request._id,
    priority: doc.priority,
    status: doc.status,
  });

  const populatedDoc = await populateComplaint(Complaint.findById(doc._id));

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم إرسال الشكوى بنجاح وسيتم مراجعتها',
    doc: populatedDoc,
    extra: {
      supportTicket,
    },
  });
});

const getMyComplaints = asyncHandler(async (req, res) => {
  const docs = await populateComplaint(
    Complaint.find({
      fromAccountId: req.accountId,
    })
      .sort({ createdAt: -1 }),
  );

  return sendSuccess({
    res,
    message: 'تم جلب الشكاوى الخاصة بك',
    docs,
  });
});

const getComplaintsAgainstMe = asyncHandler(async (req, res) => {
  const docs = await populateComplaint(
    Complaint.find({
      againstAccountId: req.accountId,
    })
      .sort({ createdAt: -1 }),
  );

  return sendSuccess({
    res,
    message: 'تم جلب الشكاوى المقدمة ضدك',
    docs,
  });
});

const getComplaintById = asyncHandler(async (req, res) => {
  const doc = await populateComplaint(Complaint.findById(req.params.id));

  if (!doc) {
    const error = new Error('الشكوى غير موجودة');
    error.statusCode = 404;
    throw error;
  }

  const canAccess =
    isAdminRequest(req) ||
    doc.fromAccountId?._id?.toString() === req.accountId ||
    doc.againstAccountId?._id?.toString() === req.accountId;

  if (!canAccess) {
    const error = new Error('غير مسموح لك بفتح هذه الشكوى');
    error.statusCode = 403;
    throw error;
  }

  return sendSuccess({
    res,
    message: 'تم جلب تفاصيل الشكوى',
    doc,
  });
});

const getAllComplaintsForAdmin = asyncHandler(async (req, res) => {
  const {
    status,
    category,
    priority,
    assignedAdminId,
    fromAccountId,
    againstAccountId,
    serviceRequestId,
    page = 1,
    limit = 30,
  } = req.query;

  const query = {};

  if (status) query.status = normalizeComplaintStatus(status);
  if (category) query.category = category;
  if (priority) query.priority = priority;
  if (assignedAdminId) query.assignedAdminId = assignedAdminId;
  if (fromAccountId) query.fromAccountId = fromAccountId;
  if (againstAccountId) query.againstAccountId = againstAccountId;
  if (serviceRequestId) query.serviceRequestId = serviceRequestId;

  const pageNumber = Math.max(Number(page) || 1, 1);
  const limitNumber = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const skip = (pageNumber - 1) * limitNumber;

  const [docs, total] = await Promise.all([
    populateComplaint(
      Complaint.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNumber),
    ),
    Complaint.countDocuments(query),
  ]);

  return sendSuccess({
    res,
    message: 'تم جلب الشكاوى بنجاح',
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

const updateComplaintByAdmin = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    status,
    adminNote,
    resolutionNote,
    priority,
    assignedAdminId,
    reason = '',
  } = req.body;

  const doc = await Complaint.findById(id);

  if (!doc) {
    const error = new Error('الشكوى غير موجودة');
    error.statusCode = 404;
    throw error;
  }

  const oldValue = doc.toObject();

  if (status) {
    doc.status = normalizeComplaintStatus(status);
  }

  if (adminNote !== undefined) {
    doc.adminNote = adminNote?.toString().trim() || '';
  }

  if (resolutionNote !== undefined) {
    doc.resolutionNote = resolutionNote?.toString().trim() || '';
  }

  if (priority && ['low', 'medium', 'high', 'urgent'].includes(priority)) {
    doc.priority = priority;
  }

  if (assignedAdminId !== undefined) {
    doc.assignedAdminId = assignedAdminId || null;
  }

  if (['resolved', 'rejected', 'closed'].includes(doc.status)) {
    doc.resolvedByAdminId = req.accountId;
    doc.resolvedAt = new Date();
  }

  if (['open', 'under_review'].includes(doc.status)) {
    doc.resolvedByAdminId = null;
    doc.resolvedAt = null;
  }

  await doc.save();

  await createAdminAuditLog({
    req,
    module: 'complaints',
    action: 'update',
    entityType: 'Complaint',
    entityId: doc._id,
    oldValue,
    newValue: doc,
    reason,
  });

  try {
    await createNotification({
      accountId: doc.fromAccountId,
      title: 'تحديث على الشكوى',
      body: `تم تحديث حالة الشكوى إلى: ${doc.status}`,
      type: 'complaint',
      data: {
        complaintId: doc._id,
        complaintCode: doc.complaintCode,
        status: doc.status,
      },
    });
  } catch (error) {
    console.error('Complaint update notification error:', error.message);
  }

  if (doc.assignedAdminId) {
    await notifyTicketUpdate({
      ticket: { _id: doc.linkedSupportTicketId || doc._id, ticketCode: doc.complaintCode },
      receiverAccountId: doc.assignedAdminId,
      title: 'تم تعيين شكوى لك',
      body: `تم تعيين الشكوى ${doc.complaintCode} لك للمراجعة`,
      data: {
        complaintId: doc._id,
        complaintCode: doc.complaintCode,
      },
    });
  }

  emitAdminComplaintEvent('admin:complaint-updated', {
    complaintId: doc._id,
    complaintCode: doc.complaintCode,
    status: doc.status,
    priority: doc.priority,
    assignedAdminId: doc.assignedAdminId,
  });

  const populatedDoc = await populateComplaint(Complaint.findById(doc._id));

  return sendSuccess({
    res,
    message: 'تم تحديث الشكوى بنجاح',
    doc: populatedDoc,
  });
});

module.exports = {
  createComplaint,
  getMyComplaints,
  getComplaintsAgainstMe,
  getComplaintById,
  getAllComplaintsForAdmin,
  updateComplaintByAdmin,
};
