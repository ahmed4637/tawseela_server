const express = require('express');
const { body } = require('express-validator');
const {
  signup,
  login,
  resetPasswordWithFirebasePhone,
  becomeDriver,
  addDriverVehicle,
  updateDriverVehicle,
  switchRole,
  getDriverReviewStatus,
  resubmitDriverReview,
  setDriverOnline,
  setDriverOffline,
  getMe,
  updateMe,
} = require('../controllers/auth.controller');
const {
  registerMyDeviceToken,
  deactivateMyDeviceToken,
} = require('../controllers/notification.controller');

const validateRequest = require('../middlewares/validateRequest');
const { protect } = require('../middlewares/authMiddleware');

const router = express.Router();

const egyptianPhoneValidator = body('phone')
  .trim()
  .notEmpty()
  .withMessage('رقم الهاتف مطلوب')
  .matches(/^(010|011|012|015)\d{8}$/)
  .withMessage('رقم الهاتف يجب أن يكون رقم مصري صحيح');

router.post(
  '/signup',
  [
    body('name')
      .trim()
      .notEmpty()
      .withMessage('اسم المستخدم مطلوب')
      .isLength({ min: 2 })
      .withMessage('اسم المستخدم قصير جدًا'),

    body('email')
      .optional({ checkFalsy: true })
      .trim()
      .isEmail()
      .withMessage('البريد الإلكتروني غير صحيح'),

    egyptianPhoneValidator,

    body('password')
      .notEmpty()
      .withMessage('كلمة المرور مطلوبة')
      .isLength({ min: 6 })
      .withMessage('كلمة المرور يجب ألا تقل عن 6 أحرف'),
  ],
  validateRequest,
  signup
);

router.post(
  '/login',
  [
    egyptianPhoneValidator,
    body('password').notEmpty().withMessage('كلمة المرور مطلوبة'),
  ],
  validateRequest,
  login
);

router.post(
  '/password-reset/firebase-phone',
  [
    body('firebaseIdToken')
      .trim()
      .notEmpty()
      .withMessage('جلسة التحقق من رقم الموبايل مطلوبة'),

    body('newPassword')
      .notEmpty()
      .withMessage('كلمة السر الجديدة مطلوبة')
      .isLength({ min: 6, max: 128 })
      .withMessage('كلمة السر يجب أن تكون من 6 إلى 128 حرفًا'),
  ],
  validateRequest,
  resetPasswordWithFirebasePhone
);


router.post(
  '/device-token',
  protect,
  [
    body('token')
      .trim()
      .notEmpty()
      .withMessage('Token الإشعارات مطلوب'),

    body('platform')
      .isIn(['android', 'ios', 'web'])
      .withMessage('نوع الجهاز غير صحيح'),

    body('deviceId')
      .optional({ checkFalsy: true })
      .trim(),

    body('appVersion')
      .optional({ checkFalsy: true })
      .trim(),

    body('locale')
      .optional({ checkFalsy: true })
      .trim(),
  ],
  validateRequest,
  registerMyDeviceToken
);

router.post(
  '/logout',
  protect,
  [
    body('token')
      .optional({ checkFalsy: true })
      .trim(),

    body('deviceId')
      .optional({ checkFalsy: true })
      .trim(),
  ],
  validateRequest,
  deactivateMyDeviceToken
);

router.post(
  '/become-driver',
  protect,
  [
    body('nationalIdImage')
      .trim()
      .notEmpty()
      .withMessage('صورة البطاقة مطلوبة'),

    body('vehicleTypeCode')
      .trim()
      .notEmpty()
      .withMessage('كود نوع المركبة مطلوب'),

    body('vehicleTypeName')
      .trim()
      .notEmpty()
      .withMessage('اسم نوع المركبة مطلوب'),

    body('vehicleImage')
      .trim()
      .notEmpty()
      .withMessage('صورة المركبة مطلوبة'),

    body('licenseImage')
      .optional({ checkFalsy: true })
      .trim(),

    body('vehicleTypeId')
      .optional({ checkFalsy: true })
      .isMongoId()
      .withMessage('نوع المركبة غير صحيح'),

    body('model')
      .optional({ checkFalsy: true })
      .trim(),

    body('plateNumber')
      .optional({ checkFalsy: true })
      .trim(),

    body('color')
      .optional({ checkFalsy: true })
      .trim(),

    body('profileImage')
      .optional({ checkFalsy: true })
      .trim(),

    body('notes')
      .optional({ checkFalsy: true })
      .trim(),
  ],
  validateRequest,
  becomeDriver
);

