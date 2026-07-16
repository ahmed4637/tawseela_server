const mongoose = require('mongoose');

const DriverProfile = require('../models/driverProfile.model');
const DriverWallet = require('../models/driverWallet.model');
const DriverLedgerTransaction = require('../models/driverLedgerTransaction.model');
const DriverDebtSnapshot = require('../models/driverDebtSnapshot.model');
const DriverPayment = require('../models/driverPayment.model');
const CommissionTransaction = require('../models/commissionTransaction.model');
const SettlementRequest = require('../models/settlementRequest.model');
const ServiceRequest = require('../models/serviceRequest.model');
const {
  getAppSettings,
  findSettlementPaymentDestination,
} = require('./appSettings.service');

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const asObjectId = (value) => {
  if (!value) {
    return null;
  }

  return value instanceof mongoose.Types.ObjectId
    ? value
    : new mongoose.Types.ObjectId(value.toString());
};

const getPeriodRange = ({ period = 'today', from, to } = {}) => {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);

  if (period === 'custom') {
    return {
      start: from ? new Date(from) : new Date(0),
      end: to ? new Date(to) : now,
    };
  }

  if (period === 'year') {
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
    end.setMonth(11, 31);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  if (period === 'month') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    end.setMonth(end.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  if (period === 'week') {
    const day = start.getDay();
    const diffToSaturday = day === 6 ? 0 : day + 1;
    start.setDate(start.getDate() - diffToSaturday);
    start.setHours(0, 0, 0, 0);
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  return { start, end };
};

const syncDriverProfileDebt = async ({ driverProfile, wallet }) => {
  if (!driverProfile || !wallet) {
    return null;
  }

  driverProfile.commissionDebt = roundMoney(wallet.debtAmount);
  driverProfile.commissionDebtLimit = roundMoney(wallet.debtLimit);
  driverProfile.refreshDebtBlockStatus();

  if (driverProfile.isBlockedForDebt || driverProfile.commissionDebt >= driverProfile.commissionDebtLimit) {
    driverProfile.isBlockedForDebt = true;
    driverProfile.blockedReason = driverProfile.blockedReason || 'تم إيقاف استقبال الرحلات بسبب مستحقات التطبيق';
    driverProfile.isOnline = false;
    driverProfile.isAvailable = false;
  } else {
    driverProfile.isBlockedForDebt = false;
    driverProfile.blockedReason = '';
  }

  await driverProfile.save();

  return driverProfile;
};

const ensureDriverWallet = async ({ driverAccountId, driverProfile = null }) => {
  const accountId = asObjectId(driverAccountId);

  let profile = driverProfile;

  if (!profile) {
    profile = await DriverProfile.findOne({ accountId });
  }

  if (!profile) {
    const error = new Error('ملف السائق غير موجود');
    error.statusCode = 404;
    throw error;
  }

  const settings = await getAppSettings();
  const debtLimit = roundMoney(
    profile.commissionDebtLimit || settings.driverCommissionDebtLimit || 200,
  );

  let wallet = await DriverWallet.findOne({ driverAccountId: accountId });

  if (!wallet) {
    wallet = await DriverWallet.create({
      driverAccountId: accountId,
      driverProfileId: profile._id,
      payableBalance: 0,
      debtAmount: roundMoney(profile.commissionDebt || 0),
      debtLimit,
    });
  } else {
    wallet.driverProfileId = wallet.driverProfileId || profile._id;
    wallet.debtLimit = debtLimit;
  }

  wallet.refreshDebtBlockStatus();
  await wallet.save();

  await syncDriverProfileDebt({ driverProfile: profile, wallet });

  return { wallet, driverProfile: profile };
};

const createLedgerTransaction = async ({
  wallet,
  driverProfile,
  type,
  direction,
  affects = 'stats_only',
  amount,
  transactionKey,
  description = '',
  serviceRequestId = null,
  commissionTransactionId = null,
  driverPaymentId = null,
  settlementRequestId = null,
  metadata = null,
  createdBy = 'system',
  adminAccountId = null,
}) => {
  const payload = {
    driverAccountId: wallet.driverAccountId,
    driverProfileId: driverProfile?._id || wallet.driverProfileId || null,
    walletId: wallet._id,
    serviceRequestId,
    commissionTransactionId,
    driverPaymentId,
    settlementRequestId,
    type,
    direction,
    affects,
    amount: roundMoney(amount),
    payableBalanceAfter: roundMoney(wallet.payableBalance),
    debtAfter: roundMoney(wallet.debtAmount),
    transactionKey,
    description,
    metadata,
    createdBy,
    adminAccountId,
  };

  try {
    return await DriverLedgerTransaction.create(payload);
  } catch (error) {
    if (error.code === 11000) {
      return DriverLedgerTransaction.findOne({ transactionKey });
    }

    throw error;
  }
};

const updateOldestCommissionsAfterPayment = async ({
  driverAccountId,
  amount,
  settlementRequestId = null,
}) => {
  const paymentAmount = roundMoney(amount);
  let remaining = paymentAmount;
  const settlementObjectId = settlementRequestId
    ? asObjectId(settlementRequestId)
    : null;

  if (settlementObjectId) {
    const appliedRows = await CommissionTransaction.find({
      driverAccountId,
      'settlementAllocations.settlementRequestId': settlementObjectId,
    }).select('settlementAllocations');

    const appliedBefore = appliedRows.reduce((sum, commission) => {
      const applied = (commission.settlementAllocations || [])
        .filter(
          (item) =>
            String(item.settlementRequestId) === String(settlementObjectId),
        )
        .reduce((itemSum, item) => itemSum + Number(item.amount || 0), 0);
      return roundMoney(sum + applied);
    }, 0);

    remaining = roundMoney(Math.max(paymentAmount - appliedBefore, 0));
  }

  const commissions = await CommissionTransaction.find({
    driverAccountId,
    status: { $in: ['unpaid', 'partial_paid'] },
  }).sort({ createdAt: 1 });

  for (const commission of commissions) {
    if (remaining <= 0) break;

    const paidAmount = roundMoney(commission.paidAmount || 0);
    const dueAmount = roundMoney(
      Math.max(Number(commission.amount || 0) - paidAmount, 0),
    );

    if (dueAmount <= 0) {
      commission.status = 'paid';
      commission.paidAt = commission.paidAt || new Date();
      await commission.save();
      continue;
    }

    const applied = roundMoney(Math.min(remaining, dueAmount));

    if (settlementObjectId) {
      const updated = await CommissionTransaction.findOneAndUpdate(
        {
          _id: commission._id,
          settlementAllocations: {
            $not: {
              $elemMatch: { settlementRequestId: settlementObjectId },
            },
          },
        },
        {
          $inc: { paidAmount: applied },
          $push: {
            settlementAllocations: {
              settlementRequestId: settlementObjectId,
              amount: applied,
              appliedAt: new Date(),
            },
          },
        },
        { new: true },
      );

      if (!updated) continue;

      updated.status = updated.paidAmount >= updated.amount ? 'paid' : 'partial_paid';
      updated.paidAt = updated.status === 'paid' ? updated.paidAt || new Date() : null;
      await updated.save();
    } else {
      commission.paidAmount = roundMoney(paidAmount + applied);
      commission.paidAt =
        commission.paidAmount >= commission.amount
          ? commission.paidAt || new Date()
          : null;
      commission.status =
        commission.paidAmount >= commission.amount ? 'paid' : 'partial_paid';
      await commission.save();
    }

    remaining = roundMoney(remaining - applied);
  }

  return {
    requestedAmount: paymentAmount,
    unappliedAmount: roundMoney(Math.max(remaining, 0)),
  };
};

const recordCompletedRequestFinance = async ({ request }) => {
  if (!request?.acceptedDriverAccountId) {
    return {
      wasAlreadyRecorded: false,
      wallet: null,
      driverProfile: null,
      commissionTransaction: null,
      ledgerTransactions: [],
    };
  }

  const driverAccountId = request.acceptedDriverAccountId;
  const { wallet, driverProfile } = await ensureDriverWallet({ driverAccountId });

  const existingCommission = await CommissionTransaction.findOne({
    serviceRequestId: request._id,
    type: 'commission',
  });

  if (existingCommission) {
    driverProfile.totalCompletedTrips = Math.max(driverProfile.totalCompletedTrips || 0, 1);
    driverProfile.activeServiceRequestId = null;
    driverProfile.isAvailable = true;
    await syncDriverProfileDebt({ driverProfile, wallet });

    return {
      wasAlreadyRecorded: true,
      wallet,
      driverProfile,
      commissionTransaction: existingCommission,
      ledgerTransactions: [],
    };
  }

  const finalPrice = roundMoney(request.finalPrice || 0);
  const customerPayablePrice = roundMoney(request.customerPayablePrice || finalPrice);
  const appCoveredDiscountAmount = roundMoney(request.appCoveredDiscountAmount || 0);
  const grossCommissionAmount = roundMoney(request.grossCommissionAmount || 0);
  const driverPromoDiscountAmount = roundMoney(request.driverPromoDiscountAmount || 0);
  const commissionAmount = roundMoney(request.commissionAmount || 0);
  const driverNetAmount = roundMoney(finalPrice - commissionAmount);

  const commissionTransaction = await CommissionTransaction.create({
    driverAccountId,
    serviceRequestId: request._id,
    type: 'commission',
    serviceType: request.serviceType,
    vehicleTypeCode: request.vehicleTypeCode,
    finalPrice,
    customerPayablePrice,
    appCoveredDiscountAmount,
    grossCommissionAmount,
    driverPromoDiscountAmount,
    commissionPercent: request.commissionPercent || 0,
    amount: commissionAmount,
    driverNetAmount,
    status: commissionAmount > 0 ? 'unpaid' : 'paid',
    paidAmount: commissionAmount > 0 ? 0 : commissionAmount,
    paidAt: commissionAmount > 0 ? null : new Date(),
    walletId: wallet._id,
    notes:
      driverPromoDiscountAmount > 0
        ? `عمولة مستحقة بعد خصم كوبون السائق بقيمة ${driverPromoDiscountAmount} جنيه`
        : 'عمولة مستحقة بعد إتمام الطلب',
  });

  wallet.totalTripFare = roundMoney(wallet.totalTripFare + finalPrice);
  wallet.totalCustomerPaidToDriver = roundMoney(
    wallet.totalCustomerPaidToDriver + customerPayablePrice,
  );
  wallet.totalAppCoveredDiscount = roundMoney(
    wallet.totalAppCoveredDiscount + appCoveredDiscountAmount,
  );
  wallet.totalGrossCommission = roundMoney(
    wallet.totalGrossCommission + grossCommissionAmount,
  );
  wallet.totalDriverPromoDiscount = roundMoney(
    wallet.totalDriverPromoDiscount + driverPromoDiscountAmount,
  );
  wallet.totalNetCommission = roundMoney(wallet.totalNetCommission + commissionAmount);
  wallet.payableBalance = roundMoney(wallet.payableBalance + appCoveredDiscountAmount);
  wallet.debtAmount = roundMoney(wallet.debtAmount + commissionAmount);
  wallet.refreshDebtBlockStatus();

  await wallet.save();

  driverProfile.totalCompletedTrips = Number(driverProfile.totalCompletedTrips || 0) + 1;
  driverProfile.activeServiceRequestId = null;
  driverProfile.isAvailable = true;
  await syncDriverProfileDebt({ driverProfile, wallet });

  const ledgerTransactions = [];

  ledgerTransactions.push(
    await createLedgerTransaction({
      wallet,
      driverProfile,
      type: 'trip_fare_recorded',
      direction: 'credit',
      affects: 'stats_only',
      amount: finalPrice,
      transactionKey: `request:${request._id}:trip-fare`,
      description: 'تسجيل إجمالي سعر الرحلة للسائق',
      serviceRequestId: request._id,
      commissionTransactionId: commissionTransaction._id,
      metadata: { customerPayablePrice, appCoveredDiscountAmount },
    }),
  );

  ledgerTransactions.push(
    await createLedgerTransaction({
      wallet,
      driverProfile,
      type: 'customer_cash_collected',
      direction: 'credit',
      affects: 'stats_only',
      amount: customerPayablePrice,
      transactionKey: `request:${request._id}:customer-cash`,
      description: 'المبلغ المتوقع تحصيله من العميل بعد خصم كوبون العميل',
      serviceRequestId: request._id,
      commissionTransactionId: commissionTransaction._id,
    }),
  );

  if (appCoveredDiscountAmount > 0) {
    ledgerTransactions.push(
      await createLedgerTransaction({
        wallet,
        driverProfile,
        type: 'app_covered_discount_receivable',
        direction: 'credit',
        affects: 'payable_balance',
        amount: appCoveredDiscountAmount,
        transactionKey: `request:${request._id}:app-covered-discount`,
        description: 'رصيد مستحق للسائق لأن التطبيق تحمل خصم كوبون العميل',
        serviceRequestId: request._id,
        commissionTransactionId: commissionTransaction._id,
      }),
    );
  }

  if (grossCommissionAmount > 0) {
    ledgerTransactions.push(
      await createLedgerTransaction({
        wallet,
        driverProfile,
        type: 'gross_commission_debt',
        direction: 'debit',
        affects: 'debt',
        amount: grossCommissionAmount,
        transactionKey: `request:${request._id}:gross-commission`,
        description: 'إجمالي عمولة التطبيق قبل خصم كوبون السائق',
        serviceRequestId: request._id,
        commissionTransactionId: commissionTransaction._id,
      }),
    );
  }

  if (driverPromoDiscountAmount > 0) {
    ledgerTransactions.push(
      await createLedgerTransaction({
        wallet,
        driverProfile,
        type: 'driver_coupon_discount',
        direction: 'credit',
        affects: 'debt',
        amount: driverPromoDiscountAmount,
        transactionKey: `request:${request._id}:driver-promo-discount`,
        description: 'خصم كوبون السائق من عمولة التطبيق',
        serviceRequestId: request._id,
        commissionTransactionId: commissionTransaction._id,
      }),
    );
  }

  commissionTransaction.ledgerTransactionIds = ledgerTransactions
    .filter(Boolean)
    .map((transaction) => transaction._id);
  await commissionTransaction.save();

  return {
    wasAlreadyRecorded: false,
    wallet,
    driverProfile,
    commissionTransaction,
    ledgerTransactions,
  };
};

const recordDriverPaymentToApp = async ({
  driverAccountId,
  amount,
  method = 'wallet',
  notes = '',
  adminAccountId = null,
}) => {
  const { wallet, driverProfile } = await ensureDriverWallet({ driverAccountId });
  const paymentAmount = roundMoney(amount);

  if (paymentAmount <= 0) {
    const error = new Error('قيمة السداد غير صحيحة');
    error.statusCode = 400;
    throw error;
  }

  if (paymentAmount > roundMoney(wallet.debtAmount)) {
    const error = new Error('قيمة السداد أكبر من دين السائق الحالي');
    error.statusCode = 400;
    throw error;
  }

  const payment = await DriverPayment.create({
    driverAccountId,
    amount: paymentAmount,
    method,
    status: 'confirmed',
    receivedByAdminId: adminAccountId,
    notes,
    walletId: wallet._id,
    previousDebtAmount: wallet.debtAmount,
    debtAfter: roundMoney(wallet.debtAmount - paymentAmount),
  });

  wallet.debtAmount = roundMoney(wallet.debtAmount - paymentAmount);
  wallet.totalPaidToApp = roundMoney(wallet.totalPaidToApp + paymentAmount);
  wallet.refreshDebtBlockStatus();
  await wallet.save();

  await syncDriverProfileDebt({ driverProfile, wallet });
  await updateOldestCommissionsAfterPayment({ driverAccountId, amount: paymentAmount });

  const ledgerTransaction = await createLedgerTransaction({
    wallet,
    driverProfile,
    type: 'driver_payment_to_app',
    direction: 'credit',
    affects: 'debt',
    amount: paymentAmount,
    transactionKey: `driver-payment:${payment._id}`,
    description: 'سداد السائق جزء من مستحقات التطبيق',
    driverPaymentId: payment._id,
    createdBy: 'admin',
    adminAccountId,
  });

  return {
    wallet,
    driverProfile,
    payment,
    ledgerTransaction,
  };
};

const DRIVER_SETTLEMENT_METHODS = ['wallet', 'instapay', 'bank_transfer'];

const normalizeProofUrl = (value) => {
  let proofUrl = String(value || '').trim();
  if (proofUrl.startsWith('uploads/')) proofUrl = `/${proofUrl}`;
  return proofUrl;
};

const createSettlementRequest = async ({
  driverAccountId,
  settlementType,
  amount,
  method = 'wallet',
  destinationAccountId = '',
  senderReference = '',
  proofUrl = '',
  note = '',
  clientRequestId = '',
  requestedByAccountId = null,
}) => {
  const cleanClientRequestId = String(clientRequestId || '').trim();

  if (cleanClientRequestId) {
    const existing = await SettlementRequest.findOne({
      driverAccountId,
      clientRequestId: cleanClientRequestId,
    });
    if (existing) return existing;
  }

  const { wallet, driverProfile } = await ensureDriverWallet({ driverAccountId });
  const settlementAmount = roundMoney(amount);
  const cleanMethod = String(method || '').trim();
  const cleanSenderReference = String(senderReference || '').trim();
  const cleanProofUrl = normalizeProofUrl(proofUrl);

  if (settlementType !== 'driver_pays_app') {
    const error = new Error('السائق يمكنه طلب تسوية سداد المديونية فقط');
    error.statusCode = 400;
    throw error;
  }

  if (settlementAmount <= 0) {
    const error = new Error('قيمة التسوية غير صحيحة');
    error.statusCode = 400;
    throw error;
  }

  if (settlementAmount > roundMoney(wallet.debtAmount)) {
    const error = new Error('قيمة التسوية أكبر من دين السائق الحالي');
    error.statusCode = 400;
    throw error;
  }

  if (!DRIVER_SETTLEMENT_METHODS.includes(cleanMethod)) {
    const error = new Error('طريقة التحويل غير صحيحة');
    error.statusCode = 400;
    throw error;
  }

  if (cleanSenderReference.length < 4) {
    const error = new Error('اكتب الرقم أو الحساب الذي تم التحويل منه');
    error.statusCode = 400;
    throw error;
  }

  if (!cleanProofUrl.startsWith('/uploads/general/')) {
    const error = new Error('صورة إيصال التحويل مطلوبة');
    error.statusCode = 400;
    throw error;
  }

  const destination = await findSettlementPaymentDestination({
    method: cleanMethod,
    destinationAccountId,
  });

  const pendingRows = await SettlementRequest.aggregate([
    {
      $match: {
        driverAccountId: asObjectId(driverAccountId),
        settlementType: 'driver_pays_app',
        status: { $in: ['pending', 'approved', 'processing'] },
      },
    },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);

  const pendingAmount = roundMoney(pendingRows[0]?.total || 0);
  if (roundMoney(pendingAmount + settlementAmount) > roundMoney(wallet.debtAmount)) {
    const error = new Error(
      `لديك طلبات تسوية معلقة بقيمة ${pendingAmount} جنيه، ولا يمكن أن تتجاوز الطلبات دينك الحالي`,
    );
    error.statusCode = 400;
    throw error;
  }

  try {
    return await SettlementRequest.create({
      driverAccountId,
      driverProfileId: driverProfile._id,
      walletId: wallet._id,
      settlementType: 'driver_pays_app',
      amount: settlementAmount,
      method: cleanMethod,
      destinationAccountId: destination.id,
      destinationSnapshot: destination,
      senderReference: cleanSenderReference.slice(0, 160),
      proofUrl: cleanProofUrl,
      note: String(note || '').trim().slice(0, 500),
      clientRequestId: cleanClientRequestId,
      debtBefore: roundMoney(wallet.debtAmount),
      requestedByAccountId,
    });
  } catch (error) {
    if (error.code === 11000 && cleanClientRequestId) {
      return SettlementRequest.findOne({
        driverAccountId,
        clientRequestId: cleanClientRequestId,
      });
    }
    throw error;
  }
};

const applyDriverSettlementToWallet = async ({ settlement, wallet }) => {
  const settlementId = asObjectId(settlement._id);
  const amount = roundMoney(settlement.amount);
  const alreadyApplied = (wallet.processedSettlementIds || []).some(
    (item) => String(item) === String(settlementId),
  );

  if (alreadyApplied) {
    return {
      wallet,
      appliedNow: false,
      previousDebtAmount: roundMoney(
        settlement.debtBefore || Number(wallet.debtAmount || 0) + amount,
      ),
      debtAfter: roundMoney(wallet.debtAmount),
    };
  }

  const previousDebtAmount = roundMoney(wallet.debtAmount);
  if (amount > previousDebtAmount) {
    const error = new Error('قيمة التسوية أكبر من دين السائق الحالي');
    error.statusCode = 400;
    throw error;
  }

  const debtAfter = roundMoney(previousDebtAmount - amount);
  const totalPaidToApp = roundMoney(Number(wallet.totalPaidToApp || 0) + amount);
  const isBlockedByDebt = debtAfter >= Number(wallet.debtLimit || 0);

  let updatedWallet = await DriverWallet.findOneAndUpdate(
    {
      _id: wallet._id,
      debtAmount: previousDebtAmount,
      processedSettlementIds: { $ne: settlementId },
    },
    {
      $set: {
        debtAmount: debtAfter,
        totalPaidToApp,
        isBlockedByDebt,
      },
      $addToSet: { processedSettlementIds: settlementId },
    },
    { new: true },
  );

  if (!updatedWallet) {
    updatedWallet = await DriverWallet.findById(wallet._id);
    const appliedByAnotherRequest = (updatedWallet?.processedSettlementIds || []).some(
      (item) => String(item) === String(settlementId),
    );

    if (!appliedByAnotherRequest) {
      const error = new Error('تم تحديث مديونية السائق بالتزامن، أعد المحاولة');
      error.statusCode = 409;
      throw error;
    }

    return {
      wallet: updatedWallet,
      appliedNow: false,
      previousDebtAmount: roundMoney(
        settlement.debtBefore || Number(updatedWallet.debtAmount || 0) + amount,
      ),
      debtAfter: roundMoney(updatedWallet.debtAmount),
    };
  }

  return {
    wallet: updatedWallet,
    appliedNow: true,
    previousDebtAmount,
    debtAfter,
  };
};

const updateSettlementStatus = async ({
  settlementId,
  status,
  adminAccountId,
  adminNote = '',
}) => {
  let settlement = await SettlementRequest.findById(settlementId);

  if (!settlement) {
    const error = new Error('طلب التسوية غير موجود');
    error.statusCode = 404;
    throw error;
  }

  if (status === 'completed' && settlement.status === 'completed') {
    const wallet = await DriverWallet.findById(settlement.walletId);
    const driverProfile = await DriverProfile.findById(settlement.driverProfileId);
    return {
      settlement,
      wallet,
      driverProfile,
      ledgerTransaction: settlement.ledgerTransactionId
        ? await DriverLedgerTransaction.findById(settlement.ledgerTransactionId)
        : null,
      payment: settlement.driverPaymentId
        ? await DriverPayment.findById(settlement.driverPaymentId)
        : null,
      wasAlreadyCompleted: true,
    };
  }

  if (['rejected', 'cancelled'].includes(settlement.status)) {
    const error = new Error('لا يمكن تعديل طلب تسوية منتهي');
    error.statusCode = 400;
    throw error;
  }

  if (settlement.status === 'processing' && status !== 'completed') {
    const error = new Error('طلب التسوية قيد الاعتماد حاليًا');
    error.statusCode = 409;
    throw error;
  }

  const cleanAdminNote = String(adminNote || '').trim();

  if (status === 'rejected' || status === 'cancelled') {
    if (status === 'rejected' && cleanAdminNote.length < 3) {
      const error = new Error('سبب رفض التسوية مطلوب');
      error.statusCode = 400;
      throw error;
    }

    settlement.status = status;
    settlement.reviewedByAdminId = adminAccountId;
    settlement.reviewedAt = new Date();
    settlement.adminNote = cleanAdminNote;
    settlement.rejectionReason = status === 'rejected' ? cleanAdminNote : '';
    await settlement.save();

    const { wallet, driverProfile } = await ensureDriverWallet({
      driverAccountId: settlement.driverAccountId,
    });

    return {
      settlement,
      wallet,
      driverProfile,
      ledgerTransaction: null,
      payment: null,
    };
  }

  if (status === 'approved') {
    settlement.status = 'approved';
    settlement.reviewedByAdminId = adminAccountId;
    settlement.reviewedAt = new Date();
    settlement.adminNote = cleanAdminNote || settlement.adminNote;
    await settlement.save();

    const { wallet, driverProfile } = await ensureDriverWallet({
      driverAccountId: settlement.driverAccountId,
    });

    return {
      settlement,
      wallet,
      driverProfile,
      ledgerTransaction: null,
      payment: null,
    };
  }

  if (status !== 'completed') {
    const error = new Error('حالة التسوية غير صحيحة');
    error.statusCode = 400;
    throw error;
  }

  const { wallet: initialWallet, driverProfile } = await ensureDriverWallet({
    driverAccountId: settlement.driverAccountId,
  });

  if (settlement.settlementType === 'driver_pays_app') {
    settlement.status = 'processing';
    settlement.reviewedByAdminId = adminAccountId;
    settlement.reviewedAt = settlement.reviewedAt || new Date();
    settlement.adminNote = cleanAdminNote || settlement.adminNote;
    await settlement.save();

    const walletResult = await applyDriverSettlementToWallet({
      settlement,
      wallet: initialWallet,
    });
    const wallet = walletResult.wallet;

    await syncDriverProfileDebt({ driverProfile, wallet });

    await updateOldestCommissionsAfterPayment({
      driverAccountId: settlement.driverAccountId,
      amount: settlement.amount,
      settlementRequestId: settlement._id,
    });

    const payment = await DriverPayment.findOneAndUpdate(
      { settlementRequestId: settlement._id },
      {
        $setOnInsert: {
          driverAccountId: settlement.driverAccountId,
          walletId: wallet._id,
          settlementRequestId: settlement._id,
          amount: roundMoney(settlement.amount),
          method: settlement.method,
          status: 'confirmed',
          previousDebtAmount: walletResult.previousDebtAmount,
          debtAfter: walletResult.debtAfter,
          receivedByAdminId: adminAccountId,
          notes: settlement.note || 'اعتماد طلب تسوية من السائق',
          senderReference: settlement.senderReference,
          proofUrl: settlement.proofUrl,
          destinationSnapshot: settlement.destinationSnapshot,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    const ledgerTransaction = await createLedgerTransaction({
      wallet,
      driverProfile,
      type: 'driver_payment_to_app',
      direction: 'credit',
      affects: 'debt',
      amount: settlement.amount,
      transactionKey: `settlement:${settlement._id}:driver-payment`,
      description: 'اعتماد تحويل السائق وسداد جزء من مديونية التطبيق',
      driverPaymentId: payment._id,
      settlementRequestId: settlement._id,
      metadata: {
        method: settlement.method,
        senderReference: settlement.senderReference,
        destination: settlement.destinationSnapshot,
        proofUrl: settlement.proofUrl,
      },
      createdBy: 'admin',
      adminAccountId,
    });

    settlement = await SettlementRequest.findByIdAndUpdate(
      settlement._id,
      {
        $set: {
          status: 'completed',
          reviewedByAdminId: adminAccountId,
          reviewedAt: settlement.reviewedAt || new Date(),
          completedByAdminId: adminAccountId,
          completedAt: new Date(),
          adminNote: cleanAdminNote || settlement.adminNote,
          rejectionReason: '',
          debtAfter: walletResult.debtAfter,
          walletAppliedAt: settlement.walletAppliedAt || new Date(),
          commissionsAppliedAt: settlement.commissionsAppliedAt || new Date(),
          driverPaymentId: payment._id,
          ledgerTransactionId: ledgerTransaction?._id || null,
        },
      },
      { new: true },
    );

    return {
      settlement,
      wallet,
      driverProfile,
      ledgerTransaction,
      payment,
      wasAlreadyCompleted: !walletResult.appliedNow,
    };
  }

  // Legacy admin-only settlement types remain supported for old records.
  const wallet = initialWallet;
  let ledgerTransaction = null;
  let payment = null;
  const settlementAmount = roundMoney(settlement.amount);

  if (settlement.settlementType === 'app_pays_driver') {
    if (settlementAmount > wallet.payableBalance) {
      const error = new Error('قيمة التسوية أكبر من الرصيد المستحق للسائق');
      error.statusCode = 400;
      throw error;
    }

    wallet.payableBalance = roundMoney(wallet.payableBalance - settlementAmount);
    wallet.totalPaidToDriver = roundMoney(wallet.totalPaidToDriver + settlementAmount);
    wallet.refreshDebtBlockStatus();
    await wallet.save();
    await syncDriverProfileDebt({ driverProfile, wallet });

    ledgerTransaction = await createLedgerTransaction({
      wallet,
      driverProfile,
      type: 'app_payment_to_driver',
      direction: 'debit',
      affects: 'payable_balance',
      amount: settlementAmount,
      transactionKey: `settlement:${settlement._id}:app-payment`,
      description: 'سداد التطبيق رصيد مستحق للسائق',
      settlementRequestId: settlement._id,
      createdBy: 'admin',
      adminAccountId,
    });
  }

  if (settlement.settlementType === 'offset') {
    const maxOffset = roundMoney(Math.min(wallet.debtAmount, wallet.payableBalance));
    if (settlementAmount > maxOffset) {
      const error = new Error('قيمة المقاصة أكبر من الرصيد المتاح للمقاصة');
      error.statusCode = 400;
      throw error;
    }

    wallet.payableBalance = roundMoney(wallet.payableBalance - settlementAmount);
    wallet.debtAmount = roundMoney(wallet.debtAmount - settlementAmount);
    wallet.refreshDebtBlockStatus();
    await wallet.save();
    await syncDriverProfileDebt({ driverProfile, wallet });
    await updateOldestCommissionsAfterPayment({
      driverAccountId: settlement.driverAccountId,
      amount: settlementAmount,
    });

    ledgerTransaction = await createLedgerTransaction({
      wallet,
      driverProfile,
      type: 'admin_adjustment',
      direction: 'neutral',
      affects: 'both',
      amount: settlementAmount,
      transactionKey: `settlement:${settlement._id}:offset`,
      description: 'مقاصة بين رصيد مستحق للسائق ودين مستحق للتطبيق',
      settlementRequestId: settlement._id,
      createdBy: 'admin',
      adminAccountId,
    });
  }

  settlement.status = 'completed';
  settlement.reviewedByAdminId = settlement.reviewedByAdminId || adminAccountId;
  settlement.reviewedAt = settlement.reviewedAt || new Date();
  settlement.completedByAdminId = adminAccountId;
  settlement.completedAt = new Date();
  settlement.adminNote = cleanAdminNote || settlement.adminNote;
  settlement.ledgerTransactionId = ledgerTransaction?._id || null;
  await settlement.save();

  return {
    settlement,
    wallet,
    driverProfile,
    ledgerTransaction,
    payment,
  };
};

const createDebtSnapshot = async ({ driverAccountId, periodType = 'manual', periodStart = null, periodEnd = null, adminAccountId = null, createdBy = 'system' }) => {
  const { wallet, driverProfile } = await ensureDriverWallet({ driverAccountId });

  const snapshot = await DriverDebtSnapshot.create({
    driverAccountId,
    driverProfileId: driverProfile._id,
    walletId: wallet._id,
    payableBalance: wallet.payableBalance,
    debtAmount: wallet.debtAmount,
    netBalance: roundMoney(wallet.payableBalance - wallet.debtAmount),
    periodType,
    periodStart,
    periodEnd,
    createdBy,
    adminAccountId,
  });

  wallet.lastDebtSnapshotAt = new Date();
  await wallet.save();

  await createLedgerTransaction({
    wallet,
    driverProfile,
    type: 'debt_snapshot',
    direction: 'neutral',
    affects: 'stats_only',
    amount: wallet.debtAmount,
    transactionKey: `debt-snapshot:${snapshot._id}`,
    description: 'تسجيل لقطة لدين ورصيد السائق',
    metadata: { snapshotId: snapshot._id, periodType, periodStart, periodEnd },
    createdBy,
    adminAccountId,
  });

  return snapshot;
};

const getDriverFinanceSummary = async ({ driverAccountId, period = 'today', from, to }) => {
  const { wallet, driverProfile } = await ensureDriverWallet({ driverAccountId });
  const { start, end } = getPeriodRange({ period, from, to });

  const requests = await ServiceRequest.find({
    acceptedDriverAccountId: driverAccountId,
    status: 'completed',
    completedAt: { $gte: start, $lte: end },
  }).select(
    'requestCode finalPrice customerPayablePrice appCoveredDiscountAmount grossCommissionAmount driverPromoDiscountAmount commissionAmount completedAt serviceType vehicleTypeCode',
  ).sort({ completedAt: -1 });

  const summary = requests.reduce(
    (acc, request) => {
      acc.completedRequests += 1;
      acc.totalTripFare = roundMoney(acc.totalTripFare + Number(request.finalPrice || 0));
      acc.totalCustomerPaidToDriver = roundMoney(
        acc.totalCustomerPaidToDriver + Number(request.customerPayablePrice || 0),
      );
      acc.totalAppCoveredDiscount = roundMoney(
        acc.totalAppCoveredDiscount + Number(request.appCoveredDiscountAmount || 0),
      );
      acc.totalGrossCommission = roundMoney(
        acc.totalGrossCommission + Number(request.grossCommissionAmount || 0),
      );
      acc.totalDriverPromoDiscount = roundMoney(
        acc.totalDriverPromoDiscount + Number(request.driverPromoDiscountAmount || 0),
      );
      acc.totalNetCommission = roundMoney(
        acc.totalNetCommission + Number(request.commissionAmount || 0),
      );
      acc.driverNetAfterCommission = roundMoney(
        acc.driverNetAfterCommission + Number(request.finalPrice || 0) - Number(request.commissionAmount || 0),
      );
      return acc;
    },
    {
      completedRequests: 0,
      totalTripFare: 0,
      totalCustomerPaidToDriver: 0,
      totalAppCoveredDiscount: 0,
      totalGrossCommission: 0,
      totalDriverPromoDiscount: 0,
      totalNetCommission: 0,
      driverNetAfterCommission: 0,
    },
  );

  return {
    wallet,
    driverProfile,
    period,
    start,
    end,
    summary,
    requests,
  };
};

module.exports = {
  roundMoney,
  getPeriodRange,
  ensureDriverWallet,
  syncDriverProfileDebt,
  recordCompletedRequestFinance,
  recordDriverPaymentToApp,
  createSettlementRequest,
  updateSettlementStatus,
  createDebtSnapshot,
  getDriverFinanceSummary,
};
