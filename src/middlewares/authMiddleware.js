const jwt = require('jsonwebtoken');

const Account = require('../models/account.model');
const DriverProfile = require('../models/driverProfile.model');

const protect = async (req, res, next) => {
  try {
    let token;

    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    if (!token) {
      const error = new Error('غير مصرح، برجاء تسجيل الدخول');
      error.statusCode = 401;
      throw error;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const accountId = decoded.accountId || decoded.userId;

    if (!accountId) {
      const error = new Error('توكن غير صحيح');
      error.statusCode = 401;
      throw error;
    }

    const account = await Account.findById(accountId);

    if (!account) {
      const error = new Error('الحساب غير موجود');
      error.statusCode = 401;
      throw error;
    }

    if (!account.isActive) {
      const error = new Error('هذا الحساب غير مفعل');
      error.statusCode = 403;
      throw error;
    }

    req.account = account;
    req.user = account;
    req.accountId = account._id.toString();
    req.userId = account._id.toString();
    req.roles = account.roles;
    req.role = decoded.role || account.defaultRole;

    return next();
  } catch (error) {
    if (!error.statusCode) {
      error.statusCode = 401;
      error.message = 'غير مصرح، برجاء تسجيل الدخول مرة أخرى';
    }

    return next(error);
  }
};

const allowRoles = (...roles) => {
  return (req, res, next) => {
    const hasAllowedRole = roles.some((role) => req.roles?.includes(role));

    if (!hasAllowedRole) {
      const error = new Error('غير مسموح لك بتنفيذ هذا الإجراء');
      error.statusCode = 403;
      return next(error);
    }

    return next();
  };
};

const requireDriverReady = async (req, res, next) => {
  try {
    if (!req.roles?.includes('driver')) {
      const error = new Error('هذا الإجراء متاح للسائق فقط');
      error.statusCode = 403;
      throw error;
    }

    const driverProfile = await DriverProfile.findOne({
      accountId: req.accountId,
    });

    if (!driverProfile) {
      const error = new Error('ملف السائق غير موجود');
      error.statusCode = 403;
      throw error;
    }

    if (!driverProfile.isApproved || driverProfile.reviewStatus !== 'approved') {
      const error = new Error('حساب السائق لم تتم الموافقة عليه بعد');
      error.statusCode = 403;
      throw error;
    }

    driverProfile.refreshDebtBlockStatus();

    if (!driverProfile.canReceiveRequests()) {
      const error = new Error(
        driverProfile.blockedReason ||
          'السائق غير متاح لاستقبال رحلات جديدة حاليًا'
      );
      error.statusCode = 403;
      throw error;
    }

    req.driverProfile = driverProfile;

    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  protect,
  allowRoles,
  requireDriverReady,
};