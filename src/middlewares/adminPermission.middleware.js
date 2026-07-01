const {
  getEffectiveAdminAccess,
} = require('../services/adminAccess.service');

const attachAdminAccess = async (req, res, next) => {
  try {
    if (!req.account?.roles?.includes('admin')) {
      const error = new Error('غير مسموح لك بالدخول للداشبورد');
      error.statusCode = 403;
      throw error;
    }

    req.adminAccess = await getEffectiveAdminAccess(req.account);

    return next();
  } catch (error) {
    return next(error);
  }
};

const requireAdminPermission = (permissionKey) => {
  return async (req, res, next) => {
    try {
      if (!req.adminAccess) {
        req.adminAccess = await getEffectiveAdminAccess(req.account);
      }

      if (!req.adminAccess.isAdmin) {
        const error = new Error('غير مسموح لك بالدخول للداشبورد');
        error.statusCode = 403;
        throw error;
      }

      if (
        !req.adminAccess.isSuperAdmin &&
        !req.adminAccess.permissions.includes(permissionKey)
      ) {
        const error = new Error('ليس لديك صلاحية تنفيذ هذا الإجراء');
        error.statusCode = 403;
        throw error;
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
};

const requireAnyAdminPermission = (permissionKeys = []) => {
  return async (req, res, next) => {
    try {
      if (!req.adminAccess) {
        req.adminAccess = await getEffectiveAdminAccess(req.account);
      }

      if (!req.adminAccess.isAdmin) {
        const error = new Error('غير مسموح لك بالدخول للداشبورد');
        error.statusCode = 403;
        throw error;
      }

      const hasPermission = req.adminAccess.isSuperAdmin ||
        permissionKeys.some((permission) => req.adminAccess.permissions.includes(permission));

      if (!hasPermission) {
        const error = new Error('ليس لديك صلاحية تنفيذ هذا الإجراء');
        error.statusCode = 403;
        throw error;
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
};

module.exports = {
  attachAdminAccess,
  requireAdminPermission,
  requireAnyAdminPermission,
};
