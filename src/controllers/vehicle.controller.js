const mongoose = require('mongoose');

const Vehicle = require('../models/vehicle.model');
const ServiceVehicleConfig = require('../models/serviceVehicleConfig.model');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');

const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

const getAllVehicles = asyncHandler(async (req, res) => {
  const { serviceType, includeInactive } = req.query;

  const query = {};

  if (includeInactive !== 'true') {
    query.isActive = true;
  }

  if (serviceType) {
    const normalizedServiceType = serviceType.toString().trim().toLowerCase();
    const configuredSupport = await ServiceVehicleConfig.find({
      serviceType: normalizedServiceType,
    })
      .select('vehicleTypeCode isActive')
      .lean();

    const configuredCodes = configuredSupport
      .map((item) => item.vehicleTypeCode?.toString().trim().toLowerCase())
      .filter(Boolean);
    const activeConfiguredCodes = configuredSupport
      .filter((item) => item.isActive === true)
      .map((item) => item.vehicleTypeCode?.toString().trim().toLowerCase())
      .filter(Boolean);

    query.$or = [
      ...(activeConfiguredCodes.length > 0
        ? [{ code: { $in: activeConfiguredCodes } }]
        : []),
      {
        allowedServices: normalizedServiceType,
        ...(configuredCodes.length > 0
          ? { code: { $nin: configuredCodes } }
          : {}),
      },
    ];
  }

  const docs = await Vehicle.find(query).sort({
    order: 1,
    createdAt: -1,
  });

  return sendSuccess({
    res,
    message: 'تم جلب أنواع المركبات بنجاح',
    docs,
  });
});

const getVehicleByIdOrCode = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const query = isValidObjectId(id)
    ? { _id: id }
    : { code: id.toString().trim().toLowerCase() };

  const doc = await Vehicle.findOne(query);

  if (!doc) {
    const error = new Error('نوع المركبة غير موجود');
    error.statusCode = 404;
    throw error;
  }

  return sendSuccess({
    res,
    message: 'تم جلب نوع المركبة بنجاح',
    doc,
  });
});

const createVehicle = asyncHandler(async (req, res) => {
  const doc = await Vehicle.create(req.body);

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم إنشاء نوع المركبة بنجاح',
    doc,
  });
});

const updateVehicle = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const query = isValidObjectId(id)
    ? { _id: id }
    : { code: id.toString().trim().toLowerCase() };

  const doc = await Vehicle.findOneAndUpdate(query, req.body, {
    new: true,
    runValidators: true,
  });

  if (!doc) {
    const error = new Error('نوع المركبة غير موجود');
    error.statusCode = 404;
    throw error;
  }

  return sendSuccess({
    res,
    message: 'تم تعديل نوع المركبة بنجاح',
    doc,
  });
});

const deleteVehicle = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const query = isValidObjectId(id)
    ? { _id: id }
    : { code: id.toString().trim().toLowerCase() };

  const doc = await Vehicle.findOneAndUpdate(
    query,
    { isActive: false },
    {
      new: true,
      runValidators: true,
    }
  );

  if (!doc) {
    const error = new Error('نوع المركبة غير موجود');
    error.statusCode = 404;
    throw error;
  }

  return sendSuccess({
    res,
    message: 'تم تعطيل نوع المركبة بنجاح',
    doc,
  });
});

module.exports = {
  getAllVehicles,
  getVehicleByIdOrCode,
  createVehicle,
  updateVehicle,
  deleteVehicle,
};