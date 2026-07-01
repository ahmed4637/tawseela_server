const AdminRole = require('../models/adminRole.model');

const ADMIN_PERMISSIONS = [
  { key: 'dashboard.view', module: 'dashboard', action: 'view', description: 'عرض الصفحة الرئيسية للداشبورد' },
  { key: 'live.view', module: 'live', action: 'view', description: 'عرض العمليات الحية والخريطة' },
  { key: 'accounts.view', module: 'accounts', action: 'view', description: 'عرض حسابات المستخدمين' },
  { key: 'accounts.manage', module: 'accounts', action: 'manage', description: 'تفعيل وتعطيل وتعديل الحسابات' },
  { key: 'customers.view', module: 'customers', action: 'view', description: 'عرض العملاء' },
  { key: 'customers.manage', module: 'customers', action: 'manage', description: 'إدارة العملاء' },
  { key: 'drivers.view', module: 'drivers', action: 'view', description: 'عرض السائقين' },
  { key: 'drivers.manage', module: 'drivers', action: 'manage', description: 'إدارة السائقين' },
  { key: 'drivers.review', module: 'drivers', action: 'review', description: 'مراجعة السائقين والمركبات' },
  { key: 'vehicles.view', module: 'vehicles', action: 'view', description: 'عرض أنواع المركبات' },
  { key: 'vehicles.manage', module: 'vehicles', action: 'manage', description: 'إدارة أنواع المركبات' },
  { key: 'services.view', module: 'services', action: 'view', description: 'عرض الخدمات وإعداداتها' },
  { key: 'services.manage', module: 'services', action: 'manage', description: 'إدارة الخدمات وإعدادات الخدمة والمركبة' },
  { key: 'dispatch.manage', module: 'dispatch', action: 'manage', description: 'إدارة إعدادات التوزيع والـ radius' },
  { key: 'requests.view', module: 'requests', action: 'view', description: 'عرض الطلبات والرحلات' },
  { key: 'requests.manage', module: 'requests', action: 'manage', description: 'إدارة الطلبات والإلغاء الإداري' },
  { key: 'offers.view', module: 'offers', action: 'view', description: 'عرض العروض والتفاوض' },
  { key: 'chat.view', module: 'chat', action: 'view', description: 'عرض شات الطلبات للدعم' },
  { key: 'tracking.view', module: 'tracking', action: 'view', description: 'عرض التتبع ومسارات الرحلات' },
  { key: 'tracking.manage', module: 'tracking', action: 'manage', description: 'إدارة إعدادات التتبع' },
  { key: 'promos.view', module: 'promos', action: 'view', description: 'عرض الكوبونات' },
  { key: 'promos.manage', module: 'promos', action: 'manage', description: 'إدارة الكوبونات' },
  { key: 'loyalty.view', module: 'loyalty', action: 'view', description: 'عرض نقاط الولاء' },
  { key: 'loyalty.manage', module: 'loyalty', action: 'manage', description: 'إدارة نقاط الولاء' },
  { key: 'penalties.view', module: 'penalties', action: 'view', description: 'عرض العقوبات والحظر' },
  { key: 'penalties.manage', module: 'penalties', action: 'manage', description: 'إدارة العقوبات والحظر' },
  { key: 'finance.view', module: 'finance', action: 'view', description: 'عرض الحسابات المالية' },
  { key: 'finance.manage', module: 'finance', action: 'manage', description: 'إدارة التسويات والمدفوعات' },
  { key: 'complaints.view', module: 'complaints', action: 'view', description: 'عرض الشكاوى' },
  { key: 'complaints.manage', module: 'complaints', action: 'manage', description: 'إدارة الشكاوى' },
  { key: 'support.view', module: 'support', action: 'view', description: 'عرض تذاكر الدعم' },
  { key: 'support.manage', module: 'support', action: 'manage', description: 'إدارة تذاكر الدعم والردود' },
  { key: 'notifications.view', module: 'notifications', action: 'view', description: 'عرض الإشعارات والقوالب' },
  { key: 'notifications.manage', module: 'notifications', action: 'manage', description: 'إدارة وإرسال الإشعارات' },
  { key: 'reports.view', module: 'reports', action: 'view', description: 'عرض التقارير' },
  { key: 'reports.export', module: 'reports', action: 'export', description: 'تصدير التقارير' },
  { key: 'settings.view', module: 'settings', action: 'view', description: 'عرض إعدادات التطبيق' },
  { key: 'settings.manage', module: 'settings', action: 'manage', description: 'تعديل إعدادات التطبيق' },
  { key: 'admins.view', module: 'admins', action: 'view', description: 'عرض الأدمن والصلاحيات' },
  { key: 'admins.manage', module: 'admins', action: 'manage', description: 'إدارة الأدمن والصلاحيات' },
  { key: 'audit.view', module: 'audit', action: 'view', description: 'عرض سجل التدقيق Audit Log' },
];

const ALL_PERMISSION_KEYS = ADMIN_PERMISSIONS.map((permission) => permission.key);

