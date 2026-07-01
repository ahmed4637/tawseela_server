const mongoose = require('mongoose');

const Account = require('../models/account.model');
const DriverProfile = require('../models/driverProfile.model');
const DriverVehicle = require('../models/driverVehicle.model');
const ServiceRequest = require('../models/serviceRequest.model');
const ServiceOffer = require('../models/serviceOffer.model');
const Rating = require('../models/rating.model');
const Complaint = require('../models/complaint.model');
const CommissionTransaction = require('../models/commissionTransaction.model');
const DriverPayment = require('../models/driverPayment.model');
const Vehicle = require('../models/vehicle.model');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const { createNotification } = require('../services/notification.service');
const { cancelPromoReservationsForRequest } = require('../services/promo.service');
const { emitToAccount, emitToAdmins, emitToVehicle, emitToRequest } = require('../sockets/socket.server');
const {
  approveDriverProfile: approveDriverProfileReview,
  rejectOrRequestUpdateDriverProfile,
  approveDriverVehicle: approveDriverVehicleReview,
  rejectOrRequestUpdateDriverVehicle,
} = require('../services/driverReview.service');

const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

const ensureValidId = (id, message) => {
  if (!isValidObjectId(id)) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  }
};

const buildPagination = ({ page = 1, limit = 30, total = 0 }) => {
  const pageNumber = Math.max(Number(page) || 1, 1);
  const limitNumber = Math.min(Math.max(Number(limit) || 30, 1), 100);

  return {
    pageNumber,
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

const buildAccountSearchQuery = (search) => {
  if (!search) {
    return {};
  }

  const regex = new RegExp(search.toString().trim(), 'i');

  return {
    $or: [
      { name: regex },
      { phone: regex },
      { email: regex },
    ],
  };
};

const buildDateRangeQuery = (query) => {
  const {
    period,
    dateFrom,
    dateTo,
    year,
    month,
  } = query;

  const now = new Date();
  let startDate = null;
  let endDate = null;

  if (dateFrom || dateTo) {
    if (dateFrom) {
      startDate = new Date(dateFrom);
      startDate.setHours(0, 0, 0, 0);
    }

    if (dateTo) {
      endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
    }
  } else if (period === 'daily') {
    startDate = new Date(now);
    startDate.setHours(0, 0, 0, 0);

    endDate = new Date(now);
    endDate.setHours(23, 59, 59, 999);
  } else if (period === 'monthly') {
    const selectedYear = Number(year) || now.getFullYear();
    const selectedMonth = Number(month) || now.getMonth() + 1;

    startDate = new Date(selectedYear, selectedMonth - 1, 1, 0, 0, 0, 0);
    endDate = new Date(selectedYear, selectedMonth, 0, 23, 59, 59, 999);
  } else if (period === 'yearly') {
    const selectedYear = Number(year) || now.getFullYear();

    startDate = new Date(selectedYear, 0, 1, 0, 0, 0, 0);
    endDate = new Date(selectedYear, 11, 31, 23, 59, 59, 999);
  }

  if (!startDate && !endDate) {
    return {};
  }

  const createdAt = {};

  if (startDate) {
    createdAt.$gte = startDate;
  }

  if (endDate) {
    createdAt.$lte = endDate;
  }

  return {
    createdAt,
  };
};

const getAdminStats = asyncHandler(async (req, res) => {
  const [
    accountsCount,
    customersCount,
    driversCount,
    pendingDriversCount,
    pendingVehiclesCount,
    activeRequestsCount,
    completedRequestsCount,
    driversWithDebtCount,
    openComplaintsCount,
    ratingsCount,
  ] = await Promise.all([
    Account.countDocuments({ isActive: true }),
    Account.countDocuments({ roles: 'customer', isActive: true }),
    Account.countDocuments({ roles: 'driver', isActive: true }),
    DriverProfile.countDocuments({ reviewStatus: 'pending' }),
    DriverVehicle.countDocuments({ reviewStatus: 'pending', isActive: true }),
    ServiceRequest.countDocuments({
      status: {
        $in: [
          'pending_offers',
          'negotiating',
          'offer_accepted',
          'driver_arriving',
          'arrived_to_pickup',
          'in_progress',
        ],
      },
    }),
    ServiceRequest.countDocuments({ status: 'completed' }),
    DriverProfile.countDocuments({ commissionDebt: { $gt: 0 } }),
    Complaint.countDocuments({ status: { $in: ['open', 'under_review'] } }),
    Rating.countDocuments(),
  ]);

  return sendSuccess({
    res,
    message: 'تم جلب إحصائيات الأدمن بنجاح',
    doc: {
      accountsCount,
      customersCount,
      driversCount,
      pendingDriversCount,
      pendingVehiclesCount,
      activeRequestsCount,
      completedRequestsCount,
      driversWithDebtCount,
      openComplaintsCount,
      ratingsCount,
    },
  });
});

const getAllAccounts = asyncHandler(async (req, res) => {
  const {
    role,
    isActive,
    search,
    page = 1,
    limit = 30,
  } = req.query;

  const query = {
    ...buildAccountSearchQuery(search),
  };

  if (role) {
    query.roles = role;
  }

  if (isActive === 'true') {
    query.isActive = true;
  }

  if (isActive === 'false') {
    query.isActive = false;
  }

  const total = await Account.countDocuments(query);
  const { pageNumber, limitNumber, skip, pagination } = buildPagination({
    page,
    limit,
    total,
  });

  const docs = await Account.find(query)
    .select('-password')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNumber);

  return sendSuccess({
    res,
    message: 'تم جلب الحسابات بنجاح',
    docs,
    extra: {
      pagination,
    },
  });
});

const getAccountDetails = asyncHandler(async (req, res) => {
  const { accountId } = req.params;

  ensureValidId(accountId, 'رقم الحساب غير صحيح');

  const account = await Account.findById(accountId).select('-password');

  if (!account) {
    const error = new Error('الحساب غير موجود');
    error.statusCode = 404;
    throw error;
  }

  const [
    driverProfile,
    driverVehicles,
    customerRequestsCount,
    driverRequestsCount,
    givenRatingsCount,
    receivedRatingsCount,
    complaintsByAccountCount,
    complaintsAgainstAccountCount,
  ] = await Promise.all([
    DriverProfile.findOne({ accountId }),
    DriverVehicle.find({ accountId }).sort({ createdAt: -1 }),
    ServiceRequest.countDocuments({ customerAccountId: accountId }),
    ServiceRequest.countDocuments({ acceptedDriverAccountId: accountId }),
    Rating.countDocuments({ fromAccountId: accountId }),
    Rating.countDocuments({ toAccountId: accountId }),
    Complaint.countDocuments({ fromAccountId: accountId }),
    Complaint.countDocuments({ againstAccountId: accountId }),
  ]);

  return sendSuccess({
    res,
    message: 'تم جلب تفاصيل الحساب بنجاح',
    doc: {
      account,
      driverProfile,
      driverVehicles,
      stats: {
        customerRequestsCount,
        driverRequestsCount,
        givenRatingsCount,
        receivedRatingsCount,
        complaintsByAccountCount,
        complaintsAgainstAccountCount,
      },
    },
  });
});

const activateAccount = asyncHandler(async (req, res) => {
  const { accountId } = req.params;

  ensureValidId(accountId, 'رقم الحساب غير صحيح');

  const doc = await Account.findByIdAndUpdate(
    accountId,
    { isActive: true },
    { new: true, runValidators: true }
  ).select('-password');

  if (!doc) {
    const error = new Error('الحساب غير موجود');
    error.statusCode = 404;
    throw error;
  }

  await DriverProfile.findOneAndUpdate(
    { accountId },
    { isActive: true },
    { new: true }
  );

  return sendSuccess({
    res,
    message: 'تم تفعيل الحساب بنجاح',
    doc,
  });
});

const deactivateAccount = asyncHandler(async (req, res) => {
  const { accountId } = req.params;
  const { reason } = req.body;

  ensureValidId(accountId, 'رقم الحساب غير صحيح');

  if (accountId === req.accountId) {
    const error = new Error('لا يمكن تعطيل حسابك الحالي');
    error.statusCode = 400;
    throw error;
  }

  const doc = await Account.findByIdAndUpdate(
    accountId,
    { isActive: false },
    { new: true, runValidators: true }
  ).select('-password');

  if (!doc) {
    const error = new Error('الحساب غير موجود');
    error.statusCode = 404;
    throw error;
  }

  await DriverProfile.findOneAndUpdate(
    { accountId },
    {
      isActive: false,
      isOnline: false,
      isAvailable: false,
      blockedReason: reason || 'تم تعطيل الحساب من الإدارة',
    },
    { new: true }
  );

  return sendSuccess({
    res,
    message: 'تم تعطيل الحساب بنجاح',
    doc,
  });
});

const getCustomers = asyncHandler(async (req, res) => {
  req.query.role = 'customer';
  return getAllAccounts(req, res);
});

const getDrivers = asyncHandler(async (req, res) => {
  const {
    reviewStatus,
    isOnline,
    isBlockedForDebt,
    hasDebt,
    search,
    page = 1,
    limit = 30,
  } = req.query;

  const query = {};

  if (reviewStatus) {
    query.reviewStatus = reviewStatus;
  }

  if (isOnline === 'true') {
    query.isOnline = true;
  }

  if (isOnline === 'false') {
    query.isOnline = false;
  }

  if (isBlockedForDebt === 'true') {
    query.isBlockedForDebt = true;
  }

  if (isBlockedForDebt === 'false') {
    query.isBlockedForDebt = false;
  }

  if (hasDebt === 'true') {
    query.commissionDebt = { $gt: 0 };
  }

  if (search) {
    const accountIds = await Account.find({
      roles: 'driver',
      ...buildAccountSearchQuery(search),
    }).select('_id');

    query.accountId = {
      $in: accountIds.map((account) => account._id),
    };
  }

  const total = await DriverProfile.countDocuments(query);
  const { limitNumber, skip, pagination } = buildPagination({
    page,
    limit,
    total,
  });

  const docs = await DriverProfile.find(query)
    .populate('accountId', 'name phone email roles isActive createdAt')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNumber);

  return sendSuccess({
    res,
    message: 'تم جلب السائقين بنجاح',
    docs,
    extra: {
      pagination,
    },
  });
});

