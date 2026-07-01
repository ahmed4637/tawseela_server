const mongoose = require('mongoose');

const Account = require('../models/account.model');
const AdminRole = require('../models/adminRole.model');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const {
  ADMIN_PERMISSIONS,
  normalizePermissions,
  ensureDefaultAdminRoles,
  getEffectiveAdminAccess,
} = require('../services/adminAccess.service');
const { createAdminAuditLog } = require('../services/adminAuditLog.service');

const ensureValidId = (id, message = 'رقم غير صحيح') => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  }
};

const listPermissions = asyncHandler(async (req, res) => {
  return sendSuccess({
    res,
    message: 'تم جلب صلاحيات الأدمن بنجاح',
    docs: ADMIN_PERMISSIONS,
  });
});

const listRoles = asyncHandler(async (req, res) => {
  await ensureDefaultAdminRoles();

  const roles = await AdminRole.find({})
    .sort({ isSystem: -1, createdAt: 1 });

  return sendSuccess({
    res,
    message: 'تم جلب أدوار الأدمن بنجاح',
    docs: roles,
  });
});

const createRole = asyncHandler(async (req, res) => {
  const key = req.body.key?.toString().trim().toLowerCase();

  if (!key) {
    const error = new Error('كود الدور مطلوب');
    error.statusCode = 400;
    throw error;
  }

  if (!/^[a-z0-9_]+$/.test(key)) {
    const error = new Error('كود الدور يجب أن يحتوي على حروف إنجليزية وأرقام و _ فقط');
    error.statusCode = 400;
    throw error;
  }

  const exists = await AdminRole.findOne({ key });

  if (exists) {
    const error = new Error('هذا الدور موجود بالفعل');
    error.statusCode = 400;
    throw error;
  }

  const role = await AdminRole.create({
    key,
    nameAr: req.body.nameAr,
    nameEn: req.body.nameEn || req.body.nameAr,
    description: req.body.description || '',
    permissions: normalizePermissions(req.body.permissions || []),
    isSystem: false,
    isActive: req.body.isActive !== false,
    createdByAdminId: req.account._id,
    updatedByAdminId: req.account._id,
  });

  await createAdminAuditLog({
    req,
    module: 'admins',
    action: 'create_role',
    entityType: 'AdminRole',
    entityId: role._id,
    oldValue: null,
    newValue: role.toObject(),
    reason: req.body.reason || 'إنشاء دور أدمن جديد',
  });

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم إنشاء دور الأدمن بنجاح',
    doc: role,
  });
});

const updateRole = asyncHandler(async (req, res) => {
  const { roleId } = req.params;
  ensureValidId(roleId, 'رقم الدور غير صحيح');

  const role = await AdminRole.findById(roleId);

  if (!role) {
    const error = new Error('دور الأدمن غير موجود');
    error.statusCode = 404;
    throw error;
  }

  const oldValue = role.toObject();

  if (role.isSystem && req.body.key && req.body.key !== role.key) {
    const error = new Error('لا يمكن تغيير كود دور نظامي');
    error.statusCode = 400;
    throw error;
  }

  if (!role.isSystem && req.body.key) {
    const nextKey = req.body.key.toString().trim().toLowerCase();

    if (!/^[a-z0-9_]+$/.test(nextKey)) {
      const error = new Error('كود الدور يجب أن يحتوي على حروف إنجليزية وأرقام و _ فقط');
      error.statusCode = 400;
      throw error;
    }

    const duplicate = await AdminRole.findOne({ key: nextKey, _id: { $ne: role._id } });

    if (duplicate) {
      const error = new Error('كود الدور مستخدم بالفعل');
      error.statusCode = 400;
      throw error;
    }

    role.key = nextKey;
  }

  if (req.body.nameAr !== undefined) {
    role.nameAr = req.body.nameAr;
  }

  if (req.body.nameEn !== undefined) {
    role.nameEn = req.body.nameEn;
  }

  if (req.body.description !== undefined) {
    role.description = req.body.description;
  }

  if (req.body.permissions !== undefined) {
    role.permissions = normalizePermissions(req.body.permissions);
  }

  if (req.body.isActive !== undefined) {
    role.isActive = req.body.isActive !== false;
  }

  role.updatedByAdminId = req.account._id;

  await role.save();

  await createAdminAuditLog({
    req,
    module: 'admins',
    action: 'update_role',
    entityType: 'AdminRole',
    entityId: role._id,
    oldValue,
    newValue: role.toObject(),
    reason: req.body.reason || 'تعديل دور أدمن',
  });

  return sendSuccess({
    res,
    message: 'تم تعديل دور الأدمن بنجاح',
    doc: role,
  });
});

const listAdminAccounts = asyncHandler(async (req, res) => {
  const admins = await Account.find({ roles: 'admin' })
    .select('-password')
    .sort({ createdAt: -1 });

  const docs = await Promise.all(admins.map(async (account) => {
    const access = await getEffectiveAdminAccess(account);
    const safe = account.toSafeObject();

    return {
      ...safe,
      adminAccess: access,
    };
  }));

  return sendSuccess({
    res,
    message: 'تم جلب حسابات الأدمن بنجاح',
    docs,
  });
});

const getMyAdminAccess = asyncHandler(async (req, res) => {
  const access = await getEffectiveAdminAccess(req.account);

  return sendSuccess({
    res,
    message: 'تم جلب صلاحياتك بنجاح',
    doc: access,
  });
});

const updateAdminAccountAccess = asyncHandler(async (req, res) => {
  const { accountId } = req.params;
  ensureValidId(accountId, 'رقم حساب الأدمن غير صحيح');

  const account = await Account.findById(accountId);

  if (!account) {
    const error = new Error('الحساب غير موجود');
    error.statusCode = 404;
    throw error;
  }

  if (!account.roles.includes('admin')) {
    const error = new Error('هذا الحساب ليس أدمن');
    error.statusCode = 400;
    throw error;
  }

  const oldValue = account.toSafeObject();

  if (req.body.adminRoleKey !== undefined) {
    const roleKey = req.body.adminRoleKey?.toString().trim().toLowerCase();
    const role = await AdminRole.findOne({ key: roleKey, isActive: true });

    if (!role) {
      const error = new Error('دور الأدمن غير موجود أو غير مفعل');
      error.statusCode = 400;
      throw error;
    }

    account.adminRoleKey = role.key;
    account.isSuperAdmin = role.key === 'super_admin';
  }

  if (req.body.adminExtraPermissions !== undefined) {
    account.adminExtraPermissions = normalizePermissions(req.body.adminExtraPermissions);
  }

  if (req.body.adminDeniedPermissions !== undefined) {
    account.adminDeniedPermissions = normalizePermissions(req.body.adminDeniedPermissions);
  }

  await account.save();

  const access = await getEffectiveAdminAccess(account);

  await createAdminAuditLog({
    req,
    module: 'admins',
    action: 'update_admin_access',
    entityType: 'Account',
    entityId: account._id,
    oldValue,
    newValue: {
      account: account.toSafeObject(),
      adminAccess: access,
    },
    reason: req.body.reason || 'تعديل صلاحيات أدمن',
  });

  return sendSuccess({
    res,
    message: 'تم تعديل صلاحيات الأدمن بنجاح',
    doc: {
      account: account.toSafeObject(),
      adminAccess: access,
    },
  });
});

module.exports = {
  listPermissions,
  listRoles,
  createRole,
  updateRole,
  listAdminAccounts,
  getMyAdminAccess,
  updateAdminAccountAccess,
};
