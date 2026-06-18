const AppSettings = require('../models/appSettings.model');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const { getAppSettings } = require('../services/appSettings.service');

const getPublicSettings = asyncHandler(async (req, res) => {
  const settings = await getAppSettings();

  return sendSuccess({
    res,
    message: 'تم جلب إعدادات التطبيق بنجاح',
    doc: {
      searchRadiusKm: settings.searchRadiusKm,
      support: settings.support,
      appStatus: settings.appStatus,
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
  } = req.body;

  const settings = await getAppSettings();

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

  settings.updatedByAdminId = req.accountId;

  await settings.save();

  return sendSuccess({
    res,
    message: 'تم تحديث إعدادات التطبيق بنجاح',
    doc: settings,
  });
});

const resetSettingsToDefault = asyncHandler(async (req, res) => {
  await AppSettings.deleteOne({ key: 'main' });

  const settings = await getAppSettings();

  settings.updatedByAdminId = req.accountId;
  await settings.save();

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