const mongoose = require('mongoose');

const Account = require('../models/account.model');
const DriverProfile = require('../models/driverProfile.model');
const ServiceRequest = require('../models/serviceRequest.model');
const ServiceOffer = require('../models/serviceOffer.model');
const CommissionTransaction = require('../models/commissionTransaction.model');
const DriverWallet = require('../models/driverWallet.model');
const DriverLedgerTransaction = require('../models/driverLedgerTransaction.model');
const PromoRedemption = require('../models/promoRedemption.model');
const LoyaltyTransaction = require('../models/loyaltyTransaction.model');
const PenaltyLog = require('../models/penaltyLog.model');
const Complaint = require('../models/complaint.model');
const SupportTicket = require('../models/supportTicket.model');
const Notification = require('../models/notification.model');

const ACTIVE_REQUEST_STATUSES = [
  'pending_offers',
  'negotiating',
  'offer_accepted',
  'driver_arriving',
  'arrived_to_pickup',
  'in_progress',
];

const TRIP_ACTIVE_STATUSES = [
  'offer_accepted',
  'driver_arriving',
  'arrived_to_pickup',
  'in_progress',
];

const CANCELLATION_STATUSES = [
  'cancelled_by_customer',
  'cancelled_by_driver',
  'expired',
  'driver_no_show',
  'customer_no_show',
];

const money = (value) => Math.round(Number(value || 0) * 100) / 100;

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

const startOfWeek = () => {
  const today = startOfToday();
  const day = today.getDay();
  const diff = day === 0 ? 6 : day - 1;
  today.setDate(today.getDate() - diff);
  return today;
};

const startOfMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
};

const startOfYear = () => {
  const now = new Date();
  return new Date(now.getFullYear(), 0, 1);
};

const endOfDay = (date) => {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
};

const parseDateRange = (query = {}) => {
  const period = query.period || 'today';
  let from;
  let to;

  if (query.from) {
    from = new Date(query.from);
  }

  if (query.to) {
    to = endOfDay(new Date(query.to));
  }

  if (!from) {
    if (period === 'week') from = startOfWeek();
    else if (period === 'month') from = startOfMonth();
    else if (period === 'year') from = startOfYear();
    else from = startOfToday();
  }

  if (!to || Number.isNaN(to.getTime())) {
    to = new Date();
  }

  if (Number.isNaN(from.getTime())) {
    from = startOfToday();
  }

  return { from, to, period };
};

const dateMatch = (field, range) => ({
  [field]: {
    $gte: range.from,
    $lte: range.to,
  },
});

const buildRequestFilters = (query = {}, range, dateField = 'createdAt') => {
  const filters = dateMatch(dateField, range);

  if (query.status) filters.status = query.status;
  if (query.serviceType) filters.serviceType = query.serviceType;
  if (query.vehicleTypeCode) filters.vehicleTypeCode = query.vehicleTypeCode.toString().toLowerCase();

  if (query.customerAccountId && mongoose.isValidObjectId(query.customerAccountId)) {
    filters.customerAccountId = query.customerAccountId;
  }

  if (query.driverAccountId && mongoose.isValidObjectId(query.driverAccountId)) {
    filters.acceptedDriverAccountId = query.driverAccountId;
  }

  return filters;
};

