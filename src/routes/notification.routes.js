const express = require('express');
const { body, param } = require('express-validator');

const {
  getMyUnreadNotificationsCount,
  getMyNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  registerMyDeviceToken,
  deactivateMyDeviceToken,
  getMyDeviceTokens,
} = require('../controllers/notification.controller');

const validateRequest = require('../middlewares/validateRequest');
const { protect } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(protect);

router.get('/unread-count', getMyUnreadNotificationsCount);
router.get('/', getMyNotifications);
router.get('/device-tokens', getMyDeviceTokens);

router.post(
  '/device-token',
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

router.delete(
  '/device-token',
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

router.patch('/read-all', markAllNotificationsAsRead);

router.patch(
  '/:id/read',
  [
    param('id')
      .isMongoId()
      .withMessage('رقم الإشعار غير صحيح'),
  ],
  validateRequest,
  markNotificationAsRead
);

module.exports = router;
