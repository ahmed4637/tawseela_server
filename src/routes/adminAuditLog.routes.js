const express = require('express');
const { param } = require('express-validator');

const {
  getAdminAuditLogs,
  getAdminAuditLogById,
} = require('../controllers/adminAuditLog.controller');

const validateRequest = require('../middlewares/validateRequest');
const { protect, allowRoles } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(protect);
router.use(allowRoles('admin'));

router.get('/', getAdminAuditLogs);

router.get(
  '/:id',
  [
    param('id')
      .isMongoId()
      .withMessage('رقم سجل الرقابة غير صحيح'),
  ],
  validateRequest,
  getAdminAuditLogById
);

module.exports = router;