const aggregateRequestMoney = async (filters) => {
  const [row] = await ServiceRequest.aggregate([
    { $match: filters },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        finalPrice: { $sum: { $ifNull: ['$finalPrice', 0] } },
        estimatedPrice: { $sum: { $ifNull: ['$estimatedPrice', 0] } },
        customerOfferedPrice: { $sum: { $ifNull: ['$customerOfferedPrice', 0] } },
        customerPayablePrice: { $sum: { $ifNull: ['$customerPayablePrice', 0] } },
        appCoveredDiscountAmount: { $sum: { $ifNull: ['$appCoveredDiscountAmount', 0] } },
        grossCommissionAmount: { $sum: { $ifNull: ['$grossCommissionAmount', 0] } },
        driverPromoDiscountAmount: { $sum: { $ifNull: ['$driverPromoDiscountAmount', 0] } },
        commissionAmount: { $sum: { $ifNull: ['$commissionAmount', 0] } },
        driverNetAmount: { $sum: { $ifNull: ['$driverNetAmount', 0] } },
      },
    },
  ]);

  return {
    count: row?.count || 0,
    finalPrice: money(row?.finalPrice),
    estimatedPrice: money(row?.estimatedPrice),
    customerOfferedPrice: money(row?.customerOfferedPrice),
    customerPayablePrice: money(row?.customerPayablePrice),
    appCoveredDiscountAmount: money(row?.appCoveredDiscountAmount),
    grossCommissionAmount: money(row?.grossCommissionAmount),
    driverPromoDiscountAmount: money(row?.driverPromoDiscountAmount),
    commissionAmount: money(row?.commissionAmount),
    driverNetAmount: money(row?.driverNetAmount),
  };
};

const countByField = async (Model, filters, field) => {
  return Model.aggregate([
    { $match: filters },
    {
      $group: {
        _id: `$${field}`,
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ]);
};

const countDocumentsSafe = (Model, filters = {}) => Model.countDocuments(filters);

const getOverviewReport = async (query = {}) => {
  const range = parseDateRange(query);
  const createdFilters = buildRequestFilters(query, range, 'createdAt');
  const completedFilters = buildRequestFilters(query, range, 'completedAt');
  completedFilters.status = 'completed';

  const [
    accountsTotal,
    customersTotal,
    driversTotal,
    adminTotal,
    onlineDrivers,
    approvedDrivers,
    blockedDebtDrivers,
    activeRequests,
    activeTrips,
    openComplaints,
    openSupportTickets,
    pendingDriverReviews,
    requestsMoney,
    completedMoney,
    penaltiesCount,
    notificationsFailed,
  ] = await Promise.all([
    countDocumentsSafe(Account, {}),
    countDocumentsSafe(Account, { roles: 'customer' }),
    countDocumentsSafe(Account, { roles: 'driver' }),
    countDocumentsSafe(Account, { roles: 'admin' }),
    countDocumentsSafe(DriverProfile, { isOnline: true }),
    countDocumentsSafe(DriverProfile, { isApproved: true, reviewStatus: 'approved' }),
    countDocumentsSafe(DriverProfile, { isBlockedForDebt: true }),
    countDocumentsSafe(ServiceRequest, { status: { $in: ACTIVE_REQUEST_STATUSES } }),
    countDocumentsSafe(ServiceRequest, { status: { $in: TRIP_ACTIVE_STATUSES } }),
    countDocumentsSafe(Complaint, { status: { $in: ['open', 'under_review', 'in_review'] } }),
    countDocumentsSafe(SupportTicket, { status: { $in: ['open', 'pending_user', 'pending_admin'] } }),
    countDocumentsSafe(DriverProfile, { reviewStatus: 'pending' }),
    aggregateRequestMoney(createdFilters),
    aggregateRequestMoney(completedFilters),
    countDocumentsSafe(PenaltyLog, dateMatch('createdAt', range)),
    countDocumentsSafe(Notification, {
      ...dateMatch('createdAt', range),
      pushStatus: { $in: ['failed', 'partial'] },
    }),
  ]);

  return {
    range,
    totals: {
      accountsTotal,
      customersTotal,
      driversTotal,
      adminTotal,
      onlineDrivers,
      approvedDrivers,
      blockedDebtDrivers,
      pendingDriverReviews,
      activeRequests,
      activeTrips,
      openComplaints,
      openSupportTickets,
      penaltiesCount,
      notificationsFailed,
    },
    requests: requestsMoney,
    completedTrips: completedMoney,
  };
};

const getTripsReport = async (query = {}) => {
  const range = parseDateRange(query);
  const filters = buildRequestFilters(query, range, query.dateField || 'createdAt');

  const [statusBreakdown, serviceBreakdown, vehicleBreakdown, moneySummary, docs] = await Promise.all([
    countByField(ServiceRequest, filters, 'status'),
    countByField(ServiceRequest, filters, 'serviceType'),
    countByField(ServiceRequest, filters, 'vehicleTypeCode'),
    aggregateRequestMoney(filters),
    ServiceRequest.find(filters)
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(query.limit || 50), 200))
      .select('requestCode serviceType vehicleTypeCode vehicleTypeName status customerAccountId acceptedDriverAccountId customerOfferedPrice customerPayablePrice finalPrice commissionAmount appCoveredDiscountAmount createdAt completedAt cancelledAt')
      .lean(),
  ]);

  return {
    range,
    filters,
    summary: moneySummary,
    breakdowns: {
      byStatus: statusBreakdown,
      byServiceType: serviceBreakdown,
      byVehicleType: vehicleBreakdown,
    },
    docs,
  };
};

