const express = require('express');
const { body, param } = require('express-validator');

const {
  getMyDriverFinance,
  recordDriverPayment,
  getDriverFinanceByAdmin,
} = require('../controllers/driverFinance.controller');

const validateRequest = require('../middlewares/validateRequest');
const { protect, allowRoles } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(protect);

router.get('/me', getMyDriverFinance);

router.get(
  '/admin/:driverAccountId',
  allowRoles('admin'),
  [
    param('driverAccountId')
      .isMongoId()
      .withMessage('رقم حساب السائق غير صحيح'),
  ],
  validateRequest,
  getDriverFinanceByAdmin
);

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
      .optional({ checkFalsy: true })
      .isIn(['cash', 'wallet', 'bank_transfer', 'vodafone_cash', 'manual'])
      .withMessage('طريقة السداد غير صحيحة'),

    body('notes')
      .optional({ checkFalsy: true })
      .trim(),
  ],
  validateRequest,
  recordDriverPayment
);

module.exports = router;