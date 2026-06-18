const express = require('express');
const { body, param } = require('express-validator');

const {
  getAllVehicles,
  getVehicleByIdOrCode,
  createVehicle,
  updateVehicle,
  deleteVehicle,
} = require('../controllers/vehicle.controller');

const validateRequest = require('../middlewares/validateRequest');
const { protect, allowRoles } = require('../middlewares/authMiddleware');

const router = express.Router();

const vehicleBodyValidators = [
  body('name')
    .optional({ checkFalsy: false })
    .trim()
    .notEmpty()
    .withMessage('اسم المركبة مطلوب'),

  body('code')
    .optional({ checkFalsy: false })
    .trim()
    .notEmpty()
    .withMessage('كود المركبة مطلوب'),

  body('category')
    .optional()
    .isIn(['passenger', 'goods', 'mixed'])
    .withMessage('تصنيف المركبة غير صحيح'),

  body('description')
    .optional({ checkFalsy: true })
    .trim(),

  body('seatsCount')
    .optional()
    .isInt({ min: 0 })
    .withMessage('عدد المقاعد غير صحيح'),

  body('maxLoadKg')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('الحمولة غير صحيحة'),

  body('canCarryPassengers')
    .optional()
    .isBoolean()
    .withMessage('حالة نقل الركاب غير صحيحة'),

  body('canCarryGoods')
    .optional()
    .isBoolean()
    .withMessage('حالة نقل البضائع غير صحيحة'),

  body('allowedServices')
    .optional()
    .isArray()
    .withMessage('الخدمات المسموحة يجب أن تكون قائمة'),

  body('allowedServices.*')
    .optional()
    .isIn(['instant_ride', 'scheduled_ride', 'delivery_order'])
    .withMessage('نوع الخدمة غير صحيح'),

  body('startPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('سعر فتح العداد غير صحيح'),

  body('pricePerKm')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('سعر الكيلو غير صحيح'),

  body('minPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('الحد الأدنى للسعر غير صحيح'),

  body('commission.instantRidePercent')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('عمولة المشوار غير صحيحة'),

  body('commission.scheduledRidePercent')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('عمولة الحجز غير صحيحة'),

  body('commission.deliveryOrderPercent')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('عمولة الطلب غير صحيحة'),

  body('requiresLicense')
    .optional()
    .isBoolean()
    .withMessage('حالة الرخصة غير صحيحة'),

  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('حالة المركبة غير صحيحة'),

  body('order')
    .optional()
    .isInt({ min: 0 })
    .withMessage('ترتيب المركبة غير صحيح'),
];

router.get('/', getAllVehicles);

router.get(
  '/:id',
  [
    param('id')
      .trim()
      .notEmpty()
      .withMessage('رقم أو كود المركبة مطلوب'),
  ],
  validateRequest,
  getVehicleByIdOrCode
);

router.post(
  '/',
  protect,
  allowRoles('admin'),
  [
    body('name')
      .trim()
      .notEmpty()
      .withMessage('اسم المركبة مطلوب'),

    body('code')
      .trim()
      .notEmpty()
      .withMessage('كود المركبة مطلوب'),

    ...vehicleBodyValidators,
  ],
  validateRequest,
  createVehicle
);

router.put(
  '/:id',
  protect,
  allowRoles('admin'),
  [
    param('id')
      .trim()
      .notEmpty()
      .withMessage('رقم أو كود المركبة مطلوب'),

    ...vehicleBodyValidators,
  ],
  validateRequest,
  updateVehicle
);

router.delete(
  '/:id',
  protect,
  allowRoles('admin'),
  [
    param('id')
      .trim()
      .notEmpty()
      .withMessage('رقم أو كود المركبة مطلوب'),
  ],
  validateRequest,
  deleteVehicle
);

module.exports = router;