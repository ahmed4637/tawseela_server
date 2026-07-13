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

  scheduledRide: {
    // الحجز بموعد يظهر للسائقين فورًا، والقيمة دي متروكة للتوافق القديم فقط.
    dispatchBeforeMinutes: 0,
    minLeadMinutes: 30,
    driverLockBeforeMinutes: 30,
    activateBeforeMinutes: 10,
    reservationAfterMinutes: 120,
    expireAfterScheduledMinutes: 30,
    reminderToleranceMinutes: 5,
  },

  requestLifecycle: {
    instantRequestExpiryMinutes: 15,
    deliveryRequestExpiryMinutes: 20,
    scheduledRequestExpiryAfterMinutes: 30,
    offerExpiryMinutes: 5,
    workerIntervalSeconds: 60,
    cleanupBatchLimit: 200,
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

  loyalty: {
    isEnabled: true,
    customerEarnPointsPerFarePound: 1,
    driverEarnPointsPerCompletedRequest: 10,
    customerAfterAcceptanceCancelDeductionPoints: 100,
    driverAfterAcceptanceCancelDeductionPoints: 0,
    allowNegativeBalance: false,
    tierRules: {
      silver: 500,
      gold: 1500,
      platinum: 5000,
    },
  },

  tracking: {
    liveUpdateSeconds: 1,
    driverProfileSaveSeconds: 3,
    dbSaveSeconds: 5,
    minDistanceMetersToSave: 10,
    staleLocationWarningSeconds: 30,
    saveOnlyDuringActiveRequest: true,
    adminLiveTrackingEnabled: true,
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


const getTrackingSettings = async () => {
  const settings = await getAppSettings();
  const tracking = settings.tracking || {};

  return {
    liveUpdateSeconds: Number(tracking.liveUpdateSeconds || 1),
    driverProfileSaveSeconds: Number(tracking.driverProfileSaveSeconds || 3),
    dbSaveSeconds: Number(tracking.dbSaveSeconds || 5),
    minDistanceMetersToSave: Number(tracking.minDistanceMetersToSave || 10),
    staleLocationWarningSeconds: Number(tracking.staleLocationWarningSeconds || 30),
    saveOnlyDuringActiveRequest: tracking.saveOnlyDuringActiveRequest !== false,
    adminLiveTrackingEnabled: tracking.adminLiveTrackingEnabled !== false,
  };
};


const getScheduledRequestSettings = async () => {
  const settings = await getAppSettings();
  const scheduledRide = settings.scheduledRide || {};
  const requestLifecycle = settings.requestLifecycle || {};
  const reminders = settings.scheduledRemindersMinutes || {};

  return {
    // القرار النهائي: الحجز بموعد يرسل للسائقين فورًا بعد إنشائه.
    dispatchBeforeMinutes: 0,
    minLeadMinutes: Number(scheduledRide.minLeadMinutes ?? 15),
    expireAfterScheduledMinutes: Number(
      scheduledRide.expireAfterScheduledMinutes ??
        requestLifecycle.scheduledRequestExpiryAfterMinutes ??
        30,
    ),
    reminderToleranceMinutes: Number(scheduledRide.reminderToleranceMinutes ?? 5),
    driverLockBeforeMinutes: Number(
      scheduledRide.driverLockBeforeMinutes ?? reminders.thirtyMinutes ?? 30,
    ),
    activateBeforeMinutes: Number(
      scheduledRide.activateBeforeMinutes ?? reminders.tenMinutes ?? 10,
    ),
    reservationAfterMinutes: Number(
      scheduledRide.reservationAfterMinutes ?? 120,
    ),
    remindersMinutes: {
      twoHours: Number(reminders.twoHours ?? 120),
      oneHour: Number(reminders.oneHour ?? 60),
      thirtyMinutes: Number(reminders.thirtyMinutes ?? 30),
      tenMinutes: Number(reminders.tenMinutes ?? 10),
    },
  };
};

const getRequestLifecycleSettings = async () => {
  const settings = await getAppSettings();
  const lifecycle = settings.requestLifecycle || {};

  return {
    instantRequestExpiryMinutes: Number(lifecycle.instantRequestExpiryMinutes ?? 15),
    deliveryRequestExpiryMinutes: Number(lifecycle.deliveryRequestExpiryMinutes ?? 20),
    scheduledRequestExpiryAfterMinutes: Number(
      lifecycle.scheduledRequestExpiryAfterMinutes ??
        settings.scheduledRide?.expireAfterScheduledMinutes ??
        30,
    ),
    offerExpiryMinutes: Number(lifecycle.offerExpiryMinutes ?? 5),
    workerIntervalSeconds: Number(lifecycle.workerIntervalSeconds ?? 60),
    cleanupBatchLimit: Number(lifecycle.cleanupBatchLimit ?? 200),
  };
};

const getOfferExpiryDate = async () => {
  const lifecycle = await getRequestLifecycleSettings();
  return new Date(Date.now() + lifecycle.offerExpiryMinutes * 60 * 1000);
};

const buildRequestLifecycleDates = async ({ serviceType, scheduledAt = null }) => {
  const lifecycle = await getRequestLifecycleSettings();
  const scheduled = await getScheduledRequestSettings();
  const now = new Date();

  if (serviceType === 'scheduled_ride') {
    const scheduledDate = new Date(scheduledAt);
    const requestExpiresAt = new Date(
      scheduledDate.getTime() + scheduled.expireAfterScheduledMinutes * 60 * 1000,
    );

    // القرار النهائي للحجز بموعد:
    // الطلب يظهر للسائقين فورًا بعد إنشائه حتى يقبل سائق ويلتزم بالموعد.
    return {
      dispatchAt: now,
      requestExpiresAt,
      dispatchStatus: 'dispatched',
      dispatchedAt: now,
    };
  }

  const expiryMinutes = serviceType === 'delivery_order'
    ? lifecycle.deliveryRequestExpiryMinutes
    : lifecycle.instantRequestExpiryMinutes;

  return {
    dispatchAt: now,
    requestExpiresAt: new Date(now.getTime() + expiryMinutes * 60 * 1000),
    dispatchStatus: 'dispatched',
    dispatchedAt: now,
  };
};

module.exports = {
  getAppSettings,
  getDriverCommissionDebtLimit,
  getSearchRadiusKmByServiceType,
  getTrackingSettings,
  getScheduledRequestSettings,
  getRequestLifecycleSettings,
  getOfferExpiryDate,
  buildRequestLifecycleDates,
};