const mongoose = require('mongoose');

const DriverProfile = require('../models/driverProfile.model');
const DriverVehicle = require('../models/driverVehicle.model');
const DriverReviewLog = require('../models/driverReviewLog.model');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const {
  approveDriverProfile,
  rejectOrRequestUpdateDriverProfile,
  approveDriverVehicle,
  rejectOrRequestUpdateDriverVehicle,
  buildDriverReviewStatus,
} = require('../services/driverReview.service');

const ensureValidId = (id, message) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  }
};

const buildPagination = ({ page = 1, limit = 30, total = 0 }) => {
  const pageNumber = Math.max(Number(page) || 1, 1);
  const limitNumber = Math.min(Math.max(Number(limit) || 30, 1), 100);

  return {
    limitNumber,
    skip: (pageNumber - 1) * limitNumber,
    pagination: {
      page: pageNumber,
      limit: limitNumber,
      total,
      pages: Math.ceil(total / limitNumber),
    },
  };
};

const buildProfileQuery = (queryParams = {}) => {
  const query = {};

  if (queryParams.reviewStatus) {
    query.reviewStatus = queryParams.reviewStatus;
  }

  if (queryParams.isApproved === 'true') {
    query.isApproved = true;
  }

  if (queryParams.isApproved === 'false') {
    query.isApproved = false;
  }

  if (queryParams.accountId) {
    ensureValidId(queryParams.accountId, 'رقم الحساب غير صحيح');
    query.accountId = queryParams.accountId;
  }

  return query;
};

const listDriverProfilesForReview = asyncHandler(async (req, res) => {
  const { page = 1, limit = 30 } = req.query;
  const query = buildProfileQuery(req.query);

  const total = await DriverProfile.countDocuments(query);
  const { limitNumber, skip, pagination } = buildPagination({ page, limit, total });

  const docs = await DriverProfile.find(query)
    .populate('accountId', 'name phone email roles isActive createdAt')
    .populate('reviewedBy', 'name phone email')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNumber);

  return sendSuccess({
    res,
    message: 'تم جلب ملفات السائقين للمراجعة بنجاح',
    docs,
    extra: { pagination },
  });
});

const listPendingDriverProfiles = asyncHandler(async (req, res) => {
  req.query.reviewStatus = 'pending';
  return listDriverProfilesForReview(req, res);
});

const getDriverProfileReviewDetails = asyncHandler(async (req, res) => {
  const { driverProfileId } = req.params;
  ensureValidId(driverProfileId, 'رقم ملف السائق غير صحيح');

  const profile = await DriverProfile.findById(driverProfileId)
    .populate('accountId', 'name phone email roles isActive createdAt')
    .populate('reviewedBy', 'name phone email');

  if (!profile) {
    const error = new Error('ملف السائق غير موجود');
    error.statusCode = 404;
    throw error;
  }

  const status = await buildDriverReviewStatus(profile.accountId);

  return sendSuccess({
    res,
    message: 'تم جلب تفاصيل مراجعة السائق بنجاح',
    doc: status,
  });
});

const approveDriverProfileForAdmin = asyncHandler(async (req, res) => {
  const { driverProfileId } = req.params;
  ensureValidId(driverProfileId, 'رقم ملف السائق غير صحيح');

  const doc = await approveDriverProfile({
    driverProfileId,
    req,
    reason: req.body.reason || '',
  });

  return sendSuccess({
    res,
    message: 'تمت الموافقة على السائق بنجاح',
    doc,
  });
});

const rejectDriverProfileForAdmin = asyncHandler(async (req, res) => {
  const { driverProfileId } = req.params;
  ensureValidId(driverProfileId, 'رقم ملف السائق غير صحيح');

  const doc = await rejectOrRequestUpdateDriverProfile({
    driverProfileId,
    req,
    reason: req.body.rejectionReason || req.body.reason || '',
    action: 'rejected',
  });

  return sendSuccess({
    res,
    message: 'تم رفض السائق بنجاح',
    doc,
  });
});

const requestDriverProfileUpdateForAdmin = asyncHandler(async (req, res) => {
  const { driverProfileId } = req.params;
  ensureValidId(driverProfileId, 'رقم ملف السائق غير صحيح');

  const doc = await rejectOrRequestUpdateDriverProfile({
    driverProfileId,
    req,
    reason: req.body.reason || req.body.rejectionReason || '',
    action: 'needs_update',
  });

  return sendSuccess({
    res,
    message: 'تم طلب تعديل بيانات السائق بنجاح',
    doc,
  });
});

const buildVehicleQuery = (queryParams = {}) => {
  const query = {};

  if (queryParams.reviewStatus) {
    query.reviewStatus = queryParams.reviewStatus;
  }

  if (queryParams.vehicleTypeCode) {
    query.vehicleTypeCode = queryParams.vehicleTypeCode.toString().trim().toLowerCase();
  }

  if (queryParams.accountId) {
    ensureValidId(queryParams.accountId, 'رقم الحساب غير صحيح');
    query.accountId = queryParams.accountId;
  }

  if (queryParams.isActive === 'true') {
    query.isActive = true;
  }

  if (queryParams.isActive === 'false') {
    query.isActive = false;
  }

  return query;
};

