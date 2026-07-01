const express = require('express');
const { body, param } = require('express-validator');

const {
  getAdminNotificationTemplates,
  createAdminNotificationTemplate,
  updateAdminNotificationTemplate,
  getAdminNotifications,
  getAdminDeviceTokens,
  sendAdminNotification,
} = require('../controllers/notification.controller');

const validateRequest = require('../middlewares/validateRequest');
const { protect, allowRoles } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(protect);
router.use(allowRoles('admin'));

router.get('/templates', getAdminNotificationTemplates);

router.post(
  '/templates',
  [
    body('key')
      .trim()
      .notEmpty()
      .withMessage('كود القالب مطلوب'),

    body('titleAr')
      .trim()
      .notEmpty()
      .withMessage('عنوان القالب مطلوب'),

    body('bodyAr')
      .trim()
      .notEmpty()
      .withMessage('محتوى القالب مطلوب'),

    body('targetType')
      .optional()
      .isIn(['customer', 'driver', 'admin', 'all'])
      .withMessage('نوع المستقبل غير صحيح'),

    body('type')
      .optional()
      .isIn([
        'general',
        'request',
        'offer',
        'negotiation',
        'trip',
        'chat',
        'payment',
        'promo',
        'loyalty',
        'penalty',
        'complaint',
        'review',
        'scheduled_reminder',
        'admin',
      ])
      .withMessage('نوع الإشعار غير صحيح'),
  ],
  validateRequest,
  createAdminNotificationTemplate
);

router.patch(
  '/templates/:id',
  [
    param('id')
      .isMongoId()
      .withMessage('رقم القالب غير صحيح'),
  ],
  validateRequest,
  updateAdminNotificationTemplate
);

router.get('/logs', getAdminNotifications);
router.get('/device-tokens', getAdminDeviceTokens);

router.post(
  '/send',
  [
    body('accountId')
      .optional({ checkFalsy: true })
      .isMongoId()
      .withMessage('رقم الحساب غير صحيح'),

    body('role')
      .optional({ checkFalsy: true })
      .isIn(['customer', 'driver', 'admin'])
      .withMessage('نوع المستخدم غير صحيح'),

    body('title')
      .trim()
      .notEmpty()
      .withMessage('عنوان الإشعار مطلوب'),

    body('body')
      .trim()
      .notEmpty()
      .withMessage('محتوى الإشعار مطلوب'),
  ],
  validateRequest,
  sendAdminNotification
);

module.exports = router;
