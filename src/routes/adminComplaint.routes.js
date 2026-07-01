const express = require('express');
const { body, param } = require('express-validator');

const {
  getAllComplaintsForAdmin,
  getComplaintById,
  updateComplaintByAdmin,
} = require('../controllers/complaint.controller');

const validateRequest = require('../middlewares/validateRequest');
const { protect, allowRoles } = require('../middlewares/authMiddleware');

const router = express.Router();

const priorities = ['low', 'medium', 'high', 'urgent'];
const complaintStatuses = ['open', 'under_review', 'in_review', 'resolved', 'rejected', 'closed'];

router.use(protect, allowRoles('admin'));

router.get('/', getAllComplaintsForAdmin);

router.get(
  '/:id',
  [param('id').isMongoId().withMessage('رقم الشكوى غير صحيح')],
  validateRequest,
  getComplaintById,
);

router.patch(
  '/:id',
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

module.exports = router;
