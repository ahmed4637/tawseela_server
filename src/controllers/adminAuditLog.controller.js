const mongoose = require('mongoose');

const AdminAuditLog = require('../models/adminAuditLog.model');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');

const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

const buildPagination = ({ page = 1, limit = 30, total = 0 }) => {
  const pageNumber = Math.max(Number(page) || 1, 1);
  const limitNumber = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const skip = (pageNumber - 1) * limitNumber;

  return {
    pageNumber,
    limitNumber,
    skip,
    pagination: {
      page: pageNumber,
      limit: limitNumber,
      total,
      pages: Math.ceil(total / limitNumber),
    },
  };
};

const getAdminAuditLogs = asyncHandler(async (req, res) => {
  const {
    adminAccountId,
    module,
    action,
    entityType,
    entityId,
    from,
    to,
    page = 1,
    limit = 30,
  } = req.query;

  const query = {};

  if (adminAccountId) {
    if (!isValidObjectId(adminAccountId)) {
      const error = new Error('رقم حساب الأدمن غير صحيح');
      error.statusCode = 400;
      throw error;
    }

    query.adminAccountId = adminAccountId;
  }

  if (module) {
    query.module = module.toString().trim().toLowerCase();
  }

  if (action) {
    query.action = action.toString().trim().toLowerCase();
  }

  if (entityType) {
    query.entityType = entityType.toString().trim();
  }

  if (entityId) {
    query.entityId = entityId.toString().trim();
  }

  if (from || to) {
    query.createdAt = {};

    if (from) {
      query.createdAt.$gte = new Date(from);
    }

    if (to) {
      query.createdAt.$lte = new Date(to);
    }
  }

  const total = await AdminAuditLog.countDocuments(query);
  const { limitNumber, skip, pagination } = buildPagination({
    page,
    limit,
    total,
  });

  const docs = await AdminAuditLog.find(query)
    .populate('adminAccountId', 'name phone email roles defaultRole')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNumber);

  return sendSuccess({
    res,
    message: 'تم جلب سجل تعديلات الإدارة بنجاح',
    docs,
    extra: {
      pagination,
    },
  });
});

const getAdminAuditLogById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    const error = new Error('رقم سجل الرقابة غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const doc = await AdminAuditLog.findById(id).populate(
    'adminAccountId',
    'name phone email roles defaultRole'
  );

  if (!doc) {
    const error = new Error('سجل الرقابة غير موجود');
    error.statusCode = 404;
    throw error;
  }

  return sendSuccess({
    res,
    message: 'تم جلب تفاصيل سجل الرقابة بنجاح',
    doc,
  });
});

module.exports = {
  getAdminAuditLogs,
  getAdminAuditLogById,
};
