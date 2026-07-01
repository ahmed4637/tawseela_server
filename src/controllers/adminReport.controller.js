const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const reportingService = require('../services/reporting.service');
const ServiceRequest = require('../models/serviceRequest.model');
const CommissionTransaction = require('../models/commissionTransaction.model');
const DriverLedgerTransaction = require('../models/driverLedgerTransaction.model');
const PromoRedemption = require('../models/promoRedemption.model');
const LoyaltyTransaction = require('../models/loyaltyTransaction.model');
const PenaltyLog = require('../models/penaltyLog.model');
const Complaint = require('../models/complaint.model');
const SupportTicket = require('../models/supportTicket.model');

const reportHandlers = {
  overview: reportingService.getOverviewReport,
  trips: reportingService.getTripsReport,
  revenue: reportingService.getRevenueReport,
  commissions: reportingService.getCommissionReport,
  drivers: reportingService.getDriversReport,
  customers: reportingService.getCustomersReport,
  promos: reportingService.getPromosReport,
  loyalty: reportingService.getLoyaltyReport,
  cancellations: reportingService.getCancellationsReport,
  complaints: reportingService.getComplaintsReport,
  support: reportingService.getSupportReport,
};

const getOverviewReport = asyncHandler(async (req, res) => {
  const doc = await reportingService.getOverviewReport(req.query);

  return sendSuccess({
    res,
    message: 'تم جلب ملخص التقارير بنجاح',
    doc,
  });
});

const getTripsReport = asyncHandler(async (req, res) => {
  const doc = await reportingService.getTripsReport(req.query);

  return sendSuccess({
    res,
    message: 'تم جلب تقرير الرحلات بنجاح',
    doc,
  });
});

const getRevenueReport = asyncHandler(async (req, res) => {
  const doc = await reportingService.getRevenueReport(req.query);

  return sendSuccess({
    res,
    message: 'تم جلب تقرير الإيرادات بنجاح',
    doc,
  });
});

const getCommissionReport = asyncHandler(async (req, res) => {
  const doc = await reportingService.getCommissionReport(req.query);

  return sendSuccess({
    res,
    message: 'تم جلب تقرير العمولات بنجاح',
    doc,
  });
});

const getDriversReport = asyncHandler(async (req, res) => {
  const doc = await reportingService.getDriversReport(req.query);

  return sendSuccess({
    res,
    message: 'تم جلب تقرير السائقين بنجاح',
    doc,
  });
});

const getCustomersReport = asyncHandler(async (req, res) => {
  const doc = await reportingService.getCustomersReport(req.query);

  return sendSuccess({
    res,
    message: 'تم جلب تقرير العملاء بنجاح',
    doc,
  });
});

const getPromosReport = asyncHandler(async (req, res) => {
  const doc = await reportingService.getPromosReport(req.query);

  return sendSuccess({
    res,
    message: 'تم جلب تقرير الكوبونات بنجاح',
    doc,
  });
});

const getLoyaltyReport = asyncHandler(async (req, res) => {
  const doc = await reportingService.getLoyaltyReport(req.query);

  return sendSuccess({
    res,
    message: 'تم جلب تقرير الولاء بنجاح',
    doc,
  });
});

const getCancellationsReport = asyncHandler(async (req, res) => {
  const doc = await reportingService.getCancellationsReport(req.query);

  return sendSuccess({
    res,
    message: 'تم جلب تقرير الإلغاء والعقوبات بنجاح',
    doc,
  });
});

const getComplaintsReport = asyncHandler(async (req, res) => {
  const doc = await reportingService.getComplaintsReport(req.query);

  return sendSuccess({
    res,
    message: 'تم جلب تقرير الشكاوى بنجاح',
    doc,
  });
});

const getSupportReport = asyncHandler(async (req, res) => {
  const doc = await reportingService.getSupportReport(req.query);

  return sendSuccess({
    res,
    message: 'تم جلب تقرير الدعم بنجاح',
    doc,
  });
});

const getAnyReport = asyncHandler(async (req, res) => {
  const reportKey = req.params.reportKey;
  const handler = reportHandlers[reportKey];

  if (!handler) {
    const error = new Error('نوع التقرير غير مدعوم');
    error.statusCode = 404;
    throw error;
  }

  const doc = await handler(req.query);

  return sendSuccess({
    res,
    message: 'تم جلب التقرير بنجاح',
    doc,
  });
});

const exportReport = asyncHandler(async (req, res) => {
  const reportKey = req.params.reportKey;
  const range = reportingService.parseDateRange(req.query);
  const limit = Math.min(Number(req.query.limit || 1000), 5000);
  let rows = [];

  if (reportKey === 'trips') {
    rows = await ServiceRequest.find({
      createdAt: { $gte: range.from, $lte: range.to },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('requestCode serviceType vehicleTypeCode status customerOfferedPrice customerPayablePrice finalPrice commissionAmount appCoveredDiscountAmount createdAt completedAt cancelledAt')
      .lean();
  } else if (reportKey === 'commissions') {
    rows = await CommissionTransaction.find({
      createdAt: { $gte: range.from, $lte: range.to },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('driverAccountId serviceRequestId finalPrice grossCommissionAmount driverPromoDiscountAmount amount paidAmount status createdAt')
      .lean();
  } else if (reportKey === 'ledger') {
    rows = await DriverLedgerTransaction.find({
      createdAt: { $gte: range.from, $lte: range.to },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('driverAccountId serviceRequestId type direction affects amount payableBalanceAfter debtAfter description createdAt')
      .lean();
  } else if (reportKey === 'promos') {
    rows = await PromoRedemption.find({
      createdAt: { $gte: range.from, $lte: range.to },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('code accountId accountRole serviceRequestId discountAmount appliedTo status createdAt')
      .lean();
  } else if (reportKey === 'loyalty') {
    rows = await LoyaltyTransaction.find({
      createdAt: { $gte: range.from, $lte: range.to },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('accountId accountRole type direction points balanceBefore balanceAfter source serviceRequestId createdAt')
      .lean();
  } else if (reportKey === 'penalties') {
    rows = await PenaltyLog.find({
      createdAt: { $gte: range.from, $lte: range.to },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('accountId accountRole serviceRequestId penaltyType phase blockMinutes blockUntil loyaltyPointsDeducted removeDriverCoupons createdAt')
      .lean();
  } else if (reportKey === 'complaints') {
    rows = await Complaint.find({
      createdAt: { $gte: range.from, $lte: range.to },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('complaintCode serviceRequestId fromAccountId againstAccountId category priority status createdAt updatedAt')
      .lean();
  } else if (reportKey === 'support') {
    rows = await SupportTicket.find({
      createdAt: { $gte: range.from, $lte: range.to },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('ticketCode accountId accountRole subject category priority status assignedAdminId createdAt updatedAt')
      .lean();
  } else {
    const error = new Error('نوع التصدير غير مدعوم');
    error.statusCode = 404;
    throw error;
  }

  const flattenedRows = rows.map((row) => {
    const doc = { ...row };
    if (doc._id) doc.id = doc._id.toString();
    delete doc._id;
    delete doc.__v;
    return doc;
  });

  const csv = reportingService.buildCsv(flattenedRows);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="tawseela-${reportKey}-${Date.now()}.csv"`,
  );

  return res.status(200).send(`\uFEFF${csv}`);
});

module.exports = {
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
  getAnyReport,
  exportReport,
};
