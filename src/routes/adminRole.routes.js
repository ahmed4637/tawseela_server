const express = require('express');
const { body, param } = require('express-validator');

const {
  listPermissions,
  listRoles,
  createRole,
  updateRole,
  listAdminAccounts,
  getMyAdminAccess,
  updateAdminAccountAccess,
} = require('../controllers/adminRole.controller');
const validateRequest = require('../middlewares/validateRequest');
const { protect, allowRoles } = require('../middlewares/authMiddleware');
const {
  attachAdminAccess,
  requireAdminPermission,
} = require('../middlewares/adminPermission.middleware');

const router = express.Router();

router.use(protect, allowRoles('admin'), attachAdminAccess);

router.get('/me/access', getMyAdminAccess);
router.get('/permissions', requireAdminPermission('admins.view'), listPermissions);
router.get('/roles', requireAdminPermission('admins.view'), listRoles);
router.get('/accounts', requireAdminPermission('admins.view'), listAdminAccounts);

router.post(
  '/roles',
  requireAdminPermission('admins.manage'),
  [
    body('key')
      .trim()
      .notEmpty()
      .withMessage('كود الدور مطلوب'),
    body('nameAr')
      .trim()
      .notEmpty()
      .withMessage('اسم الدور بالعربي مطلوب'),
    body('nameEn')
      .optional({ checkFalsy: true })
      .trim(),
    body('permissions')
      .optional()
      .isArray()
      .withMessage('الصلاحيات يجب أن تكون قائمة'),
  ],
  validateRequest,
  createRole
);

router.patch(
  '/roles/:roleId',
  requireAdminPermission('admins.manage'),
  [
    param('roleId')
      .isMongoId()
      .withMessage('رقم الدور غير صحيح'),
    body('permissions')
      .optional()
      .isArray()
      .withMessage('الصلاحيات يجب أن تكون قائمة'),
  ],
  validateRequest,
  updateRole
);

router.patch(
  '/accounts/:accountId/access',
  requireAdminPermission('admins.manage'),
  [
    param('accountId')
      .isMongoId()
      .withMessage('رقم حساب الأدمن غير صحيح'),
    body('adminRoleKey')
      .optional({ checkFalsy: true })
      .trim(),
    body('adminExtraPermissions')
      .optional()
      .isArray()
      .withMessage('الصلاحيات الإضافية يجب أن تكون قائمة'),
    body('adminDeniedPermissions')
      .optional()
      .isArray()
      .withMessage('الصلاحيات الممنوعة يجب أن تكون قائمة'),
  ],
  validateRequest,
  updateAdminAccountAccess
);

module.exports = router;
