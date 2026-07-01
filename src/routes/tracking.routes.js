const express = require('express');
const { param, query } = require('express-validator');

const {
  getPublicTrackingSettings,
  getRequestLatestDriverLocation,
  getMyRequestLocationHistory,
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
