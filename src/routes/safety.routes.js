const express = require('express');
const { body, param } = require('express-validator');

const {
  createSafetyIncident,
  getMySafetyIncidents,
  getSafetyIncidentById,
} = require('../controllers/safety.controller');
const validateRequest = require('../middlewares/validateRequest');
const { protect } = require('../middlewares/authMiddleware');

const router = express.Router();

const incidentTypes = [
  'emergency',
  'unsafe_behavior',
  'accident',
  'route_issue',
  'vehicle_issue',
  'payment_conflict',
  'other',
];
const severities = ['low', 'medium', 'high', 'critical'];

router.use(protect);

router.post(
  '/incidents',
  [
    body('serviceRequestId')
      .optional({ checkFalsy: true })
      .isMongoId()
      .withMessage('رقم الطلب غير صحيح'),
    body('requestId')
      .optional({ checkFalsy: true })
      .isMongoId()
      .withMessage('رقم الطلب غير صحيح'),
    body('rideId')
      .optional({ checkFalsy: true })
      .isMongoId()
      .withMessage('رقم الرحلة غير صحيح'),
    body('type')
      .optional({ checkFalsy: true })
      .isIn(incidentTypes)
      .withMessage('نوع بلاغ الأمان غير صحيح'),
    body('severity')
      .optional({ checkFalsy: true })
      .isIn(severities)
      .withMessage('درجة الخطورة غير صحيحة'),
    body('message')
      .optional({ checkFalsy: true })
      .trim()
      .isLength({ max: 2000 })
      .withMessage('تفاصيل البلاغ طويلة جدًا'),
  ],
  validateRequest,
  createSafetyIncident,
);

router.get('/incidents', getMySafetyIncidents);

router.get(
  '/incidents/:id',
  [param('id').isMongoId().withMessage('رقم البلاغ غير صحيح')],
  validateRequest,
  getSafetyIncidentById,
);

module.exports = router;
