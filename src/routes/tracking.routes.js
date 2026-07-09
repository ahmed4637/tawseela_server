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

router.use(protect);

router.get('/settings', getPublicTrackingSettings);

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
  ],
  validateRequest,
  updateMyDriverLocationForRequest
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
