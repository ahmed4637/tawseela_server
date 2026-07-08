const express = require('express');
const { body, param } = require('express-validator');

const {
  getAllSafetyIncidentsForAdmin,
  getSafetyIncidentById,
  updateSafetyIncidentByAdmin,
} = require('../controllers/safety.controller');
const validateRequest = require('../middlewares/validateRequest');
const { protect, allowRoles } = require('../middlewares/authMiddleware');

const router = express.Router();

const statuses = ['open', 'acknowledged', 'in_progress', 'resolved', 'closed'];

router.use(protect, allowRoles('admin'));

router.get('/incidents', getAllSafetyIncidentsForAdmin);

router.get(
  '/incidents/:id',
  [param('id').isMongoId().withMessage('رقم البلاغ غير صحيح')],
  validateRequest,
  getSafetyIncidentById,
);

router.patch(
  '/incidents/:id',
  [
    param('id').isMongoId().withMessage('رقم البلاغ غير صحيح'),
    body('status')
      .isIn(statuses)
      .withMessage('حالة البلاغ غير صحيحة'),
    body('adminNote')
      .optional({ checkFalsy: true })
      .trim()
      .isLength({ max: 2000 })
      .withMessage('ملاحظة الأدمن طويلة جدًا'),
  ],
  validateRequest,
  updateSafetyIncidentByAdmin,
);

module.exports = router;