router.post(
  '/driver-vehicles',
  protect,
  [
    body('vehicleTypeCode')
      .trim()
      .notEmpty()
      .withMessage('كود نوع المركبة مطلوب'),

    body('vehicleTypeName')
      .trim()
      .notEmpty()
      .withMessage('اسم نوع المركبة مطلوب'),

    body('vehicleImage')
      .trim()
      .notEmpty()
      .withMessage('صورة المركبة مطلوبة'),

    body('licenseImage')
      .optional({ checkFalsy: true })
      .trim(),

    body('vehicleTypeId')
      .optional({ checkFalsy: true })
      .isMongoId()
      .withMessage('نوع المركبة غير صحيح'),

    body('model')
      .optional({ checkFalsy: true })
      .trim(),

    body('plateNumber')
      .optional({ checkFalsy: true })
      .trim(),

    body('color')
      .optional({ checkFalsy: true })
      .trim(),

    body('notes')
      .optional({ checkFalsy: true })
      .trim(),

    body('isDefault')
      .optional()
      .isBoolean()
      .withMessage('حالة المركبة الافتراضية غير صحيحة'),
  ],
  validateRequest,
  addDriverVehicle
);

router.put(
  '/driver-vehicles/:vehicleId',
  protect,
  [
    body('vehicleTypeCode')
      .optional({ checkFalsy: true })
      .trim(),

    body('vehicleTypeName')
      .optional({ checkFalsy: true })
      .trim(),

    body('vehicleImage')
      .optional({ checkFalsy: true })
      .trim(),

    body('vehicleTypeId')
      .optional({ checkFalsy: true })
      .isMongoId()
      .withMessage('نوع المركبة غير صحيح'),

    body('model')
      .optional({ checkFalsy: true })
      .trim(),

    body('plateNumber')
      .optional({ checkFalsy: true })
      .trim(),

    body('color')
      .optional({ checkFalsy: true })
      .trim(),

    body('licenseImage')
      .optional({ checkFalsy: true })
      .trim(),

    body('notes')
      .optional({ checkFalsy: true })
      .trim(),

    body('isDefault')
      .optional()
      .isBoolean()
      .withMessage('حالة المركبة الافتراضية غير صحيحة'),
  ],
  validateRequest,
  updateDriverVehicle
);



router.post(
  '/driver/online',
  protect,
  [
    body('lat')
      .optional({ nullable: true })
      .isNumeric()
      .withMessage('خط العرض غير صحيح'),
    body('lng')
      .optional({ nullable: true })
      .isNumeric()
      .withMessage('خط الطول غير صحيح'),
    body('latitude')
      .optional({ nullable: true })
      .isNumeric()
      .withMessage('خط العرض غير صحيح'),
    body('longitude')
      .optional({ nullable: true })
      .isNumeric()
      .withMessage('خط الطول غير صحيح'),
    body('vehicleTypeCode')
      .optional({ checkFalsy: true })
      .trim(),
  ],
  validateRequest,
  setDriverOnline
);

router.post('/driver/offline', protect, setDriverOffline);

router.get('/driver-review/status', protect, getDriverReviewStatus);

router.post(
  '/driver-review/resubmit',
  protect,
  [
    body('reason')
      .optional({ checkFalsy: true })
      .trim(),
  ],
  validateRequest,
  resubmitDriverReview
);

router.post(
  '/switch-role',
  protect,
  [
    body('role')
      .trim()
      .notEmpty()
      .withMessage('نوع الحساب مطلوب')
      .isIn(['customer', 'driver', 'admin'])
      .withMessage('نوع الحساب غير صحيح'),
  ],
  validateRequest,
  switchRole
);
router.put(
  '/me',
  protect,
  [
    body('name')
      .optional({ checkFalsy: true })
      .trim()
      .isLength({ min: 2 })
      .withMessage('اسم المستخدم قصير جدًا'),

    body('email')
      .optional({ checkFalsy: true })
      .trim()
      .isEmail()
      .withMessage('البريد الإلكتروني غير صحيح'),

    body('phone')
      .optional({ checkFalsy: true })
      .trim()
      .matches(/^(010|011|012|015)\d{8}$/)
      .withMessage('رقم الهاتف يجب أن يكون رقم مصري صحيح'),

   body('password')
  .optional({ checkFalsy: true })
  .trim()
  .isLength({ min: 6 })
  .withMessage('كلمة المرور يجب ألا تقل عن 6 أحرف'),

    body('profileImage')
      .optional({ checkFalsy: true })
      .trim(),
  ],
  validateRequest,
  updateMe
);

router.get('/me', protect, getMe);

module.exports = router;