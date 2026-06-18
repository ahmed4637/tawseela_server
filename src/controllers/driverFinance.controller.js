const mongoose = require('mongoose');

const DriverProfile = require('../models/driverProfile.model');
const DriverPayment = require('../models/driverPayment.model');
const CommissionTransaction = require('../models/commissionTransaction.model');

const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');

const roundMoney = (value) => {
  return Math.round((Number(value) || 0) * 100) / 100;
};

const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

const getMyDriverFinance = asyncHandler(async (req, res) => {
  if (!req.roles?.includes('driver')) {
    const error = new Error('هذا المسار متاح للسائق فقط');
    error.statusCode = 403;
    throw error;
  }

  const driverProfile = await DriverProfile.findOne({
    accountId: req.accountId,
  });

  if (!driverProfile) {
    const error = new Error('ملف السائق غير موجود');
    error.statusCode = 404;
    throw error;
  }

  driverProfile.refreshDebtBlockStatus();
  await driverProfile.save();

  const unpaidCommissions = await CommissionTransaction.find({
    driverAccountId: req.accountId,
    status: 'unpaid',
  }).sort({
    createdAt: -1,
  });

  const payments = await DriverPayment.find({
    driverAccountId: req.accountId,
  }).sort({
    createdAt: -1,
  });

  return sendSuccess({
    res,
    message: 'تم جلب بيانات حساب السائق المالية بنجاح',
    doc: {
      driverProfile,
      unpaidCommissions,
      payments,
    },
  });
});

const recordDriverPayment = asyncHandler(async (req, res) => {
  const {
    driverAccountId,
    amount,
    method = 'cash',
    notes,
  } = req.body;

  if (!isValidObjectId(driverAccountId)) {
    const error = new Error('رقم حساب السائق غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const paymentAmount = roundMoney(amount);

  if (paymentAmount <= 0) {
    const error = new Error('قيمة السداد غير صحيحة');
    error.statusCode = 400;
    throw error;
  }

  const driverProfile = await DriverProfile.findOne({
    accountId: driverAccountId,
  });

  if (!driverProfile) {
    const error = new Error('ملف السائق غير موجود');
    error.statusCode = 404;
    throw error;
  }

  const payment = await DriverPayment.create({
    driverAccountId,
    amount: paymentAmount,
    method,
    status: 'confirmed',
    receivedByAdminId: req.accountId,
    notes: notes || '',
  });

  driverProfile.commissionDebt = roundMoney(
    Math.max(0, driverProfile.commissionDebt - paymentAmount)
  );

  driverProfile.refreshDebtBlockStatus();

  await driverProfile.save();

  let remainingPayment = paymentAmount;

  const unpaidCommissions = await CommissionTransaction.find({
    driverAccountId,
    status: 'unpaid',
  }).sort({
    createdAt: 1,
  });

  for (const commission of unpaidCommissions) {
    if (remainingPayment <= 0) {
      break;
    }

    if (remainingPayment >= commission.amount) {
      commission.status = 'paid';
      remainingPayment = roundMoney(remainingPayment - commission.amount);
      await commission.save();
    } else {
      break;
    }
  }

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم تسجيل سداد السائق بنجاح',
    doc: {
      payment,
      driverProfile,
    },
  });
});

const getDriverFinanceByAdmin = asyncHandler(async (req, res) => {
  const { driverAccountId } = req.params;

  if (!isValidObjectId(driverAccountId)) {
    const error = new Error('رقم حساب السائق غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const driverProfile = await DriverProfile.findOne({
    accountId: driverAccountId,
  });

  if (!driverProfile) {
    const error = new Error('ملف السائق غير موجود');
    error.statusCode = 404;
    throw error;
  }

  driverProfile.refreshDebtBlockStatus();
  await driverProfile.save();

  const unpaidCommissions = await CommissionTransaction.find({
    driverAccountId,
    status: 'unpaid',
  }).sort({
    createdAt: -1,
  });

  const payments = await DriverPayment.find({
    driverAccountId,
  }).sort({
    createdAt: -1,
  });

  return sendSuccess({
    res,
    message: 'تم جلب بيانات السائق المالية بنجاح',
    doc: {
      driverProfile,
      unpaidCommissions,
      payments,
    },
  });
});

module.exports = {
  getMyDriverFinance,
  recordDriverPayment,
  getDriverFinanceByAdmin,
};