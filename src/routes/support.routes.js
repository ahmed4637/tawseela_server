const express = require('express');
const { body, param } = require('express-validator');

const {
  createSupportTicket,
  getMySupportTickets,
  getSupportTicketById,
  getSupportTicketMessages,
  addUserSupportMessage,
} = require('../controllers/support.controller');

const validateRequest = require('../middlewares/validateRequest');
const { protect } = require('../middlewares/authMiddleware');

const router = express.Router();

const categories = [
  'account',
  'request',
  'trip',
  'payment',
  'promo',
  'loyalty',
  'driver_review',
  'technical',
  'complaint_followup',
  'other',
];
const priorities = ['low', 'medium', 'high', 'urgent'];

router.use(protect);

router.post(
  '/tickets',
  [
    body('subject')
      .trim()
      .notEmpty()
      .withMessage('موضوع التذكرة مطلوب')
      .isLength({ max: 160 })
      .withMessage('موضوع التذكرة طويل جدًا'),
    body('message')
      .trim()
      .notEmpty()
      .withMessage('رسالة التذكرة مطلوبة')
      .isLength({ max: 3000 })
      .withMessage('رسالة التذكرة طويلة جدًا'),
    body('category')
      .optional({ checkFalsy: true })
      .isIn(categories)
      .withMessage('تصنيف التذكرة غير صحيح'),
    body('priority')
      .optional({ checkFalsy: true })
      .isIn(priorities)
      .withMessage('أولوية التذكرة غير صحيحة'),
    body('relatedServiceRequestId')
      .optional({ nullable: true, checkFalsy: true })
      .isMongoId()
      .withMessage('رقم الطلب المرتبط غير صحيح'),
    body('relatedComplaintId')
      .optional({ nullable: true, checkFalsy: true })
      .isMongoId()
      .withMessage('رقم الشكوى المرتبطة غير صحيح'),
    body('attachments')
      .optional()
      .isArray({ max: 8 })
      .withMessage('يمكن إرسال 8 مرفقات كحد أقصى'),
  ],
  validateRequest,
  createSupportTicket,
);

router.get('/tickets', getMySupportTickets);

router.get(
  '/tickets/:id',
  [param('id').isMongoId().withMessage('رقم التذكرة غير صحيح')],
  validateRequest,
  getSupportTicketById,
);

router.get(
  '/tickets/:id/messages',
  [param('id').isMongoId().withMessage('رقم التذكرة غير صحيح')],
  validateRequest,
  getSupportTicketMessages,
);

router.post(
  '/tickets/:id/messages',
  [
    param('id').isMongoId().withMessage('رقم التذكرة غير صحيح'),
    body('message')
      .optional({ checkFalsy: true })
      .trim()
      .isLength({ max: 3000 })
      .withMessage('الرسالة طويلة جدًا'),
    body('attachments')
      .optional()
      .isArray({ max: 8 })
      .withMessage('يمكن إرسال 8 مرفقات كحد أقصى'),
  ],
  validateRequest,
  addUserSupportMessage,
);

module.exports = router;
