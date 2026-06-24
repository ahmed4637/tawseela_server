const Complaint = require('../models/complaint.model');
const ServiceRequest = require('../models/serviceRequest.model');

const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const { createNotification } = require('../services/notification.service');


const createComplaint = asyncHandler(async (req, res) => {
  const {
    serviceRequestId,
    category,
    title,
    description,
    images = [],
  } = req.body;

  const cleanImages = Array.isArray(images)
    ? images
        .map((item) => item.toString().trim())
        .filter((item) => item.length > 0)
        .slice(0, 5)
    : [];

  const cleanCategory = category?.toString().trim() || 'other';
  const cleanTitle = title?.toString().trim();
  const cleanDescription = description?.toString().trim();

  const request = await ServiceRequest.findById(serviceRequestId);

  if (!request) {
    const error = new Error('الطلب غير موجود');
    error.statusCode = 404;
    throw error;
  }

  const isCustomer = request.customerAccountId.toString() === req.accountId;
  const isDriver =
    request.acceptedDriverAccountId?.toString() === req.accountId;

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

  const existingOpenComplaint = await Complaint.findOne({
    serviceRequestId: request._id,
    fromAccountId: req.accountId,
    againstAccountId,
    status: { $in: ['open', 'under_review'] },
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
    fromRole: isCustomer ? 'customer' : 'driver',
    category: cleanCategory,
    title: cleanTitle,
    description: cleanDescription,
    images: cleanImages,
    status: 'open',
  });

  try {
    await createNotification({
      accountId: againstAccountId,
      title: 'تم تسجيل شكوى',
      body: 'تم تسجيل شكوى مرتبطة بأحد الطلبات، وسيتم مراجعتها من الإدارة',
      type: 'admin',
      data: {
        complaintId: doc._id,
        serviceRequestId: request._id,
      },
    });
  } catch (error) {
    console.error('Complaint notification error:', error.message);
  }

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم إرسال الشكوى بنجاح وسيتم مراجعتها',
    doc,
  });
});
const getMyComplaints = asyncHandler(async (req, res) => {
  const docs = await Complaint.find({
    fromAccountId: req.accountId,
  })
    .populate('againstAccountId', 'name phone')
    .sort({ createdAt: -1 });

  return sendSuccess({
    res,
    message: 'تم جلب الشكاوى الخاصة بك',
    docs,
  });
});

const getComplaintsAgainstMe = asyncHandler(async (req, res) => {
  const docs = await Complaint.find({
    againstAccountId: req.accountId,
  })
    .populate('fromAccountId', 'name phone')
    .sort({ createdAt: -1 });

  return sendSuccess({
    res,
    message: 'تم جلب الشكاوى المقدمة ضدك',
    docs,
  });
});

const getAllComplaintsForAdmin = asyncHandler(async (req, res) => {
  const { status, category, page = 1, limit = 30 } = req.query;

  const query = {};

  if (status) {
    query.status = status;
  }

  if (category) {
    query.category = category;
  }

  const pageNumber = Math.max(Number(page) || 1, 1);
  const limitNumber = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const skip = (pageNumber - 1) * limitNumber;

  const [docs, total] = await Promise.all([
    Complaint.find(query)
      .populate('fromAccountId', 'name phone email')
      .populate('againstAccountId', 'name phone email')
      .populate('serviceRequestId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNumber),

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
  const { status, adminNote } = req.body;

  const doc = await Complaint.findById(id);

  if (!doc) {
    const error = new Error('الشكوى غير موجودة');
    error.statusCode = 404;
    throw error;
  }

  if (status) {
    doc.status = status;
  }

  if (adminNote !== undefined) {
    doc.adminNote = adminNote;
  }

 if (['resolved', 'rejected'].includes(doc.status)) {
  doc.resolvedByAdminId = req.accountId;
  doc.resolvedAt = new Date();
}

if (['open', 'under_review'].includes(doc.status)) {
  doc.resolvedByAdminId = null;
  doc.resolvedAt = null;
}

  await doc.save();

  try {
    await createNotification({
      accountId: doc.fromAccountId,
      title: 'تحديث على الشكوى',
      body: `تم تحديث حالة الشكوى إلى: ${doc.status}`,
      type: 'admin',
      data: {
        complaintId: doc._id,
        status: doc.status,
      },
    });
  } catch (error) {
    console.error('Complaint update notification error:', error.message);
  }

  return sendSuccess({
    res,
    message: 'تم تحديث الشكوى بنجاح',
    doc,
  });
});

module.exports = {
  createComplaint,
  getMyComplaints,
  getComplaintsAgainstMe,
  getAllComplaintsForAdmin,
  updateComplaintByAdmin,
};