const mongoose = require('mongoose');

const DriverProfile = require('../models/driverProfile.model');
const DriverPayment = require('../models/driverPayment.model');
const CommissionTransaction = require('../models/commissionTransaction.model');
const DriverLedgerTransaction = require('../models/driverLedgerTransaction.model');
const SettlementRequest = require('../models/settlementRequest.model');
const DriverDebtSnapshot = require('../models/driverDebtSnapshot.model');

const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const { createAdminAuditLog } = require('../services/adminAuditLog.service');
const {
  ensureDriverWallet,
  recordDriverPaymentToApp,
  createSettlementRequest,
  updateSettlementStatus,
  createDebtSnapshot,
  getDriverFinanceSummary,
  roundMoney,
} = require('../services/driverFinance.service');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const ensureDriverProfileForAccount = async (accountId) => {
  const driverProfile = await DriverProfile.findOne({ accountId });

  if (!driverProfile) {
    const error = new Error('ملف السائق غير موجود');
    error.statusCode = 404;
    throw error;
  }

  return driverProfile;
};

const buildFinancePayload = async ({ driverAccountId, period = 'today', from, to }) => {
  const driverProfile = await ensureDriverProfileForAccount(driverAccountId);
  const { wallet } = await ensureDriverWallet({ driverAccountId, driverProfile });
  const earnings = await getDriverFinanceSummary({ driverAccountId, period, from, to });

  const unpaidCommissions = await CommissionTransaction.find({
    driverAccountId,
    status: { $in: ['unpaid', 'partial_paid'] },
  }).sort({ createdAt: -1 }).limit(50);

  const payments = await DriverPayment.find({ driverAccountId }).sort({ createdAt: -1 }).limit(50);

  const settlements = await SettlementRequest.find({ driverAccountId }).sort({ createdAt: -1 }).limit(50);

  const recentLedger = await DriverLedgerTransaction.find({ driverAccountId })
    .sort({ createdAt: -1 })
    .limit(50);

  return {
    driverProfile,
    wallet,
    earnings,
    unpaidCommissions,
    payments,
    settlements,
    recentLedger,
  };
};

const getMyDriverFinance = asyncHandler(async (req, res) => {
  if (!req.roles?.includes('driver')) {
    const error = new Error('هذا المسار متاح للسائق فقط');
    error.statusCode = 403;
    throw error;
  }

  const payload = await buildFinancePayload({
    driverAccountId: req.accountId,
    period: req.query.period || 'today',
    from: req.query.from,
    to: req.query.to,
  });

  return sendSuccess({
    res,
    message: 'تم جلب بيانات حساب السائق المالية بنجاح',
    doc: payload,
  });
});

const getMyDriverEarnings = asyncHandler(async (req, res) => {
  if (!req.roles?.includes('driver')) {
    const error = new Error('هذا المسار متاح للسائق فقط');
    error.statusCode = 403;
    throw error;
  }

  const earnings = await getDriverFinanceSummary({
    driverAccountId: req.accountId,
    period: req.query.period || 'today',
    from: req.query.from,
    to: req.query.to,
  });

  return sendSuccess({
    res,
    message: 'تم جلب تقرير أرباح السائق بنجاح',
    doc: earnings,
  });
});

const getMyDriverLedger = asyncHandler(async (req, res) => {
  if (!req.roles?.includes('driver')) {
    const error = new Error('هذا المسار متاح للسائق فقط');
    error.statusCode = 403;
    throw error;
  }

  const limit = Math.min(Number(req.query.limit || 100), 200);

  const docs = await DriverLedgerTransaction.find({
    driverAccountId: req.accountId,
  }).sort({ createdAt: -1 }).limit(limit);

  return sendSuccess({
    res,
    message: 'تم جلب سجل حساب السائق بنجاح',
    docs,
  });
});

const getMySettlements = asyncHandler(async (req, res) => {
  if (!req.roles?.includes('driver')) {
    const error = new Error('هذا المسار متاح للسائق فقط');
    error.statusCode = 403;
    throw error;
  }

  const docs = await SettlementRequest.find({
    driverAccountId: req.accountId,
  }).sort({ createdAt: -1 });

  return sendSuccess({
    res,
    message: 'تم جلب طلبات التسوية بنجاح',
    docs,
  });
});

const createMySettlement = asyncHandler(async (req, res) => {
  if (!req.roles?.includes('driver')) {
    const error = new Error('هذا المسار متاح للسائق فقط');
    error.statusCode = 403;
    throw error;
  }

  const settlement = await createSettlementRequest({
    driverAccountId: req.accountId,
    settlementType: req.body.settlementType,
    amount: req.body.amount,
    method: req.body.method,
    proofUrl: req.body.proofUrl,
    note: req.body.note,
    requestedByAccountId: req.accountId,
  });

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم إنشاء طلب التسوية بنجاح',
    doc: settlement,
  });
});

const recordDriverPayment = asyncHandler(async (req, res) => {
  const { driverAccountId, amount, method = 'cash', notes, reason } = req.body;

  if (!isValidObjectId(driverAccountId)) {
    const error = new Error('رقم حساب السائق غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const oldPayload = await buildFinancePayload({ driverAccountId, period: 'today' });

  const result = await recordDriverPaymentToApp({
    driverAccountId,
    amount: roundMoney(amount),
    method,
    notes: notes || '',
    adminAccountId: req.accountId,
  });

  await createAdminAuditLog({
    req,
    module: 'driver_finance',
    action: 'record_driver_payment',
    entityType: 'DriverPayment',
    entityId: result.payment._id,
    oldValue: {
      wallet: oldPayload.wallet,
      driverProfile: oldPayload.driverProfile,
    },
    newValue: {
      wallet: result.wallet,
      driverProfile: result.driverProfile,
      payment: result.payment,
    },
    reason: reason || notes || 'تسجيل سداد من السائق للتطبيق',
  });

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم تسجيل سداد السائق بنجاح',
    doc: result,
  });
});