const listDriverVehiclesForReview = asyncHandler(async (req, res) => {
  const { page = 1, limit = 30 } = req.query;
  const query = buildVehicleQuery(req.query);

  const total = await DriverVehicle.countDocuments(query);
  const { limitNumber, skip, pagination } = buildPagination({ page, limit, total });

  const docs = await DriverVehicle.find(query)
    .populate('accountId', 'name phone email roles isActive createdAt')
    .populate('reviewedBy', 'name phone email')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNumber);

  return sendSuccess({
    res,
    message: 'تم جلب مركبات السائقين للمراجعة بنجاح',
    docs,
    extra: { pagination },
  });
});

const listPendingDriverVehicles = asyncHandler(async (req, res) => {
  req.query.reviewStatus = 'pending';
  return listDriverVehiclesForReview(req, res);
});

const getDriverVehicleReviewDetails = asyncHandler(async (req, res) => {
  const { driverVehicleId } = req.params;
  ensureValidId(driverVehicleId, 'رقم مركبة السائق غير صحيح');

  const vehicle = await DriverVehicle.findById(driverVehicleId)
    .populate('accountId', 'name phone email roles isActive createdAt')
    .populate('reviewedBy', 'name phone email');

  if (!vehicle) {
    const error = new Error('مركبة السائق غير موجودة');
    error.statusCode = 404;
    throw error;
  }

  const status = await buildDriverReviewStatus(vehicle.accountId);

  return sendSuccess({
    res,
    message: 'تم جلب تفاصيل مراجعة المركبة بنجاح',
    doc: {
      vehicle,
      reviewStatus: status,
    },
  });
});

const approveDriverVehicleForAdmin = asyncHandler(async (req, res) => {
  const { driverVehicleId } = req.params;
  ensureValidId(driverVehicleId, 'رقم مركبة السائق غير صحيح');

  const doc = await approveDriverVehicle({
    driverVehicleId,
    req,
    reason: req.body.reason || '',
  });

  return sendSuccess({
    res,
    message: 'تمت الموافقة على المركبة بنجاح',
    doc,
  });
});

const rejectDriverVehicleForAdmin = asyncHandler(async (req, res) => {
  const { driverVehicleId } = req.params;
  ensureValidId(driverVehicleId, 'رقم مركبة السائق غير صحيح');

  const doc = await rejectOrRequestUpdateDriverVehicle({
    driverVehicleId,
    req,
    reason: req.body.rejectionReason || req.body.reason || '',
    action: 'rejected',
  });

  return sendSuccess({
    res,
    message: 'تم رفض المركبة بنجاح',
    doc,
  });
});

const requestDriverVehicleUpdateForAdmin = asyncHandler(async (req, res) => {
  const { driverVehicleId } = req.params;
  ensureValidId(driverVehicleId, 'رقم مركبة السائق غير صحيح');

  const doc = await rejectOrRequestUpdateDriverVehicle({
    driverVehicleId,
    req,
    reason: req.body.reason || req.body.rejectionReason || '',
    action: 'needs_update',
  });

  return sendSuccess({
    res,
    message: 'تم طلب تعديل بيانات المركبة بنجاح',
    doc,
  });
});

const listDriverReviewLogs = asyncHandler(async (req, res) => {
  const {
    accountId,
    driverProfileId,
    driverVehicleId,
    entityType,
    action,
    page = 1,
    limit = 50,
  } = req.query;

  const query = {};

  if (accountId) {
    ensureValidId(accountId, 'رقم الحساب غير صحيح');
    query.accountId = accountId;
  }

  if (driverProfileId) {
    ensureValidId(driverProfileId, 'رقم ملف السائق غير صحيح');
    query.driverProfileId = driverProfileId;
  }

  if (driverVehicleId) {
    ensureValidId(driverVehicleId, 'رقم مركبة السائق غير صحيح');
    query.driverVehicleId = driverVehicleId;
  }

  if (entityType) {
    query.entityType = entityType;
  }

  if (action) {
    query.action = action;
  }

  const total = await DriverReviewLog.countDocuments(query);
  const { limitNumber, skip, pagination } = buildPagination({ page, limit, total });

  const docs = await DriverReviewLog.find(query)
    .populate('accountId', 'name phone email')
    .populate('adminAccountId', 'name phone email')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNumber);

  return sendSuccess({
    res,
    message: 'تم جلب سجل مراجعة السائقين بنجاح',
    docs,
    extra: { pagination },
  });
});

module.exports = {
  listDriverProfilesForReview,
  listPendingDriverProfiles,
  getDriverProfileReviewDetails,
  approveDriverProfileForAdmin,
  rejectDriverProfileForAdmin,
  requestDriverProfileUpdateForAdmin,
  listDriverVehiclesForReview,
  listPendingDriverVehicles,
  getDriverVehicleReviewDetails,
  approveDriverVehicleForAdmin,
  rejectDriverVehicleForAdmin,
  requestDriverVehicleUpdateForAdmin,
  listDriverReviewLogs,
};
