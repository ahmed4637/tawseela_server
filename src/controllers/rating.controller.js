const Rating = require('../models/rating.model');
const ServiceRequest = require('../models/serviceRequest.model');
const DriverProfile = require('../models/driverProfile.model');
const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');

const updateDriverRatingAverage = async (driverAccountId) => {
  const result = await Rating.aggregate([
    {
      $match: {
        toAccountId: driverAccountId,
        toRole: 'driver',
      },
    },
    {
      $group: {
        _id: '$toAccountId',
        ratingAverage: { $avg: '$stars' },
        ratingCount: { $sum: 1 },
      },
    },
  ]);

  const stats = result[0];

  const driverProfile = await DriverProfile.findOne({
    accountId: driverAccountId,
  });

  if (!driverProfile) {
    return;
  }

  driverProfile.ratingAverage = stats
    ? Math.round(stats.ratingAverage * 10) / 10
    : 0;

  driverProfile.ratingCount = stats ? stats.ratingCount : 0;

  await driverProfile.save();
};

const createRating = asyncHandler(async (req, res) => {
  const { serviceRequestId, stars, comment } = req.body;

  const request = await ServiceRequest.findById(serviceRequestId);

  if (!request) {
    const error = new Error('الطلب غير موجود');
    error.statusCode = 404;
    throw error;
  }

  if (request.status !== 'completed') {
    const error = new Error('لا يمكن التقييم إلا بعد اكتمال الطلب');
    error.statusCode = 400;
    throw error;
  }

  const isCustomer = request.customerAccountId.toString() === req.accountId;
  const isDriver =
    request.acceptedDriverAccountId?.toString() === req.accountId;

  if (!isCustomer && !isDriver) {
    const error = new Error('غير مسموح لك بتقييم هذا الطلب');
    error.statusCode = 403;
    throw error;
  }

  const fromRole = isCustomer ? 'customer' : 'driver';
  const toRole = isCustomer ? 'driver' : 'customer';
  const toAccountId = isCustomer
    ? request.acceptedDriverAccountId
    : request.customerAccountId;

  if (!toAccountId) {
    const error = new Error('لا يوجد طرف آخر لتقييمه');
    error.statusCode = 400;
    throw error;
  }

  const doc = await Rating.findOneAndUpdate(
    {
      serviceRequestId: request._id,
      fromAccountId: req.accountId,
      toAccountId,
    },
    {
      serviceRequestId: request._id,
      fromAccountId: req.accountId,
      toAccountId,
      fromRole,
      toRole,
      stars,
      comment: comment || '',
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
    }
  );

  if (toRole === 'driver') {
    await updateDriverRatingAverage(toAccountId);
  }

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم حفظ التقييم بنجاح',
    doc,
  });
});

const getMyGivenRatings = asyncHandler(async (req, res) => {
  const docs = await Rating.find({
    fromAccountId: req.accountId,
  })
    .populate('toAccountId', 'name phone')
    .sort({ createdAt: -1 });

  return sendSuccess({
    res,
    message: 'تم جلب التقييمات التي قمت بها',
    docs,
  });
});

const getMyReceivedRatings = asyncHandler(async (req, res) => {
  const docs = await Rating.find({
    toAccountId: req.accountId,
  })
    .populate('fromAccountId', 'name phone')
    .sort({ createdAt: -1 });

  return sendSuccess({
    res,
    message: 'تم جلب التقييمات المستلمة',
    docs,
  });
});

const getAccountRatings = asyncHandler(async (req, res) => {
  const { accountId } = req.params;

  const role = req.query.role?.toString().trim() || '';
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const skip = (page - 1) * limit;

  if (!mongoose.Types.ObjectId.isValid(accountId)) {
    const error = new Error('رقم الحساب غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  if (role && !['customer', 'driver'].includes(role)) {
    const error = new Error('نوع الحساب غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const query = {
    toAccountId: new mongoose.Types.ObjectId(accountId),
  };

  if (role) {
    query.toRole = role;
  }

  const [statsResult, total, ratingDocs] = await Promise.all([
    Rating.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$toAccountId',
          ratingAverage: { $avg: '$stars' },
          ratingCount: { $sum: 1 },
        },
      },
    ]),

    Rating.countDocuments(query),

    Rating.find(query)
      .populate('fromAccountId', 'name profileImage image photo avatar')
      .populate('serviceRequestId', 'serviceType createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
  ]);

  const docs = ratingDocs.map((item) => item.toObject());

  const stats = statsResult[0];

  const latestReview =
    docs.find((item) => item.comment?.toString().trim().length > 0) || null;

  return sendSuccess({
    res,
    message: 'تم جلب تقييمات الحساب بنجاح',
    doc: {
      summary: {
        ratingAverage: stats
          ? Math.round((stats.ratingAverage || 0) * 10) / 10
          : 0,
        ratingCount: stats ? stats.ratingCount : 0,
        page,
        limit,
        total,
        hasMore: skip + docs.length < total,
      },
      latestReview,
    },
    docs,
  });
});

module.exports = {
  createRating,
  getMyGivenRatings,
  getMyReceivedRatings,
  getAccountRatings,
};