const express = require('express');
const { body, param } = require('express-validator');

const {
  getAdminDispatchSettings,
  getAdminDispatchSettingById,
  createAdminDispatchSetting,
  updateAdminDispatchSetting,
  syncDispatchSettingsFromVehicles,
} = require('../controllers/dispatchSetting.controller');

const validateRequest = require('../middlewares/validateRequest');
const { protect, allowRoles } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(protect);
router.use(allowRoles('admin'));

const dispatchValidators = [
  body('vehicleTypeId')
    .optional({ checkFalsy: true })
    .isMongoId()
    .withMessage('رقم نوع المركبة غير صحيح'),

  body('vehicleTypeCode')
    .optional({ checkFalsy: true })
    .trim(),

  body('radiusKm')
    .optional()
    .isFloat({ min: 1, max: 100 })
    .withMessage('نطاق البحث غير صحيح'),

  body('maxDriversToNotify')
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage('عدد السائقين غير صحيح'),

  body('requestExpirySeconds')
    .optional()
    .isInt({ min: 10 })
    .withMessage('مدة انتهاء الطلب غير صحيحة'),

  body('offerExpirySeconds')
    .optional()
    .isInt({ min: 10 })
    .withMessage('مدة انتهاء العرض غير صحيحة'),

  body('locationFreshnessSeconds')
    .optional()
    .isInt({ min: 5 })
    .withMessage('مدة صلاحية اللوكيشن غير صحيحة'),

  body('useDriverScore')
    .optional()
    .isBoolean()
    .withMessage('حالة استخدام تقييم السائق غير صحيحة'),

  body('useDistancePriority')
    .optional()
    .isBoolean()
    .withMessage('حالة أولوية المسافة غير صحيحة'),

  body('useAcceptanceRate')
    .optional()
    .isBoolean()
    .withMessage('حالة معدل القبول غير صحيحة'),

  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('حالة إعداد التوزيع غير صحيحة'),

  body('reason')
    .optional({ checkFalsy: true })
    .trim(),
];

router.get('/', getAdminDispatchSettings);

router.post('/sync-from-vehicles', syncDispatchSettingsFromVehicles);

router.get(
  '/:id',
  [
    param('id')
      .isMongoId()
      .withMessage('رقم إعداد التوزيع غير صحيح'),
  ],
  validateRequest,
  getAdminDispatchSettingById
);

router.post(
  '/',
  [
    body('serviceType')
      .trim()
      .isIn(['instant_ride', 'scheduled_ride', 'delivery_order'])
      .withMessage('نوع الخدمة غير صحيح'),

    ...dispatchValidators,
  ],
  validateRequest,
  createAdminDispatchSetting
);

router.patch(
  '/:id',
  [
    param('id')
      .isMongoId()
      .withMessage('رقم إعداد التوزيع غير صحيح'),

    ...dispatchValidators,
  ],
  validateRequest,
  updateAdminDispatchSetting
);

module.exports = router;
