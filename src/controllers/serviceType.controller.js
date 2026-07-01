const mongoose = require('mongoose');

const { ServiceType, SERVICE_TYPE_KEYS } = require('../models/serviceType.model');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const { createAdminAuditLog } = require('../services/adminAuditLog.service');

const DEFAULT_SERVICE_TYPES = [
  {
    key: 'instant_ride',
    nameAr: 'مشوار فوري',
    nameEn: 'Instant Ride',
    description: 'طلب مشوار فوري من نقطة انطلاق إلى وجهة',
    sortOrder: 1,
    allowNegotiation: true,
    allowCustomerCoupon: true,
    allowDriverCoupon: true,
  },
  {
    key: 'scheduled_ride',
    nameAr: 'حجز بموعد',
    nameEn: 'Scheduled Ride',
    description: 'حجز مركبة لموعد محدد مسبقًا',
    sortOrder: 2,
    allowNegotiation: true,
    allowCustomerCoupon: true,
    allowDriverCoupon: true,
  },
  {
    key: 'delivery_order',
    nameAr: 'توصيل طلب',
    nameEn: 'Delivery Order',
    description: 'طلب سائق لإحضار أو توصيل شيء للعميل',
    sortOrder: 3,
    allowNegotiation: true,
    allowCustomerCoupon: true,
    allowDriverCoupon: true,
  },
];

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const ensureDefaultServiceTypes = async () => {
  await Promise.all(
    DEFAULT_SERVICE_TYPES.map((serviceType) =>
      ServiceType.updateOne(
        { key: serviceType.key },
        { $setOnInsert: serviceType },
        { upsert: true }
      )
    )
  );
};

const findServiceTypeByIdOrKey = async (idOrKey) => {
  const value = idOrKey.toString().trim().toLowerCase();
  const query = isValidObjectId(value) ? { _id: value } : { key: value };
  return ServiceType.findOne(query);
};

const buildServiceTypeUpdates = (body) => {
  const allowedFields = [
    'nameAr',
    'nameEn',
    'description',
    'iconUrl',
    'isActive',
    'allowNegotiation',
    'allowCustomerCoupon',
    'allowDriverCoupon',
    'sortOrder',
  ];

  const updates = {};
  allowedFields.forEach((field) => {
    if (body[field] !== undefined) {
      updates[field] = body[field];
    }
  });

  return updates;
};

const getPublicServiceTypes = asyncHandler(async (req, res) => {
  await ensureDefaultServiceTypes();

  const { includeInactive } = req.query;
  const query = {};

  if (includeInactive !== 'true') {
    query.isActive = true;
  }

  const docs = await ServiceType.find(query).sort({ sortOrder: 1, createdAt: 1 });

  return sendSuccess({
    res,
    message: 'تم جلب الخدمات بنجاح',
    docs,
  });
});

const getPublicServiceTypeByIdOrKey = asyncHandler(async (req, res) => {
  await ensureDefaultServiceTypes();

  const doc = await findServiceTypeByIdOrKey(req.params.idOrKey);

  if (!doc || !doc.isActive) {
    const error = new Error('الخدمة غير موجودة أو غير مفعلة');
    error.statusCode = 404;
    throw error;
  }

  return sendSuccess({
    res,
    message: 'تم جلب الخدمة بنجاح',
    doc,
  });
});

const getAdminServiceTypes = asyncHandler(async (req, res) => {
  await ensureDefaultServiceTypes();

  const { isActive } = req.query;
  const query = {};

  if (isActive === 'true') {
    query.isActive = true;
  }

  if (isActive === 'false') {
    query.isActive = false;
  }

  const docs = await ServiceType.find(query).sort({ sortOrder: 1, createdAt: 1 });

  return sendSuccess({
    res,
    message: 'تم جلب خدمات الإدارة بنجاح',
    docs,
  });
});

const getAdminServiceTypeByIdOrKey = asyncHandler(async (req, res) => {
  await ensureDefaultServiceTypes();

  const doc = await findServiceTypeByIdOrKey(req.params.idOrKey);

  if (!doc) {
    const error = new Error('الخدمة غير موجودة');
    error.statusCode = 404;
    throw error;
  }

  return sendSuccess({
    res,
    message: 'تم جلب الخدمة بنجاح',
    doc,
  });
});

const createAdminServiceType = asyncHandler(async (req, res) => {
  const { key } = req.body;

  if (!SERVICE_TYPE_KEYS.includes(key)) {
    const error = new Error('كود الخدمة غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const doc = await ServiceType.create({
    ...req.body,
    updatedByAdminId: req.accountId,
  });

  await createAdminAuditLog({
    req,
    module: 'services',
    action: 'create',
    entityType: 'ServiceType',
    entityId: doc._id,
    oldValue: null,
    newValue: doc,
    reason: req.body.reason || 'إنشاء خدمة من الداشبورد',
  });

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم إنشاء الخدمة بنجاح',
    doc,
  });
});

const updateAdminServiceType = asyncHandler(async (req, res) => {
  const doc = await findServiceTypeByIdOrKey(req.params.idOrKey);

  if (!doc) {
    const error = new Error('الخدمة غير موجودة');
    error.statusCode = 404;
    throw error;
  }

  const oldValue = doc.toObject();
  const updates = buildServiceTypeUpdates(req.body);

  Object.assign(doc, updates);
  doc.updatedByAdminId = req.accountId;

  await doc.save();

  await createAdminAuditLog({
    req,
    module: 'services',
    action: 'update',
    entityType: 'ServiceType',
    entityId: doc._id,
    oldValue,
    newValue: doc,
    reason: req.body.reason || 'تعديل خدمة من الداشبورد',
  });

  return sendSuccess({
    res,
    message: 'تم تحديث الخدمة بنجاح',
    doc,
  });
});

module.exports = {
  ensureDefaultServiceTypes,
  getPublicServiceTypes,
  getPublicServiceTypeByIdOrKey,
  getAdminServiceTypes,
  getAdminServiceTypeByIdOrKey,
  createAdminServiceType,
  updateAdminServiceType,
};
