const express = require('express');
const { body, param } = require('express-validator');

const {
  getAllSupportTicketsForAdmin,
  getSupportTicketById,
  getSupportTicketMessages,
  updateSupportTicketByAdmin,
  addAdminSupportMessage,
} = require('../controllers/support.controller');

const validateRequest = require('../middlewares/validateRequest');
const { protect, allowRoles } = require('../middlewares/authMiddleware');

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
const statuses = ['open', 'pending_user', 'pending_admin', 'resolved', 'closed'];

router.use(protect, allowRoles('admin'));

router.get('/tickets', getAllSupportTicketsForAdmin);

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

router.patch(
  '/tickets/:id',
  [
    param('id').isMongoId().withMessage('رقم التذكرة غير صحيح'),
    body('status')
      .optional({ checkFalsy: true })
      .isIn(statuses)
      .withMessage('حالة التذكرة غير صحيحة'),
    body('priority')
      .optional({ checkFalsy: true })
      .isIn(priorities)
      .withMessage('أولوية التذكرة غير صحيحة'),
    body('category')
      .optional({ checkFalsy: true })
      .isIn(categories)
      .withMessage('تصنيف التذكرة غير صحيح'),
    body('assignedAdminId')
      .optional({ nullable: true, checkFalsy: true })
      .isMongoId()
      .withMessage('رقم الأدمن غير صحيح'),
    body('reason').optional({ checkFalsy: true }).trim(),
  ],
  validateRequest,
  updateSupportTicketByAdmin,
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
  addAdminSupportMessage,
);

module.exports = router;