const getRevenueReport = async (query = {}) => {
  const range = parseDateRange(query);
  const completedFilters = buildRequestFilters(query, range, 'completedAt');
  completedFilters.status = 'completed';

  const [requestMoney, commissionRows, walletRows] = await Promise.all([
    aggregateRequestMoney(completedFilters),
    CommissionTransaction.aggregate([
      { $match: dateMatch('createdAt', range) },
      {
        $group: {
          _id: null,
          grossCommissionAmount: { $sum: { $ifNull: ['$grossCommissionAmount', 0] } },
          driverPromoDiscountAmount: { $sum: { $ifNull: ['$driverPromoDiscountAmount', 0] } },
          netCommissionAmount: { $sum: { $ifNull: ['$amount', 0] } },
          paidAmount: { $sum: { $ifNull: ['$paidAmount', 0] } },
          count: { $sum: 1 },
        },
      },
    ]),
    DriverWallet.aggregate([
      {
        $group: {
          _id: null,
          totalPayableBalance: { $sum: { $ifNull: ['$payableBalance', 0] } },
          totalDebtAmount: { $sum: { $ifNull: ['$debtAmount', 0] } },
          totalPaidToApp: { $sum: { $ifNull: ['$totalPaidToApp', 0] } },
          totalPaidToDriver: { $sum: { $ifNull: ['$totalPaidToDriver', 0] } },
        },
      },
    ]),
  ]);

  const commission = commissionRows[0] || {};
  const wallet = walletRows[0] || {};

  return {
    range,
    trips: requestMoney,
    commission: {
      count: commission.count || 0,
      grossCommissionAmount: money(commission.grossCommissionAmount),
      driverPromoDiscountAmount: money(commission.driverPromoDiscountAmount),
      netCommissionAmount: money(commission.netCommissionAmount),
      paidAmount: money(commission.paidAmount),
    },
    wallet: {
      totalPayableBalance: money(wallet.totalPayableBalance),
      totalDebtAmount: money(wallet.totalDebtAmount),
      totalPaidToApp: money(wallet.totalPaidToApp),
      totalPaidToDriver: money(wallet.totalPaidToDriver),
      netAppPosition: money(Number(wallet.totalDebtAmount || 0) - Number(wallet.totalPayableBalance || 0)),
    },
  };
};

