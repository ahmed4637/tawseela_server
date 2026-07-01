const AppSettings = require('../models/appSettings.model');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const { getAppSettings } = require('../services/appSettings.service');
const { createAdminAuditLog } = require('../services/adminAuditLog.service');

const getPublicSettings = asyncHandler(async (req, res) => {
  const settings = await getAppSettings();

  return sendSuccess({
    res,
    message: 'تم جلب إعدادات التطبيق بنجاح',
    doc: {
      searchRadiusKm: settings.searchRadiusKm,
      support: settings.support,
      appStatus: settings.appStatus,
      loyalty: settings.loyalty,
    },
  });
});

const getAdminSettings = asyncHandler(async (req, res) => {
  const settings = await getAppSettings();

  return sendSuccess({
    res,
    message: 'تم جلب إعدادات الإدارة بنجاح',
    doc: settings,
  });
});

const updateAdminSettings = asyncHandler(async (req, res) => {
  const {
    driverCommissionDebtLimit,
    searchRadiusKm,
    scheduledRemindersMinutes,
    support,
    appStatus,
    loyalty,
    reason,
  } = req.body;

  const settings = await getAppSettings();
  const oldValue = settings.toObject();

  if (driverCommissionDebtLimit !== undefined) {
    settings.driverCommissionDebtLimit = driverCommissionDebtLimit;
  }

  if (searchRadiusKm) {
    settings.searchRadiusKm = {
      ...settings.searchRadiusKm,
      ...searchRadiusKm,
    };
  }

  if (scheduledRemindersMinutes) {
    settings.scheduledRemindersMinutes = {
      ...settings.scheduledRemindersMinutes,
      ...scheduledRemindersMinutes,
    };
  }

  if (support) {
    settings.support = {
      ...settings.support,
      ...support,
    };
  }

  if (appStatus) {
    settings.appStatus = {
      ...settings.appStatus,
      ...appStatus,
    };
  }

  if (loyalty) {
    settings.loyalty = {
      ...settings.loyalty,
      ...loyalty,
      tierRules: {
        ...settings.loyalty?.tierRules,
        ...(loyalty.tierRules || {}),
      },
    };
  }

  settings.updatedByAdminId = req.accountId;

  await settings.save();

  await createAdminAuditLog({
    req,
    module: 'settings',
    action: 'update',
    entityType: 'AppSettings',
    entityId: settings._id,
    oldValue,
    newValue: settings,
    reason: reason || 'تحديث إعدادات التطبيق من الداشبورد',
  });

  return sendSuccess({
    res,
    message: 'تم تحديث إعدادات التطبيق بنجاح',
    doc: settings,
  });
});

const resetSettingsToDefault = asyncHandler(async (req, res) => {
  const existingSettings = await AppSettings.findOne({ key: 'main' });
  const oldValue = existingSettings ? existingSettings.toObject() : null;

  await AppSettings.deleteOne({ key: 'main' });

  const settings = await getAppSettings();

  settings.updatedByAdminId = req.accountId;
  await settings.save();

  await createAdminAuditLog({
    req,
    module: 'settings',
    action: 'reset',
    entityType: 'AppSettings',
    entityId: settings._id,
    oldValue,
    newValue: settings,
    reason: req.body?.reason || 'إعادة إعدادات التطبيق للوضع الافتراضي',
  });

  return sendSuccess({
    res,
    message: 'تم إعادة الإعدادات للوضع الافتراضي بنجاح',
    doc: settings,
  });
});

module.exports = {
  getPublicSettings,
  getAdminSettings,
  updateAdminSettings,
  resetSettingsToDefault,
};
