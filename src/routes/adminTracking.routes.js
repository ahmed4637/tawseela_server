const express = require('express');
const { body, param, query } = require('express-validator');

const {
  getAdminTrackingSettings,
  updateAdminTrackingSettings,
  getAdminRequestLocationHistory,
} = require('../controllers/tracking.controller');

const validateRequest = require('../middlewares/validateRequest');
const { protect, allowRoles } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(protect);
router.use(allowRoles('admin'));

router.get('/settings', getAdminTrackingSettings);

router.patch(
  '/settings',
  [
    body('liveUpdateSeconds')
      .optional()
      .isInt({ min: 1, max: 60 })
      .withMessage('مدة تحديث اللايف غير صحيحة'),

    body('driverProfileSaveSeconds')
      .optional()
      .isInt({ min: 1, max: 300 })
      .withMessage('مدة حفظ آخر موقع للسائق غير صحيحة'),

    body('dbSaveSeconds')
      .optional()
      .isInt({ min: 1, max: 600 })
      .withMessage('مدة حفظ مسار الرحلة غير صحيحة'),

    body('minDistanceMetersToSave')
      .optional()
      .isFloat({ min: 0, max: 5000 })
      .withMessage('أقل مسافة لحفظ نقطة تتبع غير صحيحة'),

    body('staleLocationWarningSeconds')
      .optional()
      .isInt({ min: 5, max: 3600 })
      .withMessage('مدة تنبيه انقطاع الموقع غير صحيحة'),

    body('saveOnlyDuringActiveRequest')
      .optional()
      .isBoolean()
      .withMessage('حالة حفظ المسار غير صحيحة'),

    body('adminLiveTrackingEnabled')
      .optional()
      .isBoolean()
      .withMessage('حالة تتبع الداشبورد غير صحيحة'),

    body('reason')
      .optional({ checkFalsy: true })
      .trim(),
  ],
  validateRequest,
  updateAdminTrackingSettings
);

router.get(
  '/requests/:serviceRequestId/location-history',
  [
    param('serviceRequestId')
      .isMongoId()
      .withMessage('رقم الطلب غير صحيح'),

    query('limit')
      .optional()
      .isInt({ min: 1, max: 2000 })
      .withMessage('عدد نقاط التتبع غير صحيح'),
  ],
  validateRequest,
  getAdminRequestLocationHistory
);

module.exports = router;