const getCommissionReport = async (query = {}) => {
  const range = parseDateRange(query);
  const filters = dateMatch('createdAt', range);

  if (query.driverAccountId && mongoose.isValidObjectId(query.driverAccountId)) {
    filters.driverAccountId = query.driverAccountId;
  }
  if (query.status) filters.status = query.status;

  const [statusBreakdown, rows, docs] = await Promise.all([
    countByField(CommissionTransaction, filters, 'status'),
    CommissionTransaction.aggregate([
      { $match: filters },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          finalPrice: { $sum: { $ifNull: ['$finalPrice', 0] } },
          grossCommissionAmount: { $sum: { $ifNull: ['$grossCommissionAmount', 0] } },
          driverPromoDiscountAmount: { $sum: { $ifNull: ['$driverPromoDiscountAmount', 0] } },
          amount: { $sum: { $ifNull: ['$amount', 0] } },
          paidAmount: { $sum: { $ifNull: ['$paidAmount', 0] } },
        },
      },
    ]),
    CommissionTransaction.find(filters)
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(query.limit || 50), 200))
      .populate('driverAccountId', 'name phone')
      .select('driverAccountId serviceRequestId finalPrice grossCommissionAmount driverPromoDiscountAmount amount paidAmount status createdAt')
      .lean(),
  ]);

  const row = rows[0] || {};

  return {
    range,
    filters,
    summary: {
      count: row.count || 0,
      finalPrice: money(row.finalPrice),
      grossCommissionAmount: money(row.grossCommissionAmount),
      driverPromoDiscountAmount: money(row.driverPromoDiscountAmount),
      netCommissionAmount: money(row.amount),
      paidAmount: money(row.paidAmount),
      remainingAmount: money(Number(row.amount || 0) - Number(row.paidAmount || 0)),
    },
    breakdowns: {
      byStatus: statusBreakdown,
    },
    docs,
  };
};

const getDriversReport = async (query = {}) => {
  const range = parseDateRange(query);

  const [
    totalDrivers,
    approvedDrivers,
    pendingDrivers,
    rejectedDrivers,
    onlineDrivers,
    blockedDebtDrivers,
    wallets,
    topDrivers,
  ] = await Promise.all([
    countDocumentsSafe(Account, { roles: 'driver' }),
    countDocumentsSafe(DriverProfile, { reviewStatus: 'approved', isApproved: true }),
    countDocumentsSafe(DriverProfile, { reviewStatus: 'pending' }),
    countDocumentsSafe(DriverProfile, { reviewStatus: 'rejected' }),
    countDocumentsSafe(DriverProfile, { isOnline: true }),
    countDocumentsSafe(DriverProfile, { isBlockedForDebt: true }),
    DriverWallet.aggregate([
      {
        $group: {
          _id: null,
          debtAmount: { $sum: { $ifNull: ['$debtAmount', 0] } },
          payableBalance: { $sum: { $ifNull: ['$payableBalance', 0] } },
          totalTripFare: { $sum: { $ifNull: ['$totalTripFare', 0] } },
          totalNetCommission: { $sum: { $ifNull: ['$totalNetCommission', 0] } },
        },
      },
    ]),
    ServiceRequest.aggregate([
      {
        $match: {
          status: 'completed',
          completedAt: { $gte: range.from, $lte: range.to },
          acceptedDriverAccountId: { $ne: null },
        },
      },
      {
        $group: {
          _id: '$acceptedDriverAccountId',
          completedTrips: { $sum: 1 },
          finalPrice: { $sum: { $ifNull: ['$finalPrice', 0] } },
          commissionAmount: { $sum: { $ifNull: ['$commissionAmount', 0] } },
        },
      },
      { $sort: { completedTrips: -1, finalPrice: -1 } },
      { $limit: Math.min(Number(query.limit || 20), 100) },
      {
        $lookup: {
          from: 'accounts',
          localField: '_id',
          foreignField: '_id',
          as: 'account',
        },
      },
      { $unwind: { path: '$account', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          driverAccountId: '$_id',
          completedTrips: 1,
          finalPrice: 1,
          commissionAmount: 1,
          driverName: '$account.name',
          driverPhone: '$account.phone',
        },
      },
    ]),
  ]);

  const wallet = wallets[0] || {};

  return {
    range,
    summary: {
      totalDrivers,
      approvedDrivers,
      pendingDrivers,
      rejectedDrivers,
      onlineDrivers,
      blockedDebtDrivers,
      debtAmount: money(wallet.debtAmount),
      payableBalance: money(wallet.payableBalance),
      totalTripFare: money(wallet.totalTripFare),
      totalNetCommission: money(wallet.totalNetCommission),
    },
    topDrivers,
  };
};

