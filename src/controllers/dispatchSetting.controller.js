const mongoose = require('mongoose');

const Vehicle = require('../models/vehicle.model');
const DispatchSetting = require('../models/dispatchSetting.model');
const { SERVICE_TYPE_KEYS } = require('../models/serviceType.model');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const { createAdminAuditLog } = require('../services/adminAuditLog.service');
const { getSearchRadiusKmByServiceType } = require('../services/appSettings.service');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const resolveVehicle = async ({ vehicleTypeId, vehicleTypeCode }) => {
  const query = vehicleTypeId
    ? { _id: vehicleTypeId }
    : { code: vehicleTypeCode?.toString().trim().toLowerCase() };

  if (!query._id && !query.code) {
    const error = new Error('نوع المركبة مطلوب');
    error.statusCode = 400;
    throw error;
  }

  if (query._id && !isValidObjectId(query._id)) {
    const error = new Error('رقم نوع المركبة غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const vehicle = await Vehicle.findOne(query);

  if (!vehicle) {
    const error = new Error('نوع المركبة غير موجود');
    error.statusCode = 404;
    throw error;
  }

  return vehicle;
};

const findDispatchSettingById = async (id) => {
  if (!isValidObjectId(id)) {
    const error = new Error('رقم إعداد التوزيع غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const doc = await DispatchSetting.findById(id);

  if (!doc) {
    const error = new Error('إعداد التوزيع غير موجود');
    error.statusCode = 404;
    throw error;
  }

  return doc;
};

const buildDispatchUpdates = (body) => {
  const allowedFields = [
    'radiusKm',
    'maxDriversToNotify',
    'requestExpirySeconds',
    'offerExpirySeconds',
    'locationFreshnessSeconds',
    'useDriverScore',
    'useDistancePriority',
    'useAcceptanceRate',
    'isActive',
  ];

  const updates = {};
  allowedFields.forEach((field) => {
    if (body[field] !== undefined) {
      updates[field] = body[field];
    }
  });

  return updates;
};

const getAdminDispatchSettings = asyncHandler(async (req, res) => {
  const { serviceType, vehicleTypeCode, isActive } = req.query;
  const query = {};

  if (serviceType) {
    query.serviceType = serviceType.toString().trim().toLowerCase();
  }

  if (vehicleTypeCode) {
    query.vehicleTypeCode = vehicleTypeCode.toString().trim().toLowerCase();
  }

  if (isActive === 'true') {
    query.isActive = true;
  }

  if (isActive === 'false') {
    query.isActive = false;
  }

  const docs = await DispatchSetting.find(query)
    .populate('vehicleTypeId')
    .sort({ serviceType: 1, vehicleTypeName: 1 });

  return sendSuccess({
    res,
    message: 'تم جلب إعدادات التوزيع بنجاح',
    docs,
  });
});

const getAdminDispatchSettingById = asyncHandler(async (req, res) => {
  const doc = await findDispatchSettingById(req.params.id);
  await doc.populate('vehicleTypeId');

  return sendSuccess({
    res,
    message: 'تم جلب إعداد التوزيع بنجاح',
    doc,
  });
});

const createAdminDispatchSetting = asyncHandler(async (req, res) => {
  const serviceType = req.body.serviceType?.toString().trim().toLowerCase();

  if (!SERVICE_TYPE_KEYS.includes(serviceType)) {
    const error = new Error('نوع الخدمة غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const vehicle = await resolveVehicle({
    vehicleTypeId: req.body.vehicleTypeId,
    vehicleTypeCode: req.body.vehicleTypeCode,
  });

  const doc = await DispatchSetting.create({
    ...req.body,
    serviceType,
    vehicleTypeId: vehicle._id,
    vehicleTypeCode: vehicle.code,
    vehicleTypeName: vehicle.name,
    updatedByAdminId: req.accountId,
  });

  await createAdminAuditLog({
    req,
    module: 'dispatch_settings',
    action: 'create',
    entityType: 'DispatchSetting',
    entityId: doc._id,
    oldValue: null,
    newValue: doc,
    reason: req.body.reason || 'إنشاء إعداد توزيع من الداشبورد',
  });

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم إنشاء إعداد التوزيع بنجاح',
    doc,
  });
});

const updateAdminDispatchSetting = asyncHandler(async (req, res) => {
  const doc = await findDispatchSettingById(req.params.id);
  const oldValue = doc.toObject();

  const updates = buildDispatchUpdates(req.body);
  Object.assign(doc, updates);

  if (req.body.vehicleTypeId || req.body.vehicleTypeCode) {
    const vehicle = await resolveVehicle({
      vehicleTypeId: req.body.vehicleTypeId,
      vehicleTypeCode: req.body.vehicleTypeCode,
    });

    doc.vehicleTypeId = vehicle._id;
    doc.vehicleTypeCode = vehicle.code;
    doc.vehicleTypeName = vehicle.name;
  }

  doc.updatedByAdminId = req.accountId;
  await doc.save();

  await createAdminAuditLog({
    req,
    module: 'dispatch_settings',
    action: 'update',
    entityType: 'DispatchSetting',
    entityId: doc._id,
    oldValue,
    newValue: doc,
    reason: req.body.reason || 'تعديل إعداد توزيع من الداشبورد',
  });

  return sendSuccess({
    res,
    message: 'تم تحديث إعداد التوزيع بنجاح',
    doc,
  });
});

const syncDispatchSettingsFromVehicles = asyncHandler(async (req, res) => {
  const vehicles = await Vehicle.find({});
  const docs = [];

  for (const vehicle of vehicles) {
    const services = vehicle.allowedServices || [];

    for (const serviceType of services) {
      if (!SERVICE_TYPE_KEYS.includes(serviceType)) {
        continue;
      }

      const radiusKm = await getSearchRadiusKmByServiceType(serviceType);

      const doc = await DispatchSetting.findOneAndUpdate(
        {
          serviceType,
          vehicleTypeCode: vehicle.code,
        },
        {
          serviceType,
          vehicleTypeId: vehicle._id,
          vehicleTypeCode: vehicle.code,
          vehicleTypeName: vehicle.name,
          radiusKm,
          isActive: vehicle.isActive === true,
          updatedByAdminId: req.accountId,
        },
        {
          upsert: true,
          new: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        }
      );

      docs.push(doc);
    }
  }

  await createAdminAuditLog({
    req,
    module: 'dispatch_settings',
    action: 'sync_from_vehicles',
    entityType: 'DispatchSetting',
    entityId: null,
    oldValue: null,
    newValue: {
      syncedCount: docs.length,
    },
    reason: req.body.reason || 'مزامنة إعدادات التوزيع من Vehicle الحالي',
  });

  return sendSuccess({
    res,
    message: 'تمت مزامنة إعدادات التوزيع بنجاح',
    docs,
    extra: {
      syncedCount: docs.length,
    },
  });
});

module.exports = {
  getAdminDispatchSettings,
  getAdminDispatchSettingById,
  createAdminDispatchSetting,
  updateAdminDispatchSetting,
  syncDispatchSettingsFromVehicles,
};
