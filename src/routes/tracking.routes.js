const express = require('express');
const { body, param, query } = require('express-validator');

const {
  getPublicTrackingSettings,
  getRequestLatestDriverLocation,
  getMyRequestLocationHistory,
  updateMyDriverLocationForRequest,
} = require('../controllers/tracking.controller');

const validateRequest = require('../middlewares/validateRequest');
const { protect } = require('../middlewares/authMiddleware');

const router = express.Router();

const isValidLocationTimestamp = (value) => {
  if (value === undefined || value === null || value === '') {
    return true;
  }

  const numericValue = Number(value);
  const parsed = Number.isFinite(numericValue)
    ? new Date(numericValue < 1e12 ? numericValue * 1000 : numericValue)
    : new Date(value);

  return !Number.isNaN(parsed.getTime());
};

router.use(protect);

router.get('/settings', getPublicTrackingSettings);


router.post(
  '/requests/:serviceRequestId/driver-location',
  [
    param('serviceRequestId')
      .isMongoId()
      .withMessage('رقم الطلب غير صحيح'),

    body('lat')
      .optional()
      .isFloat({ min: -90, max: 90 })
      .withMessage('خط عرض الموقع غير صحيح'),

    body('lng')
      .optional()
      .isFloat({ min: -180, max: 180 })
      .withMessage('خط طول الموقع غير صحيح'),

    body('latitude')
      .optional()
      .isFloat({ min: -90, max: 90 })
      .withMessage('خط عرض الموقع غير صحيح'),

    body('longitude')
      .optional()
      .isFloat({ min: -180, max: 180 })
      .withMessage('خط طول الموقع غير صحيح'),

    body('speed')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('سرعة السائق غير صحيحة'),

    body('heading')
      .optional()
      .isFloat({ min: 0, max: 360 })
      .withMessage('اتجاه حركة السائق غير صحيح'),

    body('accuracy')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('دقة الموقع غير صحيحة'),

    body('timestamp')
      .optional()
      .custom(isValidLocationTimestamp)
      .withMessage('توقيت الموقع غير صحيح'),

    body('updatedAt')
      .optional()
      .custom(isValidLocationTimestamp)
      .withMessage('توقيت الموقع غير صحيح'),

    body().custom((value) => {
      const payload = value && typeof value === 'object' ? value : {};
      const latitude = payload.lat ?? payload.latitude;
      const longitude = payload.lng ?? payload.longitude;

      if (latitude === undefined || latitude === null || latitude === '') {
        throw new Error('خط عرض الموقع مطلوب');
      }

      if (longitude === undefined || longitude === null || longitude === '') {
        throw new Error('خط طول الموقع مطلوب');
      }

      return true;
    }),
  ],
  validateRequest,
  updateMyDriverLocationForRequest
);

router.get(
  '/requests/:serviceRequestId/driver-location',
  [
    param('serviceRequestId')
      .isMongoId()
      .withMessage('رقم الطلب غير صحيح'),
  ],
  validateRequest,
  getRequestLatestDriverLocation
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
  getMyRequestLocationHistory
);

module.exports = router;
