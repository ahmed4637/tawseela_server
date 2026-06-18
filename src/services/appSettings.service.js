const AppSettings = require('../models/appSettings.model');

const DEFAULT_SETTINGS = {
  key: 'main',

  driverCommissionDebtLimit: 200,

  searchRadiusKm: {
    instantRide: 5,
    deliveryOrder: 8,
    scheduledRide: 25,
  },

  scheduledRemindersMinutes: {
    twoHours: 120,
    oneHour: 60,
    thirtyMinutes: 30,
    tenMinutes: 10,
  },

  support: {
    phone: '',
    whatsapp: '',
    email: '',
  },

  appStatus: {
    isMaintenanceMode: false,
    maintenanceMessage: 'التطبيق تحت الصيانة حاليًا',
  },
};

const getAppSettings = async () => {
  let settings = await AppSettings.findOne({ key: 'main' });

  if (!settings) {
    settings = await AppSettings.create(DEFAULT_SETTINGS);
  }

  return settings;
};

const getDriverCommissionDebtLimit = async () => {
  const settings = await getAppSettings();
  return Number(settings.driverCommissionDebtLimit || 200);
};

const getSearchRadiusKmByServiceType = async (serviceType) => {
  const settings = await getAppSettings();

  if (serviceType === 'instant_ride') {
    return Number(settings.searchRadiusKm?.instantRide || 5);
  }

  if (serviceType === 'delivery_order') {
    return Number(settings.searchRadiusKm?.deliveryOrder || 8);
  }

  if (serviceType === 'scheduled_ride') {
    return Number(settings.searchRadiusKm?.scheduledRide || 25);
  }

  return 5;
};

module.exports = {
  getAppSettings,
  getDriverCommissionDebtLimit,
  getSearchRadiusKmByServiceType,
};