const express = require('express');
const { body, param, query } = require('express-validator');

const {
  getChatRoomByRequest,
  getChatRoomById,
  getChatMessages,
  getChatUnreadCountByRequest,
  getChatUnreadCountByRoom,
  sendChatMessage,
  markChatRoomAsRead,
} = require('../controllers/chat.controller');
const validateRequest = require('../middlewares/validateRequest');
const { protect } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(protect);

router.get(
  '/requests/:serviceRequestId/room',
  [
    param('serviceRequestId')
      .isMongoId()
      .withMessage('رقم الطلب غير صحيح'),
  ],
  validateRequest,
  getChatRoomByRequest
);


router.get(
  '/requests/:serviceRequestId/unread-count',
  [
    param('serviceRequestId')
      .isMongoId()
      .withMessage('رقم الطلب غير صحيح'),
  ],
  validateRequest,
  getChatUnreadCountByRequest
);

router.get(
  '/rooms/:roomId',
  [
    param('roomId')
      .isMongoId()
      .withMessage('رقم غرفة الشات غير صحيح'),
  ],
  validateRequest,
  getChatRoomById
);


router.get(
  '/rooms/:roomId/unread-count',
  [
    param('roomId')
      .isMongoId()
      .withMessage('رقم غرفة الشات غير صحيح'),
  ],
  validateRequest,
  getChatUnreadCountByRoom
);

router.get(
  '/rooms/:roomId/messages',
  [
    param('roomId')
      .isMongoId()
      .withMessage('رقم غرفة الشات غير صحيح'),
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('رقم الصفحة غير صحيح'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('عدد الرسائل غير صحيح'),
  ],
  validateRequest,
  getChatMessages
);

router.post(
  '/rooms/:roomId/messages',
  [
    param('roomId')
      .isMongoId()
      .withMessage('رقم غرفة الشات غير صحيح'),
    body('messageType')
      .optional({ checkFalsy: true })
      .isIn(['text', 'image', 'location'])
      .withMessage('نوع الرسالة غير صحيح'),
    body('text')
      .optional({ checkFalsy: true })
      .trim()
      .isLength({ max: 2000 })
      .withMessage('نص الرسالة طويل جدًا'),
    body('mediaUrl')
      .optional({ checkFalsy: true })
      .trim(),
    body('location.lat')
      .optional({ nullable: true })
      .isFloat({ min: -90, max: 90 })
      .withMessage('خط عرض الموقع غير صحيح'),
    body('location.lng')
      .optional({ nullable: true })
      .isFloat({ min: -180, max: 180 })
      .withMessage('خط طول الموقع غير صحيح'),
    body('location.address')
      .optional({ checkFalsy: true })
      .trim(),
  ],
  validateRequest,
  sendChatMessage
);

router.post(
  '/rooms/:roomId/read',
  [
    param('roomId')
      .isMongoId()
      .withMessage('رقم غرفة الشات غير صحيح'),
  ],
  validateRequest,
  markChatRoomAsRead
);

module.exports = router;