const getPendingDrivers = asyncHandler(async (req, res) => {
  const docs = await DriverProfile.find({
    reviewStatus: 'pending',
  })
    .populate('accountId', 'name phone email roles isActive createdAt')
    .sort({ createdAt: -1 });

  return sendSuccess({
    res,
    message: 'تم جلب السائقين تحت المراجعة بنجاح',
    docs,
  });
});

const approveDriverProfile = asyncHandler(async (req, res) => {
  const { driverProfileId } = req.params;

  ensureValidId(driverProfileId, 'رقم ملف السائق غير صحيح');

  const doc = await approveDriverProfileReview({
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

const rejectDriverProfile = asyncHandler(async (req, res) => {
  const { driverProfileId } = req.params;
  const { rejectionReason, reason } = req.body;

  ensureValidId(driverProfileId, 'رقم ملف السائق غير صحيح');

  const doc = await rejectOrRequestUpdateDriverProfile({
    driverProfileId,
    req,
    reason: rejectionReason || reason || '',
    action: 'rejected',
  });

  return sendSuccess({
    res,
    message: 'تم رفض السائق بنجاح',
    doc,
  });
});

const getAllDriverVehicles = asyncHandler(async (req, res) => {
  const {
    reviewStatus,
    vehicleTypeCode,
    accountId,
    isActive,
    page = 1,
    limit = 30,
  } = req.query;

  const query = {};

  if (reviewStatus) {
    query.reviewStatus = reviewStatus;
  }

  if (vehicleTypeCode) {
    query.vehicleTypeCode = vehicleTypeCode.toString().trim().toLowerCase();
  }

  if (accountId) {
    ensureValidId(accountId, 'رقم الحساب غير صحيح');
    query.accountId = accountId;
  }

  if (isActive === 'true') {
    query.isActive = true;
  }

  if (isActive === 'false') {
    query.isActive = false;
  }

  const total = await DriverVehicle.countDocuments(query);
  const { limitNumber, skip, pagination } = buildPagination({
    page,
    limit,
    total,
  });

  const docs = await DriverVehicle.find(query)
    .populate('accountId', 'name phone email roles isActive createdAt')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNumber);

  return sendSuccess({
    res,
    message: 'تم جلب مركبات السائقين بنجاح',
    docs,
    extra: {
      pagination,
    },
  });
});

const getPendingDriverVehicles = asyncHandler(async (req, res) => {
  const docs = await DriverVehicle.find({
    reviewStatus: 'pending',
    isActive: true,
  })
    .populate('accountId', 'name phone email roles isActive createdAt')
    .sort({ createdAt: -1 });

  return sendSuccess({
    res,
    message: 'تم جلب المركبات تحت المراجعة بنجاح',
    docs,
  });
});

const approveDriverVehicle = asyncHandler(async (req, res) => {
  const { driverVehicleId } = req.params;

  ensureValidId(driverVehicleId, 'رقم مركبة السائق غير صحيح');

  const doc = await approveDriverVehicleReview({
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

const rejectDriverVehicle = asyncHandler(async (req, res) => {
  const { driverVehicleId } = req.params;
  const { rejectionReason, reason } = req.body;

  ensureValidId(driverVehicleId, 'رقم مركبة السائق غير صحيح');

  const doc = await rejectOrRequestUpdateDriverVehicle({
    driverVehicleId,
    req,
    reason: rejectionReason || reason || '',
    action: 'rejected',
  });

  return sendSuccess({
    res,
    message: 'تم رفض المركبة بنجاح',
    doc,
  });
});

const getDriversWithDebts = asyncHandler(async (req, res) => {
  const docs = await DriverProfile.find({
    commissionDebt: { $gt: 0 },
  })
    .populate('accountId', 'name phone email roles isActive createdAt')
    .sort({ commissionDebt: -1 });

  return sendSuccess({
    res,
    message: 'تم جلب السائقين أصحاب المديونيات بنجاح',
    docs,
  });
});

const getAllServiceRequestsForAdmin = asyncHandler(async (req, res) => {
  const {
    status,
    serviceType,
    page = 1,
    limit = 30,
  } = req.query;

  const query = {};

  if (status) {
    query.status = status;
  }

  if (serviceType) {
    query.serviceType = serviceType;
  }

  const total = await ServiceRequest.countDocuments(query);
  const { limitNumber, skip, pagination } = buildPagination({
    page,
    limit,
    total,
  });

  const docs = await ServiceRequest.find(query)
    .populate('customerAccountId', 'name phone email')
    .populate('acceptedDriverAccountId', 'name phone email')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNumber);

  return sendSuccess({
    res,
    message: 'تم جلب الطلبات بنجاح',
    docs,
    extra: {
      pagination,
    },
  });
});

const getAllRatingsForAdmin = asyncHandler(async (req, res) => {
  const {
    fromRole,
    toRole,
    page = 1,
    limit = 30,
  } = req.query;

  const query = {};

  if (fromRole) {
    query.fromRole = fromRole;
  }

  if (toRole) {
    query.toRole = toRole;
  }

  const total = await Rating.countDocuments(query);
  const { limitNumber, skip, pagination } = buildPagination({
    page,
    limit,
    total,
  });

  const docs = await Rating.find(query)
    .populate('fromAccountId', 'name phone email')
    .populate('toAccountId', 'name phone email')
    .populate('serviceRequestId')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNumber);

  return sendSuccess({
    res,
    message: 'تم جلب التقييمات بنجاح',
    docs,
    extra: {
      pagination,
    },
  });
});

const getFinanceSummary = asyncHandler(async (req, res) => {
  const dateQuery = buildDateRangeQuery(req.query);

  const [
    unpaidCommissionAgg,
    paidCommissionAgg,
    confirmedPaymentsAgg,
    driversWithDebtCount,
    blockedForDebtCount,
    recentPayments,
    recentCommissions,
  ] = await Promise.all([
    CommissionTransaction.aggregate([
      { $match: { status: 'unpaid', ...dateQuery } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),

    CommissionTransaction.aggregate([
     { $match: { status: 'paid', ...dateQuery } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),

    DriverPayment.aggregate([
     { $match: { status: 'confirmed', ...dateQuery } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),

    DriverProfile.countDocuments({ commissionDebt: { $gt: 0 } }),

    DriverProfile.countDocuments({ isBlockedForDebt: true }),

   DriverPayment.find({ status: 'confirmed', ...dateQuery })
      .populate('driverAccountId', 'name phone email')
      .sort({ createdAt: -1 })
      .limit(10),

   CommissionTransaction.find(dateQuery)
      .populate('driverAccountId', 'name phone email')
      .sort({ createdAt: -1 })
      .limit(10),
  ]);

  return sendSuccess({
    res,
    message: 'تم جلب الملخص المالي بنجاح',
    doc: {
  period: {
    period: req.query.period || '',
    dateFrom: req.query.dateFrom || '',
    dateTo: req.query.dateTo || '',
    year: req.query.year || '',
    month: req.query.month || '',
  },
  unpaidCommissions: {
        total: unpaidCommissionAgg[0]?.total || 0,
        count: unpaidCommissionAgg[0]?.count || 0,
      },
      paidCommissions: {
        total: paidCommissionAgg[0]?.total || 0,
        count: paidCommissionAgg[0]?.count || 0,
      },
      confirmedPayments: {
        total: confirmedPaymentsAgg[0]?.total || 0,
        count: confirmedPaymentsAgg[0]?.count || 0,
      },
      driversWithDebtCount,
      blockedForDebtCount,
      recentPayments,
      recentCommissions,
    },
  });
});

const getCommissionTransactionsForAdmin = asyncHandler(async (req, res) => {
  const {
    status,
    driverAccountId,
    page = 1,
    limit = 30,
  } = req.query;

  const query = {};

  Object.assign(query, buildDateRangeQuery(req.query));

  if (status) {
    query.status = status;
  }

  if (driverAccountId) {
    ensureValidId(driverAccountId, 'رقم حساب السائق غير صحيح');
    query.driverAccountId = driverAccountId;
  }

  const total = await CommissionTransaction.countDocuments(query);
  const { limitNumber, skip, pagination } = buildPagination({
    page,
    limit,
    total,
  });

  const docs = await CommissionTransaction.find(query)
    .populate('driverAccountId', 'name phone email')
    .populate('serviceRequestId')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNumber);

  return sendSuccess({
    res,
    message: 'تم جلب معاملات العمولة بنجاح',
    docs,
    extra: {
      pagination,
    },
  });
});

const getDriverPaymentsForAdmin = asyncHandler(async (req, res) => {
  const {
    driverAccountId,
    method,
    page = 1,
    limit = 30,
  } = req.query;

  const query = {};

  Object.assign(query, buildDateRangeQuery(req.query));

  if (driverAccountId) {
    ensureValidId(driverAccountId, 'رقم حساب السائق غير صحيح');
    query.driverAccountId = driverAccountId;
  }

  if (method) {
    query.method = method;
  }

  const total = await DriverPayment.countDocuments(query);
  const { limitNumber, skip, pagination } = buildPagination({
    page,
    limit,
    total,
  });

  const docs = await DriverPayment.find(query)
    .populate('driverAccountId', 'name phone email')
    .populate('receivedByAdminId', 'name phone email')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNumber);

  return sendSuccess({
    res,
    message: 'تم جلب مدفوعات السائقين بنجاح',
    docs,
    extra: {
      pagination,
    },
  });
});

const getServiceRequestDetailsForAdmin = asyncHandler(async (req, res) => {
  const { requestId } = req.params;

  ensureValidId(requestId, 'رقم الطلب غير صحيح');

  const doc = await ServiceRequest.findById(requestId)
    .populate('customerAccountId', 'name phone email profileImage isActive')
    .populate('acceptedDriverAccountId', 'name phone email profileImage isActive')
    .populate('acceptedDriverVehicleId')
    .populate('vehicleTypeId');

  if (!doc) {
    const error = new Error('الطلب غير موجود');
    error.statusCode = 404;
    throw error;
  }

  const [ratings, complaints] = await Promise.all([
    Rating.find({ serviceRequestId: requestId })
      .populate('fromAccountId', 'name phone email')
      .populate('toAccountId', 'name phone email')
      .sort({ createdAt: -1 }),

    Complaint.find({ serviceRequestId: requestId })
      .populate('fromAccountId', 'name phone email')
      .populate('againstAccountId', 'name phone email')
      .populate('resolvedByAdminId', 'name phone email')
      .sort({ createdAt: -1 }),
  ]);

  return sendSuccess({
    res,
    message: 'تم جلب تفاصيل الطلب بنجاح',
    doc: {
      request: doc,
      ratings,
      complaints,
    },
  });
});

const cancelServiceRequestForAdmin = asyncHandler(async (req, res) => {
  const { requestId } = req.params;
  const { reason } = req.body;

  ensureValidId(requestId, 'رقم الطلب غير صحيح');

  const doc = await ServiceRequest.findById(requestId);

  if (!doc) {
    const error = new Error('الطلب غير موجود');
    error.statusCode = 404;
    throw error;
  }

  if (doc.status === 'completed') {
    const error = new Error('لا يمكن إلغاء رحلة مكتملة');
    error.statusCode = 400;
    throw error;
  }

  if (
    doc.status === 'cancelled_by_customer' ||
    doc.status === 'cancelled_by_driver' ||
    doc.status === 'cancelled_by_admin' ||
    doc.status === 'expired' ||
    doc.status === 'driver_no_show' ||
    doc.status === 'customer_no_show'
  ) {
    const error = new Error('هذا الطلب منتهي بالفعل');
    error.statusCode = 400;
    throw error;
  }

  const cancellationReason = reason || 'تم إلغاء الطلب من الإدارة';
  const now = new Date();

  doc.status = 'cancelled_by_admin';
  doc.dispatchStatus = 'cancelled';
  doc.cancellationReason = cancellationReason;
  doc.cancelledAt = now;
  doc.lastStatusChangedAt = now;
  doc.lifecycleLockToken = null;
  doc.lifecycleLockReason = '';
  doc.lifecycleLockedAt = null;

  await doc.save();

  await ServiceOffer.updateMany(
    {
      serviceRequestId: doc._id,
      status: 'pending',
    },
    {
      status: 'cancelled',
      closedAt: now,
      closedBy: 'admin',
      closedReason: cancellationReason,
    }
  );

  await cancelPromoReservationsForRequest({ serviceRequestId: doc._id });

  if (doc.acceptedDriverAccountId) {
    await DriverProfile.findOneAndUpdate(
      { accountId: doc.acceptedDriverAccountId },
      {
        activeServiceRequestId: null,
        currentVehicleId: null,
        isAvailable: true,
      },
      { new: true }
    );
  }

  const notificationData = {
    serviceRequestId: doc._id,
    requestCode: doc.requestCode,
    status: doc.status,
    cancellationReason,
  };

  const notificationTargets = [doc.customerAccountId, doc.acceptedDriverAccountId]
    .filter(Boolean)
    .map((accountId) => accountId.toString());

  await Promise.all(
    [...new Set(notificationTargets)].map((accountId) =>
      createNotification({
        accountId,
        title: 'تم إلغاء الطلب من الإدارة',
        body: cancellationReason,
        type: 'request',
        data: notificationData,
      })
    )
  );

  const payload = {
    request: doc,
    status: doc.status,
    reason: cancellationReason,
  };

  emitToAccount(doc.customerAccountId.toString(), 'request:status-changed', payload);

  if (doc.acceptedDriverAccountId) {
    emitToAccount(doc.acceptedDriverAccountId.toString(), 'request:status-changed', payload);
  }

  if (doc.vehicleTypeCode) {
    emitToVehicle(doc.vehicleTypeCode, 'request:closed', payload);
  }

  emitToRequest(doc._id.toString(), 'request:status-changed', payload);
  emitToAdmins('admin:request-cancelled', payload);

  return sendSuccess({
    res,
    message: 'تم إلغاء الطلب من الإدارة بنجاح',
    doc,
  });
});

const getAllComplaintsForAdmin = asyncHandler(async (req, res) => {
  const {
    status,
    category,
    fromRole,
    page = 1,
    limit = 30,
  } = req.query;

  const query = {};

  if (status) {
    query.status = status;
  }

  if (category) {
    query.category = category;
  }

  if (fromRole) {
    query.fromRole = fromRole;
  }

  const total = await Complaint.countDocuments(query);
  const { limitNumber, skip, pagination } = buildPagination({
    page,
    limit,
    total,
  });

  const docs = await Complaint.find(query)
    .populate('serviceRequestId')
    .populate('fromAccountId', 'name phone email roles isActive')
    .populate('againstAccountId', 'name phone email roles isActive')
    .populate('resolvedByAdminId', 'name phone email')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNumber);

  return sendSuccess({
    res,
    message: 'تم جلب الشكاوى بنجاح',
    docs,
    extra: {
      pagination,
    },
  });
});

const getComplaintDetailsForAdmin = asyncHandler(async (req, res) => {
  const { complaintId } = req.params;

  ensureValidId(complaintId, 'رقم الشكوى غير صحيح');

  const doc = await Complaint.findById(complaintId)
    .populate('serviceRequestId')
    .populate('fromAccountId', 'name phone email roles isActive')
    .populate('againstAccountId', 'name phone email roles isActive')
    .populate('resolvedByAdminId', 'name phone email');

  if (!doc) {
    const error = new Error('الشكوى غير موجودة');
    error.statusCode = 404;
    throw error;
  }

  return sendSuccess({
    res,
    message: 'تم جلب تفاصيل الشكوى بنجاح',
    doc,
  });
});

const updateComplaintStatusForAdmin = asyncHandler(async (req, res) => {
  const { complaintId } = req.params;
  const { status, adminNote } = req.body;

  ensureValidId(complaintId, 'رقم الشكوى غير صحيح');

  const allowedStatuses = ['open', 'under_review', 'resolved', 'rejected'];

  if (!allowedStatuses.includes(status)) {
    const error = new Error('حالة الشكوى غير صحيحة');
    error.statusCode = 400;
    throw error;
  }

  const doc = await Complaint.findById(complaintId);

  if (!doc) {
    const error = new Error('الشكوى غير موجودة');
    error.statusCode = 404;
    throw error;
  }

  doc.status = status;
  doc.adminNote = adminNote?.toString().trim() || '';

  if (status === 'resolved' || status === 'rejected') {
    doc.resolvedByAdminId = req.accountId;
    doc.resolvedAt = new Date();
  } else {
    doc.resolvedByAdminId = null;
    doc.resolvedAt = null;
  }

  await doc.save();

  const populatedDoc = await Complaint.findById(doc._id)
    .populate('serviceRequestId')
    .populate('fromAccountId', 'name phone email roles isActive')
    .populate('againstAccountId', 'name phone email roles isActive')
    .populate('resolvedByAdminId', 'name phone email');

  return sendSuccess({
    res,
    message: 'تم تحديث حالة الشكوى بنجاح',
    doc: populatedDoc,
  });
});

const getAllVehiclesForAdmin = asyncHandler(async (req, res) => {
  const { isActive, category } = req.query;

  const query = {};

  if (isActive === 'true') {
    query.isActive = true;
  }

  if (isActive === 'false') {
    query.isActive = false;
  }

  if (category) {
    query.category = category;
  }

  const docs = await Vehicle.find(query).sort({ order: 1, createdAt: -1 });

  return sendSuccess({
    res,
    message: 'تم جلب أنواع المركبات بنجاح',
    docs,
  });
});

const createVehicleForAdmin = asyncHandler(async (req, res) => {
  const {
    name,
    code,
    category,
    description,
    seatsCount,
    maxLoadKg,
    canCarryPassengers,
    canCarryGoods,
    allowedServices,
    startPrice,
    pricePerKm,
    minPrice,
    commission,
    requiresLicense,
    isActive,
    order,
  } = req.body;

  const doc = await Vehicle.create({
    name,
    code,
    category,
    description,
    seatsCount,
    maxLoadKg,
    canCarryPassengers,
    canCarryGoods,
    allowedServices,
    startPrice,
    pricePerKm,
    minPrice,
    commission,
    requiresLicense,
    isActive,
    order,
  });

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم إنشاء نوع المركبة بنجاح',
    doc,
  });
});

const updateVehicleForAdmin = asyncHandler(async (req, res) => {
  const { vehicleId } = req.params;

  ensureValidId(vehicleId, 'رقم نوع المركبة غير صحيح');

  const allowedFields = [
    'name',
    'code',
    'category',
    'description',
    'seatsCount',
    'maxLoadKg',
    'canCarryPassengers',
    'canCarryGoods',
    'allowedServices',
    'startPrice',
    'pricePerKm',
    'minPrice',
    'commission',
    'requiresLicense',
    'isActive',
    'order',
  ];

  const updates = {};

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  });

  const doc = await Vehicle.findByIdAndUpdate(vehicleId, updates, {
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
    message: 'تم تحديث نوع المركبة بنجاح',
    doc,
  });
});

module.exports = {
  getAdminStats,

  getAllAccounts,
  getAccountDetails,
  activateAccount,
  deactivateAccount,
  getCustomers,
  getDrivers,

  getPendingDrivers,
  approveDriverProfile,
  rejectDriverProfile,

  getAllDriverVehicles,
  getPendingDriverVehicles,
  approveDriverVehicle,
  rejectDriverVehicle,

  getDriversWithDebts,
  getAllServiceRequestsForAdmin,
  getAllRatingsForAdmin,

  getFinanceSummary,
  getCommissionTransactionsForAdmin,
  getDriverPaymentsForAdmin,

  getServiceRequestDetailsForAdmin,
  cancelServiceRequestForAdmin,

  getAllComplaintsForAdmin,
  getComplaintDetailsForAdmin,
  updateComplaintStatusForAdmin,

  getAllVehiclesForAdmin,
  createVehicleForAdmin,
  updateVehicleForAdmin,
};