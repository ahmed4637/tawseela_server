const express = require('express');
const { body, param, query } = require('express-validator');

const {
  getMyDriverFinance,
  getMyDriverEarnings,
  getMyDriverLedger,
  getMySettlementOptions,
  getMySettlements,
  createMySettlement,
  recordDriverPayment,
  getDriverFinanceByAdmin,
  getDriverLedgerByAdmin,
  listSettlementsByAdmin,
  updateSettlementByAdmin,
  createDriverDebtSnapshotByAdmin,
  listDebtSnapshotsByAdmin,
} = require('../controllers/driverFinance.controller');

const validateRequest = require('../middlewares/validateRequest');
const { protect, allowRoles } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(protect);

const periodValidation = [
  query('period')
    .optional({ checkFalsy: true })
    .isIn(['today', 'week', 'month', 'year', 'custom'])
    .withMessage('الفترة غير صحيحة'),
  query('from')
    .optional({ checkFalsy: true })
    .isISO8601()
    .withMessage('تاريخ البداية غير صحيح'),
  query('to')
    .optional({ checkFalsy: true })
    .isISO8601()
    .withMessage('تاريخ النهاية غير صحيح'),
];

router.get('/me', periodValidation, validateRequest, getMyDriverFinance);
router.get('/earnings', periodValidation, validateRequest, getMyDriverEarnings);
router.get('/ledger', getMyDriverLedger);
router.get('/settlement-options', getMySettlementOptions);
router.get('/settlements', getMySettlements);

router.post(
  '/settlements',
  [
    body('settlementType')
      .equals('driver_pays_app')
      .withMessage('نوع التسوية غير صحيح'),
    body('amount')
      .notEmpty()
      .withMessage('قيمة التسوية مطلوبة')
      .isFloat({ min: 1 })
      .withMessage('قيمة التسوية غير صحيحة'),
    body('method')
      .notEmpty()
      .withMessage('طريقة التحويل مطلوبة')
      .isIn(['wallet', 'instapay', 'bank_transfer'])
      .withMessage('طريقة التحويل غير صحيحة'),
    body('destinationAccountId')
      .notEmpty()
      .withMessage('حساب التحويل مطلوب')
      .isString()
      .trim(),
    body('senderReference')
      .notEmpty()
      .withMessage('رقم أو حساب المُرسل مطلوب')
      .isLength({ min: 4, max: 160 })
      .withMessage('رقم أو حساب المُرسل غير صحيح')
      .trim(),
    body('proofUrl')
      .notEmpty()
      .withMessage('صورة إيصال التحويل مطلوبة')
      .isString()
      .trim(),
    body('clientRequestId')
      .notEmpty()
      .withMessage('رقم محاولة التسوية مطلوب')
      .isLength({ min: 8, max: 120 })
      .withMessage('رقم محاولة التسوية غير صحيح')
      .trim(),
    body('note')
      .optional({ checkFalsy: true })
      .isLength({ max: 500 })
      .withMessage('الملاحظة طويلة جدًا')
      .trim(),
  ],
  validateRequest,
  createMySettlement,
);

router.get('/admin/settlements', allowRoles('admin'), listSettlementsByAdmin);
router.get('/admin/debt-snapshots', allowRoles('admin'), listDebtSnapshotsByAdmin);

router.post(
  '/admin/payments',
  allowRoles('admin'),
  [
    body('driverAccountId')
      .notEmpty()
      .withMessage('رقم حساب السائق مطلوب')
      .isMongoId()
      .withMessage('رقم حساب السائق غير صحيح'),
    body('amount')
      .notEmpty()
      .withMessage('قيمة السداد مطلوبة')
      .isFloat({ min: 1 })
      .withMessage('قيمة السداد غير صحيحة'),
    body('method')
      .notEmpty()
      .withMessage('طريقة السداد مطلوبة')
      .isIn(['wallet', 'bank_transfer', 'instapay'])
      .withMessage('طريقة السداد غير صحيحة'),
    body('notes')
      .optional({ checkFalsy: true })
      .trim(),
    body('reason')
      .optional({ checkFalsy: true })
      .trim(),
  ],
  validateRequest,
  recordDriverPayment,
);

router.patch(
  '/admin/settlements/:settlementId/status',
  allowRoles('admin'),
  [
    param('settlementId')
      .isMongoId()
      .withMessage('رقم طلب التسوية غير صحيح'),
    body('status')
      .notEmpty()
      .withMessage('حالة التسوية مطلوبة')
      .isIn(['approved', 'rejected', 'completed', 'cancelled'])
      .withMessage('حالة التسوية غير صحيحة'),
    body('adminNote')
      .optional({ checkFalsy: true })
      .trim(),
    body('reason')
      .optional({ checkFalsy: true })
      .trim(),
  ],
  validateRequest,
  updateSettlementByAdmin,
);

router.get(
  '/admin/:driverAccountId',
  allowRoles('admin'),
  [
    param('driverAccountId')
      .isMongoId()
      .withMessage('رقم حساب السائق غير صحيح'),
    ...periodValidation,
  ],
  validateRequest,
  getDriverFinanceByAdmin,
);

router.get(
  '/admin/:driverAccountId/ledger',
  allowRoles('admin'),
  [
    param('driverAccountId')
      .isMongoId()
      .withMessage('رقم حساب السائق غير صحيح'),
  ],
  validateRequest,
  getDriverLedgerByAdmin,
);

router.post(
  '/admin/:driverAccountId/debt-snapshot',
  allowRoles('admin'),
  [
    param('driverAccountId')
      .isMongoId()
      .withMessage('رقم حساب السائق غير صحيح'),
    body('periodType')
      .optional({ checkFalsy: true })
      .isIn(['daily', 'weekly', 'monthly', 'manual'])
      .withMessage('نوع الفترة غير صحيح'),
    body('periodStart')
      .optional({ checkFalsy: true })
      .isISO8601()
      .withMessage('تاريخ بداية الفترة غير صحيح'),
    body('periodEnd')
      .optional({ checkFalsy: true })
      .isISO8601()
      .withMessage('تاريخ نهاية الفترة غير صحيح'),
    body('reason')
      .optional({ checkFalsy: true })
      .trim(),
  ],
  validateRequest,
  createDriverDebtSnapshotByAdmin,
);

module.exports = router;
