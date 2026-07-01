const mongoose = require('mongoose');

const PromoCode = require('../models/promoCode.model');
const PromoRedemption = require('../models/promoRedemption.model');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const { createAdminAuditLog } = require('../services/adminAuditLog.service');
const {
  normalizeCode,
  validatePromoCode,
} = require('../services/promo.service');

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

const parseArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value
    .toString()
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const getPromoCodesForAdmin = asyncHandler(async (req, res) => {
  const {
    promoType,
    isActive,
    search,
    serviceType,
    vehicleTypeCode,
    page = 1,
    limit = 30,
  } = req.query;

  const query = {};

  if (promoType) {
    query.promoType = promoType;
  }

  if (isActive !== undefined) {
    query.isActive = isActive === 'true';
  }

  if (search) {
    const normalizedSearch = normalizeCode(search);
    query.$or = [
      { code: { $regex: normalizedSearch, $options: 'i' } },
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
    ];
  }

  if (serviceType) {
    query.$or = query.$or || [];
    query.$or.push({ serviceTypes: serviceType }, { serviceTypes: { $size: 0 } });
  }

  if (vehicleTypeCode) {
    const code = vehicleTypeCode.toString().trim().toLowerCase();
    query.$or = query.$or || [];
    query.$or.push({ vehicleTypeCodes: code }, { vehicleTypeCodes: { $size: 0 } });
  }

  const total = await PromoCode.countDocuments(query);
  const { limitNumber, skip, pagination } = buildPagination({ page, limit, total });

  const docs = await PromoCode.find(query)
    .populate('createdByAdminId', 'name phone email')
    .populate('updatedByAdminId', 'name phone email')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNumber);

  return sendSuccess({
    res,
    message: 'تم جلب الكوبونات بنجاح',
    docs,
    extra: { pagination },
  });
});

const createPromoCode = asyncHandler(async (req, res) => {
  const body = req.body;

  const existing = await PromoCode.findOne({ code: normalizeCode(body.code) });

  if (existing) {
    const error = new Error('كود الكوبون موجود بالفعل');
    error.statusCode = 409;
    throw error;
  }

  const doc = await PromoCode.create({
    code: body.code,
    title: body.title || '',
    description: body.description || '',
    promoType: body.promoType,
    discountType: body.discountType,
    discountValue: body.discountValue,
    maxDiscountAmount: body.maxDiscountAmount || 0,
    minFare: body.minFare || 0,
    serviceTypes: parseArray(body.serviceTypes),
    vehicleTypeCodes: parseArray(body.vehicleTypeCodes),
    targetAccountIds: parseArray(body.targetAccountIds),
    usageLimitTotal: body.usageLimitTotal || 0,
    usageLimitPerAccount: body.usageLimitPerAccount ?? 1,
    startsAt: body.startsAt || null,
    endsAt: body.endsAt || null,
    isActive: body.isActive !== false,
    createdByAdminId: req.accountId,
    updatedByAdminId: req.accountId,
  });

  await createAdminAuditLog({
    req,
    module: 'promos',
    action: 'create',
    entityType: 'PromoCode',
    entityId: doc._id,
    oldValue: null,
    newValue: doc,
    reason: body.reason || 'إنشاء كوبون من الداشبورد',
  });

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم إنشاء الكوبون بنجاح',
    doc,
  });
});

const updatePromoCode = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    const error = new Error('رقم الكوبون غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const doc = await PromoCode.findById(id);

  if (!doc) {
    const error = new Error('الكوبون غير موجود');
    error.statusCode = 404;
    throw error;
  }

  const oldValue = doc.toObject();
  const body = req.body;

  const allowedFields = [
    'title',
    'description',
    'discountType',
    'discountValue',
    'maxDiscountAmount',
    'minFare',
    'usageLimitTotal',
    'usageLimitPerAccount',
    'startsAt',
    'endsAt',
    'isActive',
  ];

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      doc[field] = body[field];
    }
  }

  if (body.serviceTypes !== undefined) {
    doc.serviceTypes = parseArray(body.serviceTypes);
  }

  if (body.vehicleTypeCodes !== undefined) {
    doc.vehicleTypeCodes = parseArray(body.vehicleTypeCodes);
  }

  if (body.targetAccountIds !== undefined) {
    doc.targetAccountIds = parseArray(body.targetAccountIds);
  }

  if (body.blockedAccountIds !== undefined) {
    doc.blockedAccountIds = parseArray(body.blockedAccountIds);
  }

  doc.updatedByAdminId = req.accountId;
  await doc.save();

  await createAdminAuditLog({
    req,
    module: 'promos',
    action: 'update',
    entityType: 'PromoCode',
    entityId: doc._id,
    oldValue,
    newValue: doc,
    reason: body.reason || 'تعديل كوبون من الداشبورد',
  });

  return sendSuccess({
    res,
    message: 'تم تعديل الكوبون بنجاح',
    doc,
  });
});

const setPromoCodeStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    const error = new Error('رقم الكوبون غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const doc = await PromoCode.findById(id);

  if (!doc) {
    const error = new Error('الكوبون غير موجود');
    error.statusCode = 404;
    throw error;
  }

  const oldValue = doc.toObject();
  doc.isActive = req.body.isActive === true;
  doc.updatedByAdminId = req.accountId;
  await doc.save();

  await createAdminAuditLog({
    req,
    module: 'promos',
    action: doc.isActive ? 'activate' : 'deactivate',
    entityType: 'PromoCode',
    entityId: doc._id,
    oldValue,
    newValue: doc,
    reason: req.body.reason || '',
  });

  return sendSuccess({
    res,
    message: doc.isActive ? 'تم تفعيل الكوبون بنجاح' : 'تم تعطيل الكوبون بنجاح',
    doc,
  });
});

const getPromoRedemptionsForAdmin = asyncHandler(async (req, res) => {
  const {
    promoCodeId,
    accountId,
    accountRole,
    status,
    serviceRequestId,
    page = 1,
    limit = 30,
  } = req.query;

  const query = {};

  if (promoCodeId) query.promoCodeId = promoCodeId;
  if (accountId) query.accountId = accountId;
  if (accountRole) query.accountRole = accountRole;
  if (status) query.status = status;
  if (serviceRequestId) query.serviceRequestId = serviceRequestId;

  const total = await PromoRedemption.countDocuments(query);
  const { limitNumber, skip, pagination } = buildPagination({ page, limit, total });

  const docs = await PromoRedemption.find(query)
    .populate('promoCodeId')
    .populate('accountId', 'name phone email roles defaultRole')
    .populate('serviceRequestId', 'requestCode serviceType status finalPrice')
    .populate('serviceOfferId', 'offeredPrice sentBy status')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNumber);

  return sendSuccess({
    res,
    message: 'تم جلب سجل استخدام الكوبونات بنجاح',
    docs,
    extra: { pagination },
  });
});

const getAvailablePromos = asyncHandler(async (req, res) => {
  const promoType = req.roles?.includes('driver') && req.query.as === 'driver'
    ? 'driver'
    : req.roles?.includes('driver') && !req.roles?.includes('customer')
      ? 'driver'
      : 'customer';

  const now = new Date();

  const docs = await PromoCode.find({
    promoType,
    isActive: true,
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
      { $or: [{ targetAccountIds: { $size: 0 } }, { targetAccountIds: req.accountId }] },
      { blockedAccountIds: { $ne: req.accountId } },
    ],
  }).sort({ createdAt: -1 });

  return sendSuccess({
    res,
    message: 'تم جلب الكوبونات المتاحة بنجاح',
    docs,
  });
});

const validateCustomerPromo = asyncHandler(async (req, res) => {
  const { code, serviceType, vehicleTypeCode, amount } = req.body;

  const result = await validatePromoCode({
    code,
    promoType: 'customer',
    accountId: req.accountId,
    serviceType,
    vehicleTypeCode,
    amount,
  });

  return sendSuccess({
    res,
    message: 'الكوبون صالح للاستخدام',
    doc: {
      promo: result.promo,
      discountAmount: result.discountAmount,
      finalAmount: result.finalAmount,
      appCoveredDiscountAmount: result.discountAmount,
    },
  });
});

const validateDriverPromo = asyncHandler(async (req, res) => {
  const { code, serviceType, vehicleTypeCode, amount } = req.body;

  const result = await validatePromoCode({
    code,
    promoType: 'driver',
    accountId: req.accountId,
    serviceType,
    vehicleTypeCode,
    amount,
  });

  return sendSuccess({
    res,
    message: 'كوبون السائق صالح للاستخدام',
    doc: {
      promo: result.promo,
      estimatedCommissionDiscount: result.discountAmount,
      estimatedCommissionAfterDiscount: result.finalAmount,
    },
  });
});

module.exports = {
  getPromoCodesForAdmin,
  createPromoCode,
  updatePromoCode,
  setPromoCodeStatus,
  getPromoRedemptionsForAdmin,
  getAvailablePromos,
  validateCustomerPromo,
  validateDriverPromo,
};
