const mongoose = require('mongoose');

const Vehicle = require('../models/vehicle.model');
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
    query.allowedServices = serviceType;
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