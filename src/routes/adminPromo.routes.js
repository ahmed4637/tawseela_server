const express = require('express');
const { body, param } = require('express-validator');

const validateRequest = require('../middlewares/validateRequest');
const { protect, allowRoles } = require('../middlewares/authMiddleware');
const {
  getPromoCodesForAdmin,
  createPromoCode,
  updatePromoCode,
  setPromoCodeStatus,
  getPromoRedemptionsForAdmin,
} = require('../controllers/promo.controller');

const router = express.Router();

router.use(protect, allowRoles('admin'));

router.get('/', getPromoCodesForAdmin);

router.post(
  '/',
  [
    body('code').trim().notEmpty().withMessage('كود الكوبون مطلوب'),
    body('promoType')
      .isIn(['customer', 'driver'])
      .withMessage('نوع الكوبون غير صحيح'),
    body('discountType')
      .isIn(['fixed', 'percentage'])
      .withMessage('نوع الخصم غير صحيح'),
    body('discountValue')
      .isFloat({ min: 0.01 })
      .withMessage('قيمة الخصم غير صحيحة'),
    body('maxDiscountAmount')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('أقصى خصم غير صحيح'),
    body('minFare')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('أقل قيمة استخدام غير صحيحة'),
    body('usageLimitTotal')
      .optional()
      .isInt({ min: 0 })
      .withMessage('إجمالي الاستخدام غير صحيح'),
    body('usageLimitPerAccount')
      .optional()
      .isInt({ min: 0 })
      .withMessage('حد الاستخدام لكل حساب غير صحيح'),
    body('startsAt')
      .optional({ checkFalsy: true })
      .isISO8601()
      .withMessage('تاريخ بداية الكوبون غير صحيح'),
    body('endsAt')
      .optional({ checkFalsy: true })
      .isISO8601()
      .withMessage('تاريخ نهاية الكوبون غير صحيح'),
  ],
  validateRequest,
  createPromoCode
);

router.get('/redemptions', getPromoRedemptionsForAdmin);

router.patch(
  '/:id',
  [
    param('id').isMongoId().withMessage('رقم الكوبون غير صحيح'),
    body('discountType')
      .optional()
      .isIn(['fixed', 'percentage'])
      .withMessage('نوع الخصم غير صحيح'),
    body('discountValue')
      .optional()
      .isFloat({ min: 0.01 })
      .withMessage('قيمة الخصم غير صحيحة'),
    body('maxDiscountAmount')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('أقصى خصم غير صحيح'),
    body('minFare')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('أقل قيمة استخدام غير صحيحة'),
  ],
  validateRequest,
  updatePromoCode
);

router.patch(
  '/:id/status',
  [
    param('id').isMongoId().withMessage('رقم الكوبون غير صحيح'),
    body('isActive').isBoolean().withMessage('حالة الكوبون غير صحيحة'),
  ],
  validateRequest,
  setPromoCodeStatus
);

module.exports = router;
