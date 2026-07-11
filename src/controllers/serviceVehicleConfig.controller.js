const mongoose = require('mongoose');

const Vehicle = require('../models/vehicle.model');
const ServiceVehicleConfig = require('../models/serviceVehicleConfig.model');
const { SERVICE_TYPE_KEYS } = require('../models/serviceType.model');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const { createAdminAuditLog } = require('../services/adminAuditLog.service');
const { getSearchRadiusKmByServiceType } = require('../services/appSettings.service');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const getCommissionValueForService = (vehicle, serviceType) => {
  if (serviceType === 'instant_ride') {
    return Number(vehicle.commission?.instantRidePercent || 0);
  }

  if (serviceType === 'scheduled_ride') {
    return Number(vehicle.commission?.scheduledRidePercent || 0);
  }

  if (serviceType === 'delivery_order') {
    return Number(vehicle.commission?.deliveryOrderPercent || 0);
  }

  return 0;
};

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

const findConfigById = async (id) => {
  if (!isValidObjectId(id)) {
    const error = new Error('رقم إعداد الخدمة والمركبة غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const doc = await ServiceVehicleConfig.findById(id);

  if (!doc) {
    const error = new Error('إعداد الخدمة والمركبة غير موجود');
    error.statusCode = 404;
    throw error;
  }

  return doc;
};

const buildConfigUpdates = (body) => {
  const allowedFields = [
    'isActive',
    'minFare',
    'baseFare',
    'pricePerKm',
    'pricePerMinute',
    'waitingPricePerMinute',
    'extraPricePerKm',
    'commissionType',
    'commissionValue',
    'defaultRadiusKm',
    'maxDriversToNotify',
    'requestExpirySeconds',
    'offerExpirySeconds',
    'allowNegotiation',
    'allowCoupon',
    'notes',
  ];

  const updates = {};
  allowedFields.forEach((field) => {
    if (body[field] !== undefined) {
      updates[field] = body[field];
    }
  });

  return updates;
};

const getPublicServiceVehicleConfigs = asyncHandler(async (req, res) => {
  const { serviceType, vehicleTypeCode } = req.query;
  const query = { isActive: true };

  if (serviceType) {
    query.serviceType = serviceType.toString().trim().toLowerCase();
  }

  if (vehicleTypeCode) {
    query.vehicleTypeCode = vehicleTypeCode.toString().trim().toLowerCase();
  }

  const docs = await ServiceVehicleConfig.find(query)
    .populate('vehicleTypeId')
    .sort({ serviceType: 1, vehicleTypeName: 1 });

  const availableDocs = docs.filter((doc) => {
    const vehicle = doc.vehicleTypeId;
    return vehicle && vehicle.isActive !== false;
  });

  return sendSuccess({
    res,
    message: 'تم جلب إعدادات الخدمة والمركبة بنجاح',
    docs: availableDocs,
  });
});

const getPublicServiceVehicleConfigById = asyncHandler(async (req, res) => {
  const doc = await findConfigById(req.params.id);

  if (!doc.isActive) {
    const error = new Error('إعداد الخدمة والمركبة غير مفعل');
    error.statusCode = 404;
    throw error;
  }

  await doc.populate('vehicleTypeId');

  return sendSuccess({
    res,
    message: 'تم جلب إعداد الخدمة والمركبة بنجاح',
    doc,
  });
});

const getAdminServiceVehicleConfigs = asyncHandler(async (req, res) => {
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

  const docs = await ServiceVehicleConfig.find(query)
    .populate('vehicleTypeId')
    .sort({ serviceType: 1, vehicleTypeName: 1 });

  return sendSuccess({
    res,
    message: 'تم جلب إعدادات الخدمة والمركبة للإدارة بنجاح',
    docs,
  });
});

const getAdminServiceVehicleConfigById = asyncHandler(async (req, res) => {
  const doc = await findConfigById(req.params.id);
  await doc.populate('vehicleTypeId');

  return sendSuccess({
    res,
    message: 'تم جلب إعداد الخدمة والمركبة بنجاح',
    doc,
  });
});

const createAdminServiceVehicleConfig = asyncHandler(async (req, res) => {
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

  const doc = await ServiceVehicleConfig.create({
    ...req.body,
    serviceType,
    vehicleTypeId: vehicle._id,
    vehicleTypeCode: vehicle.code,
    vehicleTypeName: vehicle.name,
    updatedByAdminId: req.accountId,
  });

  await createAdminAuditLog({
    req,
    module: 'service_vehicle_configs',
    action: 'create',
    entityType: 'ServiceVehicleConfig',
    entityId: doc._id,
    oldValue: null,
    newValue: doc,
    reason: req.body.reason || 'إنشاء إعداد خدمة ومركبة من الداشبورد',
  });

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم إنشاء إعداد الخدمة والمركبة بنجاح',
    doc,
  });
});

const updateAdminServiceVehicleConfig = asyncHandler(async (req, res) => {
  const doc = await findConfigById(req.params.id);
  const oldValue = doc.toObject();

  const updates = buildConfigUpdates(req.body);
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
    module: 'service_vehicle_configs',
    action: 'update',
    entityType: 'ServiceVehicleConfig',
    entityId: doc._id,
    oldValue,
    newValue: doc,
    reason: req.body.reason || 'تعديل إعداد خدمة ومركبة من الداشبورد',
  });

  return sendSuccess({
    res,
    message: 'تم تحديث إعداد الخدمة والمركبة بنجاح',
    doc,
  });
});

const syncServiceVehicleConfigsFromVehicles = asyncHandler(async (req, res) => {
  const vehicles = await Vehicle.find({});
  const docs = [];

  for (const vehicle of vehicles) {
    const services = vehicle.allowedServices || [];

    for (const serviceType of services) {
      if (!SERVICE_TYPE_KEYS.includes(serviceType)) {
        continue;
      }

      const defaultRadiusKm = await getSearchRadiusKmByServiceType(serviceType);

      const update = {
        serviceType,
        vehicleTypeId: vehicle._id,
        vehicleTypeCode: vehicle.code,
        vehicleTypeName: vehicle.name,
        isActive: vehicle.isActive === true,
        minFare: Number(vehicle.minPrice || 0),
        baseFare: Number(vehicle.startPrice || 0),
        pricePerKm: Number(vehicle.pricePerKm || 0),
        commissionType: 'percentage',
        commissionValue: getCommissionValueForService(vehicle, serviceType),
        defaultRadiusKm,
        updatedByAdminId: req.accountId,
      };

      const doc = await ServiceVehicleConfig.findOneAndUpdate(
        {
          serviceType,
          vehicleTypeCode: vehicle.code,
        },
        update,
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
    module: 'service_vehicle_configs',
    action: 'sync_from_vehicles',
    entityType: 'ServiceVehicleConfig',
    entityId: null,
    oldValue: null,
    newValue: {
      syncedCount: docs.length,
    },
    reason: req.body.reason || 'مزامنة إعدادات الخدمات والمركبات من Vehicle الحالي',
  });

  return sendSuccess({
    res,
    message: 'تمت مزامنة إعدادات الخدمات والمركبات بنجاح',
    docs,
    extra: {
      syncedCount: docs.length,
    },
  });
});

module.exports = {
  getPublicServiceVehicleConfigs,
  getPublicServiceVehicleConfigById,
  getAdminServiceVehicleConfigs,
  getAdminServiceVehicleConfigById,
  createAdminServiceVehicleConfig,
  updateAdminServiceVehicleConfig,
  syncServiceVehicleConfigsFromVehicles,
};
