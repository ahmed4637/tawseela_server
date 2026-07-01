const express = require('express');
const { body, param } = require('express-validator');

const { protect, allowRoles } = require('../middlewares/authMiddleware');
const validateRequest = require('../middlewares/validateRequest');
const {
  getAdminLoyaltyAccounts,
  getAdminLoyaltyAccountDetails,
  adjustLoyaltyPointsForAdmin,
  getAdminLoyaltyTransactions,
  getAdminLoyaltySettings,
  updateAdminLoyaltySettings,
} = require('../controllers/loyalty.controller');

const router = express.Router();

router.use(protect, allowRoles('admin'));

router.get('/settings', getAdminLoyaltySettings);
router.patch(
  '/settings',
  [
    body('isEnabled')
      .optional()
      .isBoolean()
      .withMessage('حالة تفعيل الولاء غير صحيحة'),
    body('customerEarnPointsPerFarePound')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('نقاط العميل لكل جنيه غير صحيحة'),
    body('driverEarnPointsPerCompletedRequest')
      .optional()
      .isInt({ min: 0 })
      .withMessage('نقاط السائق لكل رحلة غير صحيحة'),
    body('customerAfterAcceptanceCancelDeductionPoints')
      .optional()
      .isInt({ min: 0 })
      .withMessage('نقاط خصم العميل عند الإلغاء غير صحيحة'),
    body('driverAfterAcceptanceCancelDeductionPoints')
      .optional()
      .isInt({ min: 0 })
      .withMessage('نقاط خصم السائق عند الإلغاء غير صحيحة'),
    body('allowNegativeBalance')
      .optional()
      .isBoolean()
      .withMessage('إعداد الرصيد السالب غير صحيح'),
    body('tierRules.silver')
      .optional()
      .isInt({ min: 0 })
      .withMessage('حد المستوى الفضي غير صحيح'),
    body('tierRules.gold')
      .optional()
      .isInt({ min: 0 })
      .withMessage('حد المستوى الذهبي غير صحيح'),
    body('tierRules.platinum')
      .optional()
      .isInt({ min: 0 })
      .withMessage('حد المستوى البلاتيني غير صحيح'),
    body('reason')
      .optional({ checkFalsy: true })
      .trim(),
  ],
  validateRequest,
  updateAdminLoyaltySettings
);

router.get('/accounts', getAdminLoyaltyAccounts);
router.get(
  '/accounts/:accountId',
  [param('accountId').isMongoId().withMessage('رقم الحساب غير صحيح')],
  validateRequest,
  getAdminLoyaltyAccountDetails
);
router.post(
  '/accounts/:accountId/adjust',
  [
    param('accountId').isMongoId().withMessage('رقم الحساب غير صحيح'),
    body('accountRole')
      .optional()
      .isIn(['customer', 'driver'])
      .withMessage('نوع الحساب غير صحيح'),
    body('direction')
      .isIn(['credit', 'debit'])
      .withMessage('اتجاه الحركة غير صحيح'),
    body('points')
      .isInt({ min: 1 })
      .withMessage('عدد النقاط غير صحيح'),
    body('reason')
      .trim()
      .notEmpty()
      .withMessage('سبب تعديل النقاط مطلوب'),
  ],
  validateRequest,
  adjustLoyaltyPointsForAdmin
);

router.get('/transactions', getAdminLoyaltyTransactions);

module.exports = router;
