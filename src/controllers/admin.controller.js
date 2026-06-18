const mongoose = require('mongoose');

const Account = require('../models/account.model');
const DriverProfile = require('../models/driverProfile.model');
const DriverVehicle = require('../models/driverVehicle.model');
const ServiceRequest = require('../models/serviceRequest.model');
const Rating = require('../models/rating.model');
const Complaint = require('../models/complaint.model');
const CommissionTransaction = require('../models/commissionTransaction.model');
const DriverPayment = require('../models/driverPayment.model');

const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');

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

  const doc = await DriverProfile.findById(driverProfileId);

  if (!doc) {
    const error = new Error('ملف السائق غير موجود');
    error.statusCode = 404;
    throw error;
  }

  doc.isApproved = true;
  doc.reviewStatus = 'approved';
  doc.rejectionReason = '';
  doc.approvedAt = new Date();
  doc.isActive = true;

  await doc.save();

  return sendSuccess({
    res,
    message: 'تمت الموافقة على السائق بنجاح',
    doc,
  });
});

const rejectDriverProfile = asyncHandler(async (req, res) => {
  const { driverProfileId } = req.params;
  const { rejectionReason } = req.body;

  ensureValidId(driverProfileId, 'رقم ملف السائق غير صحيح');

  const doc = await DriverProfile.findById(driverProfileId);

  if (!doc) {
    const error = new Error('ملف السائق غير موجود');
    error.statusCode = 404;
    throw error;
  }

  doc.isApproved = false;
  doc.reviewStatus = 'rejected';
  doc.rejectionReason = rejectionReason || 'تم رفض طلب السائق';
  doc.approvedAt = null;

  await doc.save();

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

  const doc = await DriverVehicle.findById(driverVehicleId);

  if (!doc) {
    const error = new Error('مركبة السائق غير موجودة');
    error.statusCode = 404;
    throw error;
  }

  doc.isApproved = true;
  doc.reviewStatus = 'approved';
  doc.rejectionReason = '';
  doc.approvedAt = new Date();
  doc.isActive = true;

  await doc.save();

  return sendSuccess({
    res,
    message: 'تمت الموافقة على المركبة بنجاح',
    doc,
  });
});

const rejectDriverVehicle = asyncHandler(async (req, res) => {
  const { driverVehicleId } = req.params;
  const { rejectionReason } = req.body;

  ensureValidId(driverVehicleId, 'رقم مركبة السائق غير صحيح');

  const doc = await DriverVehicle.findById(driverVehicleId);

  if (!doc) {
    const error = new Error('مركبة السائق غير موجودة');
    error.statusCode = 404;
    throw error;
  }

  doc.isApproved = false;
  doc.reviewStatus = 'rejected';
  doc.rejectionReason = rejectionReason || 'تم رفض المركبة';
  doc.approvedAt = null;

  await doc.save();

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
      { $match: { status: 'unpaid' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),

    CommissionTransaction.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),

    DriverPayment.aggregate([
      { $match: { status: 'confirmed' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),

    DriverProfile.countDocuments({ commissionDebt: { $gt: 0 } }),

    DriverProfile.countDocuments({ isBlockedForDebt: true }),

    DriverPayment.find({ status: 'confirmed' })
      .populate('driverAccountId', 'name phone email')
      .sort({ createdAt: -1 })
      .limit(10),

    CommissionTransaction.find()
      .populate('driverAccountId', 'name phone email')
      .sort({ createdAt: -1 })
      .limit(10),
  ]);

  return sendSuccess({
    res,
    message: 'تم جلب الملخص المالي بنجاح',
    doc: {
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
};