const SYSTEM_ADMIN_ROLES = [
  {
    key: 'super_admin',
    nameAr: 'مدير عام',
    nameEn: 'Super Admin',
    description: 'صلاحية كاملة على كل أجزاء النظام',
    permissions: ALL_PERMISSION_KEYS,
    isSystem: true,
  },
  {
    key: 'operations_admin',
    nameAr: 'إدارة التشغيل',
    nameEn: 'Operations Admin',
    description: 'إدارة الطلبات والسائقين والعمليات الحية',
    permissions: [
      'dashboard.view',
      'live.view',
      'accounts.view',
      'customers.view',
      'drivers.view',
      'drivers.manage',
      'vehicles.view',
      'services.view',
      'dispatch.manage',
      'requests.view',
      'requests.manage',
      'offers.view',
      'tracking.view',
      'complaints.view',
      'support.view',
      'reports.view',
    ],
    isSystem: true,
  },
  {
    key: 'finance_admin',
    nameAr: 'إدارة مالية',
    nameEn: 'Finance Admin',
    description: 'إدارة المحافظ والعمولات والتسويات والتقارير المالية',
    permissions: [
      'dashboard.view',
      'drivers.view',
      'requests.view',
      'finance.view',
      'finance.manage',
      'promos.view',
      'loyalty.view',
      'reports.view',
      'reports.export',
    ],
    isSystem: true,
  },
  {
    key: 'support_admin',
    nameAr: 'دعم فني',
    nameEn: 'Support Admin',
    description: 'متابعة الشكاوى والتذاكر والشات',
    permissions: [
      'dashboard.view',
      'accounts.view',
      'customers.view',
      'drivers.view',
      'requests.view',
      'offers.view',
      'chat.view',
      'tracking.view',
      'complaints.view',
      'complaints.manage',
      'support.view',
      'support.manage',
      'notifications.view',
    ],
    isSystem: true,
  },
  {
    key: 'marketing_admin',
    nameAr: 'تسويق',
    nameEn: 'Marketing Admin',
    description: 'إدارة الكوبونات والإشعارات التسويقية وتقارير الحملات',
    permissions: [
      'dashboard.view',
      'customers.view',
      'drivers.view',
      'promos.view',
      'promos.manage',
      'loyalty.view',
      'notifications.view',
      'notifications.manage',
      'reports.view',
      'reports.export',
    ],
    isSystem: true,
  },
  {
    key: 'reviewer_admin',
    nameAr: 'مراجع السائقين',
    nameEn: 'Reviewer Admin',
    description: 'مراجعة بيانات السائقين والمركبات والمستندات',
    permissions: [
      'dashboard.view',
      'drivers.view',
      'drivers.review',
      'vehicles.view',
      'notifications.view',
    ],
    isSystem: true,
  },
];

const normalizePermissions = (permissions = []) => {
  const allowed = new Set(ALL_PERMISSION_KEYS);
  return [...new Set(
    permissions
      .map((permission) => permission?.toString().trim())
      .filter((permission) => allowed.has(permission))
  )];
};

const ensureDefaultAdminRoles = async () => {
  const docs = [];

  for (const role of SYSTEM_ADMIN_ROLES) {
    const doc = await AdminRole.findOneAndUpdate(
      { key: role.key },
      {
        $set: {
          nameAr: role.nameAr,
          nameEn: role.nameEn,
          description: role.description,
          permissions: role.permissions,
          isSystem: true,
          isActive: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    docs.push(doc);
  }

  return docs;
};

const getRoleByKey = async (roleKey) => {
  if (!roleKey) {
    return null;
  }

  let role = await AdminRole.findOne({ key: roleKey, isActive: true });

  if (!role) {
    await ensureDefaultAdminRoles();
    role = await AdminRole.findOne({ key: roleKey, isActive: true });
  }

  return role;
};

const getEffectiveAdminAccess = async (account) => {
  if (!account?.roles?.includes('admin')) {
    return {
      isAdmin: false,
      isSuperAdmin: false,
      roleKey: null,
      permissions: [],
    };
  }

  await ensureDefaultAdminRoles();

  // توافق مع الحسابات القديمة: أي أدمن موجود قبل نظام الصلاحيات يعتبر Super Admin
  // لحد ما يتم تعيين دور واضح له من الداشبورد.
  const roleKey = account.adminRoleKey || 'super_admin';
  const role = await getRoleByKey(roleKey);
  const rolePermissions = role?.permissions || [];
  const extraPermissions = account.adminExtraPermissions || [];
  const deniedPermissions = new Set(account.adminDeniedPermissions || []);

  const merged = normalizePermissions([...rolePermissions, ...extraPermissions])
    .filter((permission) => !deniedPermissions.has(permission));

  const isSuperAdmin = roleKey === 'super_admin' || account.isSuperAdmin === true;

  return {
    isAdmin: true,
    isSuperAdmin,
    roleKey,
    role: role ? {
      _id: role._id,
      key: role.key,
      nameAr: role.nameAr,
      nameEn: role.nameEn,
      description: role.description,
      isSystem: role.isSystem,
    } : null,
    permissions: isSuperAdmin ? ALL_PERMISSION_KEYS : merged,
  };
};

const accountHasPermission = async (account, permissionKey) => {
  const access = await getEffectiveAdminAccess(account);

  if (!access.isAdmin) {
    return false;
  }

  if (access.isSuperAdmin) {
    return true;
  }

  return access.permissions.includes(permissionKey);
};

module.exports = {
  ADMIN_PERMISSIONS,
  ALL_PERMISSION_KEYS,
  SYSTEM_ADMIN_ROLES,
  normalizePermissions,
  ensureDefaultAdminRoles,
  getRoleByKey,
  getEffectiveAdminAccess,
  accountHasPermission,
};