const getDriverFinanceByAdmin = asyncHandler(async (req, res) => {
  const { driverAccountId } = req.params;

  if (!isValidObjectId(driverAccountId)) {
    const error = new Error('رقم حساب السائق غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const payload = await buildFinancePayload({
    driverAccountId,
    period: req.query.period || 'today',
    from: req.query.from,
    to: req.query.to,
  });

  return sendSuccess({
    res,
    message: 'تم جلب بيانات السائق المالية بنجاح',
    doc: payload,
  });
});

const getDriverLedgerByAdmin = asyncHandler(async (req, res) => {
  const { driverAccountId } = req.params;

  if (!isValidObjectId(driverAccountId)) {
    const error = new Error('رقم حساب السائق غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const limit = Math.min(Number(req.query.limit || 100), 300);

  const docs = await DriverLedgerTransaction.find({ driverAccountId })
    .sort({ createdAt: -1 })
    .limit(limit);

  return sendSuccess({
    res,
    message: 'تم جلب سجل حساب السائق بنجاح',
    docs,
  });
});

const listSettlementsByAdmin = asyncHandler(async (req, res) => {
  const query = {};

  if (req.query.status) {
    query.status = req.query.status;
  }

  if (req.query.settlementType) {
    query.settlementType = req.query.settlementType;
  }

  if (req.query.driverAccountId) {
    if (!isValidObjectId(req.query.driverAccountId)) {
      const error = new Error('رقم حساب السائق غير صحيح');
      error.statusCode = 400;
      throw error;
    }
    query.driverAccountId = req.query.driverAccountId;
  }

  const docs = await SettlementRequest.find(query)
    .populate('driverAccountId', 'name phone email isActive')
    .populate('driverProfileId', 'reviewStatus commissionDebt commissionDebtLimit isBlockedForDebt')
    .populate('reviewedByAdminId', 'name phone email')
    .sort({ createdAt: -1 })
    .limit(300);

  return sendSuccess({
    res,
    message: 'تم جلب طلبات التسوية بنجاح',
    docs,
  });
});

const updateSettlementByAdmin = asyncHandler(async (req, res) => {
  const { settlementId } = req.params;
  const { status, adminNote, reason } = req.body;

  if (!isValidObjectId(settlementId)) {
    const error = new Error('رقم طلب التسوية غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const oldSettlement = await SettlementRequest.findById(settlementId);

  if (!oldSettlement) {
    const error = new Error('طلب التسوية غير موجود');
    error.statusCode = 404;
    throw error;
  }

  const result = await updateSettlementStatus({
    settlementId,
    status,
    adminAccountId: req.accountId,
    adminNote,
  });

  await createAdminAuditLog({
    req,
    module: 'driver_finance',
    action: `settlement_${status}`,
    entityType: 'SettlementRequest',
    entityId: settlementId,
    oldValue: oldSettlement,
    newValue: result.settlement,
    reason: reason || adminNote || 'تحديث طلب تسوية السائق',
  });

  return sendSuccess({
    res,
    message: 'تم تحديث طلب التسوية بنجاح',
    doc: result,
  });
});

const createDriverDebtSnapshotByAdmin = asyncHandler(async (req, res) => {
  const { driverAccountId } = req.params;

  if (!isValidObjectId(driverAccountId)) {
    const error = new Error('رقم حساب السائق غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const snapshot = await createDebtSnapshot({
    driverAccountId,
    periodType: req.body.periodType || 'manual',
    periodStart: req.body.periodStart || null,
    periodEnd: req.body.periodEnd || null,
    createdBy: 'admin',
    adminAccountId: req.accountId,
  });

  await createAdminAuditLog({
    req,
    module: 'driver_finance',
    action: 'create_debt_snapshot',
    entityType: 'DriverDebtSnapshot',
    entityId: snapshot._id,
    oldValue: null,
    newValue: snapshot,
    reason: req.body.reason || 'إنشاء لقطة دين للسائق',
  });

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم إنشاء لقطة الدين بنجاح',
    doc: snapshot,
  });
});

const listDebtSnapshotsByAdmin = asyncHandler(async (req, res) => {
  const query = {};

  if (req.query.driverAccountId) {
    if (!isValidObjectId(req.query.driverAccountId)) {
      const error = new Error('رقم حساب السائق غير صحيح');
      error.statusCode = 400;
      throw error;
    }
    query.driverAccountId = req.query.driverAccountId;
  }

  const docs = await DriverDebtSnapshot.find(query)
    .populate('driverAccountId', 'name phone email isActive')
    .populate('adminAccountId', 'name phone email')
    .sort({ createdAt: -1 })
    .limit(300);

  return sendSuccess({
    res,
    message: 'تم جلب لقطات دين السائقين بنجاح',
    docs,
  });
});

module.exports = {
  getMyDriverFinance,
  getMyDriverEarnings,
  getMyDriverLedger,
  getMySettlements,
  createMySettlement,
  recordDriverPayment,
  getDriverFinanceByAdmin,
  getDriverLedgerByAdmin,
  listSettlementsByAdmin,
  updateSettlementByAdmin,
  createDriverDebtSnapshotByAdmin,
  listDebtSnapshotsByAdmin,
};
