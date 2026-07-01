const express = require('express');
const { body, param } = require('express-validator');

const {
  getAdminServiceVehicleConfigs,
  getAdminServiceVehicleConfigById,
  createAdminServiceVehicleConfig,
  updateAdminServiceVehicleConfig,
  syncServiceVehicleConfigsFromVehicles,
} = require('../controllers/serviceVehicleConfig.controller');

const validateRequest = require('../middlewares/validateRequest');
const { protect, allowRoles } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(protect);
router.use(allowRoles('admin'));

const configValidators = [
  body('vehicleTypeId')
    .optional({ checkFalsy: true })
    .isMongoId()
    .withMessage('رقم نوع المركبة غير صحيح'),

  body('vehicleTypeCode')
    .optional({ checkFalsy: true })
    .trim(),

  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('حالة الإعداد غير صحيحة'),

  body('minFare')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('أقل سعر غير صحيح'),

  body('baseFare')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('سعر البداية غير صحيح'),

  body('pricePerKm')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('سعر الكيلو غير صحيح'),

  body('pricePerMinute')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('سعر الدقيقة غير صحيح'),

  body('waitingPricePerMinute')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('سعر انتظار الدقيقة غير صحيح'),

  body('extraPricePerKm')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('سعر الكيلو الإضافي غير صحيح'),

  body('commissionType')
    .optional()
    .isIn(['percentage', 'fixed'])
    .withMessage('نوع العمولة غير صحيح'),

  body('commissionValue')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('قيمة العمولة غير صحيحة'),

  body('defaultRadiusKm')
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

  body('allowNegotiation')
    .optional()
    .isBoolean()
    .withMessage('حالة التفاوض غير صحيحة'),

  body('allowCoupon')
    .optional()
    .isBoolean()
    .withMessage('حالة الكوبون غير صحيحة'),

  body('notes')
    .optional({ checkFalsy: true })
    .trim(),

  body('reason')
    .optional({ checkFalsy: true })
    .trim(),
];

router.get('/', getAdminServiceVehicleConfigs);

router.post('/sync-from-vehicles', syncServiceVehicleConfigsFromVehicles);

router.get(
  '/:id',
  [
    param('id')
      .isMongoId()
      .withMessage('رقم إعداد الخدمة والمركبة غير صحيح'),
  ],
  validateRequest,
  getAdminServiceVehicleConfigById
);

router.post(
  '/',
  [
    body('serviceType')
      .trim()
      .isIn(['instant_ride', 'scheduled_ride', 'delivery_order'])
      .withMessage('نوع الخدمة غير صحيح'),

    ...configValidators,
  ],
  validateRequest,
  createAdminServiceVehicleConfig
);

router.patch(
  '/:id',
  [
    param('id')
      .isMongoId()
      .withMessage('رقم إعداد الخدمة والمركبة غير صحيح'),

    ...configValidators,
  ],
  validateRequest,
  updateAdminServiceVehicleConfig
);

module.exports = router;