const getCustomersReport = async (query = {}) => {
  const range = parseDateRange(query);

  const [totalCustomers, activeCustomers, newCustomers, topCustomers] = await Promise.all([
    countDocumentsSafe(Account, { roles: 'customer' }),
    ServiceRequest.distinct('customerAccountId', dateMatch('createdAt', range)).then((ids) => ids.length),
    countDocumentsSafe(Account, { roles: 'customer', ...dateMatch('createdAt', range) }),
    ServiceRequest.aggregate([
      { $match: { status: 'completed', completedAt: { $gte: range.from, $lte: range.to } } },
      {
        $group: {
          _id: '$customerAccountId',
          completedTrips: { $sum: 1 },
          finalPrice: { $sum: { $ifNull: ['$finalPrice', 0] } },
          customerDiscountAmount: { $sum: { $ifNull: ['$customerDiscountAmount', 0] } },
        },
      },
      { $sort: { completedTrips: -1, finalPrice: -1 } },
      { $limit: Math.min(Number(query.limit || 20), 100) },
      {
        $lookup: {
          from: 'accounts',
          localField: '_id',
          foreignField: '_id',
          as: 'account',
        },
      },
      { $unwind: { path: '$account', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          customerAccountId: '$_id',
          completedTrips: 1,
          finalPrice: 1,
          customerDiscountAmount: 1,
          customerName: '$account.name',
          customerPhone: '$account.phone',
        },
      },
    ]),
  ]);

  return {
    range,
    summary: {
      totalCustomers,
      activeCustomers,
      newCustomers,
    },
    topCustomers,
  };
};

const getPromosReport = async (query = {}) => {
  const range = parseDateRange(query);
  const filters = dateMatch('createdAt', range);
  if (query.status) filters.status = query.status;
  if (query.accountRole) filters.accountRole = query.accountRole;

  const [byStatus, byRole, byAppliedTo, rows] = await Promise.all([
    countByField(PromoRedemption, filters, 'status'),
    countByField(PromoRedemption, filters, 'accountRole'),
    countByField(PromoRedemption, filters, 'appliedTo'),
    PromoRedemption.aggregate([
      { $match: filters },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          discountAmount: { $sum: { $ifNull: ['$discountAmount', 0] } },
        },
      },
    ]),
  ]);

  const row = rows[0] || {};

  return {
    range,
    summary: {
      count: row.count || 0,
      discountAmount: money(row.discountAmount),
    },
    breakdowns: { byStatus, byRole, byAppliedTo },
  };
};

const getLoyaltyReport = async (query = {}) => {
  const range = parseDateRange(query);
  const filters = dateMatch('createdAt', range);
  if (query.accountRole) filters.accountRole = query.accountRole;
  if (query.type) filters.type = query.type;

  const [byType, byRole, rows] = await Promise.all([
    countByField(LoyaltyTransaction, filters, 'type'),
    countByField(LoyaltyTransaction, filters, 'accountRole'),
    LoyaltyTransaction.aggregate([
      { $match: filters },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          points: { $sum: { $ifNull: ['$points', 0] } },
          earned: {
            $sum: {
              $cond: [{ $eq: ['$direction', 'credit'] }, { $ifNull: ['$points', 0] }, 0],
            },
          },
          deducted: {
            $sum: {
              $cond: [{ $eq: ['$direction', 'debit'] }, { $ifNull: ['$points', 0] }, 0],
            },
          },
        },
      },
    ]),
  ]);

  const row = rows[0] || {};

  return {
    range,
    summary: {
      count: row.count || 0,
      points: row.points || 0,
      earned: row.earned || 0,
      deducted: row.deducted || 0,
    },
    breakdowns: { byType, byRole },
  };
};

