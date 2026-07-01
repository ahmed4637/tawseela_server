const express = require('express');
const { body, param } = require('express-validator');

const { protect, allowRoles } = require('../middlewares/authMiddleware');
const validateRequest = require('../middlewares/validateRequest');
const {
  getCancellationPolicies,
  createCancellationPolicy,
  updateCancellationPolicy,
  getPenaltyLogs,
  getAccountRestrictions,
  createManualPenalty,
  deactivateRestriction,
} = require('../controllers/penalty.controller');

const router = express.Router();

router.use(protect, allowRoles('admin'));

router.get('/cancellation-policies', getCancellationPolicies);

router.post(
  '/cancellation-policies',
  [
    body('actorType')
      .isIn(['customer', 'driver'])
      .withMessage('نوع المستخدم غير صحيح'),
    body('serviceType')
      .optional()
      .isIn(['all', 'instant_ride', 'scheduled_ride', 'delivery_order'])
      .withMessage('نوع الخدمة غير صحيح'),
    body('repeatedCancelLimit')
      .optional()
      .isInt({ min: 1 })
      .withMessage('حد تكرار الإلغاء غير صحيح'),
    body('repeatedCancelWindowHours')
      .optional()
      .isInt({ min: 1 })
      .withMessage('مدة احتساب التكرار غير صحيحة'),
    body('beforeAcceptanceBlockMinutes')
      .optional()
      .isInt({ min: 0 })
      .withMessage('مدة الحظر قبل القبول غير صحيحة'),
    body('afterAcceptanceBlockMinutes')
      .optional()
      .isInt({ min: 0 })
      .withMessage('مدة الحظر بعد القبول غير صحيحة'),
    body('loyaltyDeductionPoints')
      .optional()
      .isInt({ min: 0 })
      .withMessage('نقاط الخصم غير صحيحة'),
    body('driverCouponRemoveMode')
      .optional()
      .isIn(['none', 'all', 'unused', 'campaign_specific'])
      .withMessage('طريقة حذف كوبونات السائق غير صحيحة'),
  ],
  validateRequest,
  createCancellationPolicy
);

router.patch(
  '/cancellation-policies/:id',
  [
    param('id').isMongoId().withMessage('رقم سياسة الإلغاء غير صحيح'),
    body('repeatedCancelLimit')
      .optional()
      .isInt({ min: 1 })
      .withMessage('حد تكرار الإلغاء غير صحيح'),
    body('repeatedCancelWindowHours')
      .optional()
      .isInt({ min: 1 })
      .withMessage('مدة احتساب التكرار غير صحيحة'),
    body('beforeAcceptanceBlockMinutes')
      .optional()
      .isInt({ min: 0 })
      .withMessage('مدة الحظر قبل القبول غير صحيحة'),
    body('afterAcceptanceBlockMinutes')
      .optional()
      .isInt({ min: 0 })
      .withMessage('مدة الحظر بعد القبول غير صحيحة'),
    body('loyaltyDeductionPoints')
      .optional()
      .isInt({ min: 0 })
      .withMessage('نقاط الخصم غير صحيحة'),
    body('driverCouponRemoveMode')
      .optional()
      .isIn(['none', 'all', 'unused', 'campaign_specific'])
      .withMessage('طريقة حذف كوبونات السائق غير صحيحة'),
  ],
  validateRequest,
  updateCancellationPolicy
);

router.get('/penalties', getPenaltyLogs);
router.post(
  '/penalties',
  [
    body('accountId').isMongoId().withMessage('رقم الحساب غير صحيح'),
    body('accountRole')
      .isIn(['customer', 'driver'])
      .withMessage('نوع الحساب غير صحيح'),
    body('blockMinutes')
      .optional()
      .isInt({ min: 0 })
      .withMessage('مدة الحظر غير صحيحة'),
    body('restrictionTypes')
      .optional()
      .isArray()
      .withMessage('أنواع الحظر يجب أن تكون قائمة'),
    body('loyaltyPointsDeducted')
      .optional()
      .isInt({ min: 0 })
      .withMessage('نقاط الخصم غير صحيحة'),
  ],
  validateRequest,
  createManualPenalty
);

router.get('/restrictions', getAccountRestrictions);
router.post(
  '/restrictions/:id/deactivate',
  [param('id').isMongoId().withMessage('رقم الحظر غير صحيح')],
  validateRequest,
  deactivateRestriction
);

module.exports = router;
