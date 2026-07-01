const express = require('express');
const { body, param } = require('express-validator');

const {
  getAdminServiceTypes,
  getAdminServiceTypeByIdOrKey,
  createAdminServiceType,
  updateAdminServiceType,
} = require('../controllers/serviceType.controller');

const validateRequest = require('../middlewares/validateRequest');
const { protect, allowRoles } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(protect);
router.use(allowRoles('admin'));

const serviceTypeValidators = [
  body('nameAr')
    .optional({ checkFalsy: false })
    .trim()
    .notEmpty()
    .withMessage('اسم الخدمة بالعربي مطلوب'),

  body('nameEn')
    .optional({ checkFalsy: true })
    .trim(),

  body('description')
    .optional({ checkFalsy: true })
    .trim(),

  body('iconUrl')
    .optional({ checkFalsy: true })
    .trim(),

  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('حالة الخدمة غير صحيحة'),

  body('allowNegotiation')
    .optional()
    .isBoolean()
    .withMessage('حالة التفاوض غير صحيحة'),

  body('allowCustomerCoupon')
    .optional()
    .isBoolean()
    .withMessage('حالة كوبون العميل غير صحيحة'),

  body('allowDriverCoupon')
    .optional()
    .isBoolean()
    .withMessage('حالة كوبون السائق غير صحيحة'),

  body('sortOrder')
    .optional()
    .isInt({ min: 0 })
    .withMessage('ترتيب الخدمة غير صحيح'),

  body('reason')
    .optional({ checkFalsy: true })
    .trim(),
];

router.get('/', getAdminServiceTypes);

router.get(
  '/:idOrKey',
  [
    param('idOrKey')
      .trim()
      .notEmpty()
      .withMessage('رقم أو كود الخدمة مطلوب'),
  ],
  validateRequest,
  getAdminServiceTypeByIdOrKey
);

router.post(
  '/',
  [
    body('key')
      .trim()
      .isIn(['instant_ride', 'scheduled_ride', 'delivery_order'])
      .withMessage('كود الخدمة غير صحيح'),

    body('nameAr')
      .trim()
      .notEmpty()
      .withMessage('اسم الخدمة بالعربي مطلوب'),

    ...serviceTypeValidators,
  ],
  validateRequest,
  createAdminServiceType
);

router.patch(
  '/:idOrKey',
  [
    param('idOrKey')
      .trim()
      .notEmpty()
      .withMessage('رقم أو كود الخدمة مطلوب'),

    ...serviceTypeValidators,
  ],
  validateRequest,
  updateAdminServiceType
);

module.exports = router;
