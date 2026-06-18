const express = require('express');
const { param } = require('express-validator');

const {
  getMyNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} = require('../controllers/notification.controller');

const validateRequest = require('../middlewares/validateRequest');
const { protect } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(protect);

router.get('/', getMyNotifications);

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