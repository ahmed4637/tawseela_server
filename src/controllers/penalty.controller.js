const mongoose = require('mongoose');

const Account = require('../models/account.model');
const AccountRestriction = require('../models/accountRestriction.model');
const CancellationPolicy = require('../models/cancellationPolicy.model');
const PenaltyLog = require('../models/penaltyLog.model');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const { createAdminAuditLog } = require('../services/adminAuditLog.service');
const {
  getActiveRestrictions,
  seedDefaultCancellationPolicies,
} = require('../services/penalty.service');
const { deductLoyaltyPoints } = require('../services/loyalty.service');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

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

const ensureAccountExists = async (accountId) => {
  if (!isValidObjectId(accountId)) {
    const error = new Error('رقم الحساب غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const account = await Account.findById(accountId);

  if (!account) {
    const error = new Error('الحساب غير موجود');
    error.statusCode = 404;
    throw error;
  }

  return account;
};

const getMyActiveRestrictions = asyncHandler(async (req, res) => {
  const docs = await getActiveRestrictions({
    accountId: req.accountId,
  });

  return sendSuccess({
    res,
    message: 'تم جلب القيود النشطة بنجاح',
    docs,
  });
});

const getCancellationPolicies = asyncHandler(async (req, res) => {
  await seedDefaultCancellationPolicies({ adminId: req.accountId });

  const docs = await CancellationPolicy.find({})
    .populate('updatedBy', 'name phone email')
    .sort({ actorType: 1, serviceType: 1 });

  return sendSuccess({
    res,
    message: 'تم جلب سياسات الإلغاء بنجاح',
    docs,
  });
});

const createCancellationPolicy = asyncHandler(async (req, res) => {
  const body = req.body;

  const existing = await CancellationPolicy.findOne({
    actorType: body.actorType,
    serviceType: body.serviceType || 'all',
  });

  if (existing) {
    const error = new Error('توجد سياسة إلغاء لهذا النوع من المستخدم والخدمة');
    error.statusCode = 409;
    throw error;
  }

  const doc = await CancellationPolicy.create({
    actorType: body.actorType,
    serviceType: body.serviceType || 'all',
    beforeAcceptancePenaltyEnabled:
      body.beforeAcceptancePenaltyEnabled === true,
    repeatedCancelLimit: body.repeatedCancelLimit,
    repeatedCancelWindowHours: body.repeatedCancelWindowHours,
    beforeAcceptanceBlockMinutes: body.beforeAcceptanceBlockMinutes,
    afterAcceptanceBlockMinutes: body.afterAcceptanceBlockMinutes,
    loyaltyDeductionPoints: body.loyaltyDeductionPoints,
    removeDriverCoupons: body.removeDriverCoupons === true,
    driverCouponRemoveMode: body.driverCouponRemoveMode || 'none',
    isActive: body.isActive !== false,
    updatedBy: req.accountId,
  });

  await createAdminAuditLog({
    req,
    module: 'penalties',
    action: 'create_cancellation_policy',
    entityType: 'CancellationPolicy',
    entityId: doc._id,
    oldValue: null,
    newValue: doc,
    reason: body.reason || '',
  });

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم إنشاء سياسة الإلغاء بنجاح',
    doc,
  });
});

const updateCancellationPolicy = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    const error = new Error('رقم سياسة الإلغاء غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const doc = await CancellationPolicy.findById(id);

  if (!doc) {
    const error = new Error('سياسة الإلغاء غير موجودة');
    error.statusCode = 404;
    throw error;
  }

  const oldValue = doc.toObject();
  const allowedFields = [
    'beforeAcceptancePenaltyEnabled',
    'repeatedCancelLimit',
    'repeatedCancelWindowHours',
    'beforeAcceptanceBlockMinutes',
    'afterAcceptanceBlockMinutes',
    'loyaltyDeductionPoints',
    'removeDriverCoupons',
    'driverCouponRemoveMode',
    'isActive',
  ];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      doc[field] = req.body[field];
    }
  }

  doc.updatedBy = req.accountId;
  await doc.save();

  await createAdminAuditLog({
    req,
    module: 'penalties',
    action: 'update_cancellation_policy',
    entityType: 'CancellationPolicy',
    entityId: doc._id,
    oldValue,
    newValue: doc,
    reason: req.body.reason || '',
  });

  return sendSuccess({
    res,
    message: 'تم تعديل سياسة الإلغاء بنجاح',
    doc,
  });
});

const getPenaltyLogs = asyncHandler(async (req, res) => {
  const {
    accountId,
    accountRole,
    penaltyType,
    serviceRequestId,
    from,
    to,
    page = 1,
    limit = 30,
  } = req.query;

  const query = {};

  if (accountId) {
    if (!isValidObjectId(accountId)) {
      const error = new Error('رقم الحساب غير صحيح');
      error.statusCode = 400;
      throw error;
    }

    query.accountId = accountId;
  }

  if (accountRole) {
    query.accountRole = accountRole;
  }

  if (penaltyType) {
    query.penaltyType = penaltyType;
  }

  if (serviceRequestId) {
    if (!isValidObjectId(serviceRequestId)) {
      const error = new Error('رقم الطلب غير صحيح');
      error.statusCode = 400;
      throw error;
    }

    query.serviceRequestId = serviceRequestId;
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

  const total = await PenaltyLog.countDocuments(query);
  const { limitNumber, skip, pagination } = buildPagination({
    page,
    limit,
    total,
  });

  const docs = await PenaltyLog.find(query)
    .populate('accountId', 'name phone email roles defaultRole')
    .populate('adminId', 'name phone email')
    .populate('serviceRequestId', 'requestCode serviceType status')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNumber);

  return sendSuccess({
    res,
    message: 'تم جلب سجل العقوبات بنجاح',
    docs,
    extra: { pagination },
  });
});

