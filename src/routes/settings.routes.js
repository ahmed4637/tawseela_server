const express = require('express');
const { body } = require('express-validator');

const {
  getPublicSettings,
  getAdminSettings,
  updateAdminSettings,
  resetSettingsToDefault,
} = require('../controllers/settings.controller');

const validateRequest = require('../middlewares/validateRequest');
const { protect, allowRoles } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/public', getPublicSettings);

router.get('/admin', protect, allowRoles('admin'), getAdminSettings);

router.put(
  '/admin',
  protect,
  allowRoles('admin'),
  [
    body('driverCommissionDebtLimit')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('حد مديونية السائق غير صحيح'),

    body('searchRadiusKm.instantRide')
      .optional()
      .isFloat({ min: 1, max: 100 })
      .withMessage('نطاق المشوار الفوري غير صحيح'),

    body('searchRadiusKm.deliveryOrder')
      .optional()
      .isFloat({ min: 1, max: 100 })
      .withMessage('نطاق الطلب غير صحيح'),

    body('searchRadiusKm.scheduledRide')
      .optional()
      .isFloat({ min: 1, max: 100 })
      .withMessage('نطاق الحجز غير صحيح'),

    body('scheduledRemindersMinutes.twoHours')
      .optional()
      .isInt({ min: 1 })
      .withMessage('تذكير الساعتين غير صحيح'),

    body('scheduledRemindersMinutes.oneHour')
      .optional()
      .isInt({ min: 1 })
      .withMessage('تذكير الساعة غير صحيح'),

    body('scheduledRemindersMinutes.thirtyMinutes')
      .optional()
      .isInt({ min: 1 })
      .withMessage('تذكير نصف ساعة غير صحيح'),

    body('scheduledRemindersMinutes.tenMinutes')
      .optional()
      .isInt({ min: 1 })
      .withMessage('تذكير عشر دقائق غير صحيح'),

    body('support.phone')
      .optional({ checkFalsy: true })
      .trim(),

    body('support.whatsapp')
      .optional({ checkFalsy: true })
      .trim(),

    body('support.email')
      .optional({ checkFalsy: true })
      .trim()
      .isEmail()
      .withMessage('بريد الدعم غير صحيح'),

    body('appStatus.isMaintenanceMode')
      .optional()
      .isBoolean()
      .withMessage('حالة الصيانة غير صحيحة'),

    body('appStatus.maintenanceMessage')
      .optional({ checkFalsy: true })
      .trim(),
  ],
  validateRequest,
  updateAdminSettings
);

router.post(
  '/admin/reset',
  protect,
  allowRoles('admin'),
  resetSettingsToDefault
);

module.exports = router;