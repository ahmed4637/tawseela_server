const express = require('express');
const { body, param } = require('express-validator');

const {
  createComplaint,
  getMyComplaints,
  getComplaintsAgainstMe,
  getAllComplaintsForAdmin,
  updateComplaintByAdmin,
} = require('../controllers/complaint.controller');

const validateRequest = require('../middlewares/validateRequest');
const { protect, allowRoles } = require('../middlewares/authMiddleware');

const router = express.Router();

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
      .isIn([
        'late',
        'no_show',
        'bad_behavior',
        'price_issue',
        'safety',
        'payment',
        'other',
      ])
      .withMessage('تصنيف الشكوى غير صحيح'),

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
      .isLength({ max: 1000 })
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
  .isLength({ max: 300 })
  .withMessage('رابط الصورة طويل جدًا'),
  ],
  validateRequest,
  createComplaint
);

router.get('/mine', getMyComplaints);

router.get('/against-me', getComplaintsAgainstMe);

router.get('/admin/all', allowRoles('admin'), getAllComplaintsForAdmin);

router.patch(
  '/admin/:id',
  allowRoles('admin'),
  [
    param('id')
      .isMongoId()
      .withMessage('رقم الشكوى غير صحيح'),

    body('status')
      .optional({ checkFalsy: true })
      .isIn(['open', 'under_review', 'resolved', 'rejected'])
      .withMessage('حالة الشكوى غير صحيحة'),

    body('adminNote')
      .optional({ checkFalsy: true })
      .trim(),
  ],
  validateRequest,
  updateComplaintByAdmin
);

module.exports = router;