const getCancellationsReport = async (query = {}) => {
  const range = parseDateRange(query);
  const filters = buildRequestFilters(query, range, 'cancelledAt');
  filters.status = { $in: CANCELLATION_STATUSES };

  const [byStatus, byServiceType, byPenaltyType, rows] = await Promise.all([
    countByField(ServiceRequest, filters, 'status'),
    countByField(ServiceRequest, filters, 'serviceType'),
    countByField(PenaltyLog, dateMatch('createdAt', range), 'penaltyType'),
    ServiceRequest.aggregate([
      { $match: filters },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          customerOfferedPrice: { $sum: { $ifNull: ['$customerOfferedPrice', 0] } },
        },
      },
    ]),
  ]);

  const row = rows[0] || {};

  return {
    range,
    summary: {
      count: row.count || 0,
      customerOfferedPrice: money(row.customerOfferedPrice),
    },
    breakdowns: { byStatus, byServiceType, byPenaltyType },
  };
};

const getComplaintsReport = async (query = {}) => {
  const range = parseDateRange(query);
  const filters = dateMatch('createdAt', range);
  if (query.status) filters.status = query.status;
  if (query.priority) filters.priority = query.priority;

  const [byStatus, byPriority, byCategory, docs] = await Promise.all([
    countByField(Complaint, filters, 'status'),
    countByField(Complaint, filters, 'priority'),
    countByField(Complaint, filters, 'category'),
    Complaint.find(filters)
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(query.limit || 50), 200))
      .populate('fromAccountId', 'name phone')
      .populate('againstAccountId', 'name phone')
      .select('complaintCode serviceRequestId fromAccountId againstAccountId fromRole againstRole category title priority status createdAt updatedAt')
      .lean(),
  ]);

  return {
    range,
    summary: {
      count: await Complaint.countDocuments(filters),
    },
    breakdowns: { byStatus, byPriority, byCategory },
    docs,
  };
};

const getSupportReport = async (query = {}) => {
  const range = parseDateRange(query);
  const filters = dateMatch('createdAt', range);
  if (query.status) filters.status = query.status;
  if (query.priority) filters.priority = query.priority;

  const [byStatus, byPriority, byCategory, docs, count] = await Promise.all([
    countByField(SupportTicket, filters, 'status'),
    countByField(SupportTicket, filters, 'priority'),
    countByField(SupportTicket, filters, 'category'),
    SupportTicket.find(filters)
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(query.limit || 50), 200))
      .populate('accountId', 'name phone roles')
      .select('ticketCode accountId accountRole subject category priority status assignedAdminId lastMessage createdAt updatedAt')
      .lean(),
    SupportTicket.countDocuments(filters),
  ]);

  return {
    range,
    summary: { count },
    breakdowns: { byStatus, byPriority, byCategory },
    docs,
  };
};

const normalizeCsvValue = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value).replace(/"/g, '""');
  return String(value).replace(/"/g, '""');
};

const buildCsv = (rows = []) => {
  if (!rows.length) return '';

  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];

  rows.forEach((row) => {
    lines.push(headers.map((header) => `"${normalizeCsvValue(row[header])}"`).join(','));
  });

  return lines.join('\n');
};

module.exports = {
  ACTIVE_REQUEST_STATUSES,
  TRIP_ACTIVE_STATUSES,
  CANCELLATION_STATUSES,
  parseDateRange,
  dateMatch,
  getOverviewReport,
  getTripsReport,
  getRevenueReport,
  getCommissionReport,
  getDriversReport,
  getCustomersReport,
  getPromosReport,
  getLoyaltyReport,
  getCancellationsReport,
  getComplaintsReport,
  getSupportReport,
  buildCsv,
};
