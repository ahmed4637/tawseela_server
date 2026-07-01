const express = require('express');
const { body, param } = require('express-validator');

const {
  createComplaint,
  getMyComplaints,
  getComplaintsAgainstMe,
  getComplaintById,
  getAllComplaintsForAdmin,
  updateComplaintByAdmin,
} = require('../controllers/complaint.controller');

const validateRequest = require('../middlewares/validateRequest');
const { protect, allowRoles } = require('../middlewares/authMiddleware');

const router = express.Router();

const complaintCategories = [
  'late',
  'no_show',
  'bad_behavior',
  'price_issue',
  'safety',
  'payment',
  'route_issue',
  'vehicle_issue',
  'item_issue',
  'other',
];

const priorities = ['low', 'medium', 'high', 'urgent'];
const complaintStatuses = ['open', 'under_review', 'in_review', 'resolved', 'rejected', 'closed'];

router.use(protect);

router.post(
  '/',
  [
    body('serviceRequestId')
      .notEmpty()
      .withMessage('رقم الطلب مطلوب')
      .isMongoId()
      .withMessage('رقم الطلب غير صحيح'),

    body('category')
      .optional({ checkFalsy: true })
      .isIn(complaintCategories)
      .withMessage('تصنيف الشكوى غير صحيح'),

    body('priority')
      .optional({ checkFalsy: true })
      .isIn(priorities)
      .withMessage('أولوية الشكوى غير صحيحة'),

    body('title')
      .trim()
      .notEmpty()
      .withMessage('عنوان الشكوى مطلوب')
      .isLength({ max: 120 })
      .withMessage('عنوان الشكوى طويل جدًا'),

    body('description')
      .trim()
      .notEmpty()
      .withMessage('وصف الشكوى مطلوب')
      .isLength({ max: 1500 })
      .withMessage('وصف الشكوى طويل جدًا'),

    body('images')
      .optional()
      .isArray({ max: 5 })
      .withMessage('يمكن رفع 5 صور كحد أقصى للشكوى'),

    body('images.*')
      .optional()
      .trim()
      .isString()
      .withMessage('رابط الصورة غير صحيح')
      .isLength({ max: 500 })
      .withMessage('رابط الصورة طويل جدًا'),

    body('attachments')
      .optional()
      .isArray({ max: 8 })
      .withMessage('يمكن رفع 8 مرفقات كحد أقصى للشكوى'),
  ],
  validateRequest,
  createComplaint,
);

router.get('/mine', getMyComplaints);
router.get('/against-me', getComplaintsAgainstMe);

// Backward-compatible admin paths used by the current dashboard if any.
router.get('/admin/all', allowRoles('admin'), getAllComplaintsForAdmin);
router.patch(
  '/admin/:id',
  allowRoles('admin'),
  [
    param('id').isMongoId().withMessage('رقم الشكوى غير صحيح'),
    body('status')
      .optional({ checkFalsy: true })
      .isIn(complaintStatuses)
      .withMessage('حالة الشكوى غير صحيحة'),
    body('priority')
      .optional({ checkFalsy: true })
      .isIn(priorities)
      .withMessage('أولوية الشكوى غير صحيحة'),
    body('assignedAdminId')
      .optional({ nullable: true, checkFalsy: true })
      .isMongoId()
      .withMessage('رقم الأدمن غير صحيح'),
    body('adminNote').optional({ checkFalsy: true }).trim(),
    body('resolutionNote').optional({ checkFalsy: true }).trim(),
    body('reason').optional({ checkFalsy: true }).trim(),
  ],
  validateRequest,
  updateComplaintByAdmin,
);

router.get(
  '/:id',
  [param('id').isMongoId().withMessage('رقم الشكوى غير صحيح')],
  validateRequest,
  getComplaintById,
);

module.exports = router;