const getAccountRestrictions = asyncHandler(async (req, res) => {
  const {
    accountId,
    restrictionType,
    isActive,
    page = 1,
    limit = 30,
  } = req.query;

  const query = {};

  if (accountId) {
    if (!isValidObjectId(accountId)) {
      const error = new Error('رقم الحساب غير صحيح');
      error.statusCode = 400;
      throw error;
    }

    query.accountId = accountId;
  }

  if (restrictionType) {
    query.restrictionType = restrictionType;
  }

  if (isActive === 'true') {
    query.isActive = true;
  }

  if (isActive === 'false') {
    query.isActive = false;
  }

  const total = await AccountRestriction.countDocuments(query);
  const { limitNumber, skip, pagination } = buildPagination({
    page,
    limit,
    total,
  });

  const docs = await AccountRestriction.find(query)
    .populate('accountId', 'name phone email roles defaultRole')
    .populate('adminId', 'name phone email')
    .populate('serviceRequestId', 'requestCode serviceType status')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNumber);

  return sendSuccess({
    res,
    message: 'تم جلب قيود الحسابات بنجاح',
    docs,
    extra: { pagination },
  });
});

const createManualPenalty = asyncHandler(async (req, res) => {
  const {
    accountId,
    accountRole,
    reason,
    blockMinutes = 0,
    restrictionTypes = ['app_usage'],
    loyaltyPointsDeducted = 0,
  } = req.body;

  const account = await ensureAccountExists(accountId);

  if (!['customer', 'driver'].includes(accountRole)) {
    const error = new Error('نوع الحساب غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const minutes = Math.max(Number(blockMinutes) || 0, 0);
  const blockUntil = minutes > 0
    ? new Date(Date.now() + minutes * 60 * 1000)
    : null;

  const penalty = await PenaltyLog.create({
    accountId: account._id,
    accountRole,
    penaltyType: minutes > 0 ? 'manual_block' : 'warning',
    phase: 'manual',
    reason: reason || 'عقوبة يدوية من الإدارة',
    blockMinutes: minutes,
    blockUntil,
    createdBy: 'admin',
    adminId: req.accountId,
    loyaltyPointsDeducted: Number(loyaltyPointsDeducted || 0),
  });

  let restrictions = [];

  if (minutes > 0) {
    const startsAt = new Date();
    restrictions = await AccountRestriction.insertMany(
      restrictionTypes.map((restrictionType) => ({
        accountId: account._id,
        restrictionType,
        reason: reason || 'حظر يدوي من الإدارة',
        startsAt,
        endsAt: blockUntil,
        isActive: true,
        source: 'admin',
        penaltyId: penalty._id,
        createdBy: 'admin',
        adminId: req.accountId,
      }))
    );

    penalty.restrictionIds = restrictions.map((item) => item._id);
  }

  let loyaltyTransaction = null;

  if (Number(loyaltyPointsDeducted || 0) > 0) {
    loyaltyTransaction = await deductLoyaltyPoints({
      accountId: account._id,
      accountRole,
      points: loyaltyPointsDeducted,
      reason: reason || 'خصم نقاط يدوي من الإدارة',
      source: 'admin_adjust',
      penaltyLogId: penalty._id,
      adminId: req.accountId,
    });

    penalty.loyaltyPointsDeducted = loyaltyTransaction?.points || 0;
    penalty.metadata = {
      ...(penalty.metadata || {}),
      requestedLoyaltyDeductionPoints: Number(loyaltyPointsDeducted || 0),
      actualLoyaltyDeductionPoints: loyaltyTransaction?.points || 0,
      loyaltyTransactionId: loyaltyTransaction?._id || null,
    };
  }

  await penalty.save();

  await createAdminAuditLog({
    req,
    module: 'penalties',
    action: 'create_manual_penalty',
    entityType: 'PenaltyLog',
    entityId: penalty._id,
    oldValue: null,
    newValue: {
      penalty,
      restrictions,
      loyaltyTransaction,
    },
    reason: reason || '',
  });

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم تطبيق العقوبة اليدوية بنجاح',
    doc: penalty,
    extra: { restrictions, loyaltyTransaction },
  });
});

const deactivateRestriction = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason = '' } = req.body;

  if (!isValidObjectId(id)) {
    const error = new Error('رقم الحظر غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const doc = await AccountRestriction.findById(id);

  if (!doc) {
    const error = new Error('الحظر غير موجود');
    error.statusCode = 404;
    throw error;
  }

  const oldValue = doc.toObject();

  doc.isActive = false;
  doc.deactivatedAt = new Date();
  doc.deactivatedBy = req.accountId;
  doc.deactivateReason = reason || 'تم إلغاء الحظر من الإدارة';
  await doc.save();

  await createAdminAuditLog({
    req,
    module: 'penalties',
    action: 'deactivate_restriction',
    entityType: 'AccountRestriction',
    entityId: doc._id,
    oldValue,
    newValue: doc,
    reason,
  });

  return sendSuccess({
    res,
    message: 'تم إلغاء الحظر بنجاح',
    doc,
  });
});

module.exports = {
  getMyActiveRestrictions,
  getCancellationPolicies,
  createCancellationPolicy,
  updateCancellationPolicy,
  getPenaltyLogs,
  getAccountRestrictions,
  createManualPenalty,
  deactivateRestriction,
};
