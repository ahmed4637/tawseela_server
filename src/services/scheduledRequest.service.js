const ServiceRequest = require('../models/serviceRequest.model');
const ServiceOffer = require('../models/serviceOffer.model');
const DriverProfile = require('../models/driverProfile.model');
const DriverVehicle = require('../models/driverVehicle.model');
const { createNotification } = require('./notification.service');
const { cancelPromoReservationsForRequest } = require('./promo.service');
const { getRestrictedAccountIds } = require('./penalty.service');
const {
  getScheduledRequestSettings,
  getRequestLifecycleSettings,
} = require('./appSettings.service');
const {
  emitToAdmins,
  emitToAccount,
  emitToVehicle,
} = require('../sockets/socket.server');

const OPEN_REQUEST_STATUSES = ['pending_offers', 'negotiating'];
const REMINDER_DEFINITIONS = [
  {
    key: 'twoHours',
    title: 'تذكير بالحجز',
    body: 'متبقي حوالي ساعتين على موعد الرحلة المجدولة',
  },
  {
    key: 'oneHour',
    title: 'تذكير بالحجز',
    body: 'متبقي حوالي ساعة على موعد الرحلة المجدولة',
  },
  {
    key: 'thirtyMinutes',
    title: 'تذكير بالحجز',
    body: 'متبقي حوالي نصف ساعة على موعد الرحلة المجدولة',
  },
  {
    key: 'tenMinutes',
    title: 'تذكير بالحجز',
    body: 'متبقي حوالي 10 دقائق على موعد الرحلة المجدولة',
  },
];

const safeSocketEmit = (callback) => {
  try {
    callback();
  } catch (error) {
    console.error('Scheduled request socket emit error:', error.message);
  }
};

const safeCreateNotification = async ({ accountId, title, body, type = 'request', data = {} }) => {
  try {
    await createNotification({ accountId, title, body, type, data });
  } catch (error) {
    console.error('Scheduled request notification error:', error.message);
  }
};

const getMinutesUntil = (targetDate) => {
  return Math.floor((new Date(targetDate).getTime() - Date.now()) / 60000);
};

const findNearbyDriverAccountIdsForRequest = async (request) => {
  if (!request?.pickupLocation?.coordinates?.length || !request.vehicleTypeCode) {
    return [];
  }

  const driverVehicles = await DriverVehicle.find({
    vehicleTypeCode: request.vehicleTypeCode,
    isActive: true,
    isApproved: true,
    reviewStatus: 'approved',
  }).select('accountId');

  const driverAccountIds = [
    ...new Set(driverVehicles.map((vehicle) => vehicle.accountId?.toString()).filter(Boolean)),
  ];

  if (!driverAccountIds.length) {
    return [];
  }

  const maxDistanceMeters = Number(request.searchRadiusKm || 5) * 1000;

  const profiles = await DriverProfile.find({
    accountId: { $in: driverAccountIds },
    isActive: true,
    isOnline: true,
    isAvailable: true,
    isApproved: true,
    reviewStatus: 'approved',
    isBlockedForDebt: false,
    activeServiceRequestId: null,
    $expr: {
      $lt: ['$commissionDebt', '$commissionDebtLimit'],
    },
    currentLocation: {
      $near: {
        $geometry: request.pickupLocation,
        $maxDistance: maxDistanceMeters,
      },
    },
  }).select('accountId');

  const accountIds = profiles.map((profile) => profile.accountId.toString());

  const restrictedAccountIds = await getRestrictedAccountIds({
    accountIds,
    restrictionTypes: ['app_usage', 'driver_online', 'receiving_requests'],
  });

  return accountIds.filter((accountId) => !restrictedAccountIds.has(accountId));
};

const buildDriverRequestPayload = (request) => ({ request });

const dispatchServiceRequestToNearbyDrivers = async ({
  request,
  reason = 'request_dispatch',
  notifyCustomer = false,
} = {}) => {
  if (!request) {
    return { driversCount: 0 };
  }

  const freshRequest = await ServiceRequest.findById(request._id || request);

  if (!freshRequest || !OPEN_REQUEST_STATUSES.includes(freshRequest.status)) {
    return { driversCount: 0 };
  }

  const nearbyDriverAccountIds = await findNearbyDriverAccountIdsForRequest(freshRequest);
  const now = new Date();

  freshRequest.dispatchStatus = 'dispatched';
  freshRequest.dispatchedAt = freshRequest.dispatchedAt || now;
  freshRequest.lastDispatchAttemptAt = now;
  freshRequest.dispatchAttempts = Number(freshRequest.dispatchAttempts || 0) + 1;
  freshRequest.lastDispatchedDriversCount = nearbyDriverAccountIds.length;
  await freshRequest.save();

  safeSocketEmit(() => {
    const requestPayload = buildDriverRequestPayload(freshRequest);

    emitToVehicle(freshRequest.vehicleTypeCode, 'request:new', requestPayload);

    nearbyDriverAccountIds.forEach((driverAccountId) => {
      emitToAccount(driverAccountId, 'request:new', requestPayload);
    });

    emitToAccount(freshRequest.customerAccountId.toString(), 'request:dispatched', {
      request: freshRequest,
      nearbyDriversCount: nearbyDriverAccountIds.length,
      reason,
    });

    emitToAdmins('admin:request-dispatched', {
      request: freshRequest,
      nearbyDriversCount: nearbyDriverAccountIds.length,
      reason,
    });
  });

  if (notifyCustomer) {
    await safeCreateNotification({
      accountId: freshRequest.customerAccountId,
      title: 'تم إرسال الحجز للسائقين',
      body: 'تم إرسال الحجز بموعد للسائقين المؤهلين، وسيتم تذكير السائق المقبول بالموعد داخل التطبيق',
      type: 'request',
      data: {
        serviceRequestId: freshRequest._id,
        requestCode: freshRequest.requestCode,
        reason,
      },
    });
  }

  return { request: freshRequest, driversCount: nearbyDriverAccountIds.length };
};

const sendReminderIfNeeded = async ({ request, key, title, body }) => {
  if (request.reminderStatus?.[key] === true) {
    return false;
  }

  await safeCreateNotification({
    accountId: request.customerAccountId,
    title,
    body,
    type: 'scheduled_reminder',
    data: {
      serviceRequestId: request._id,
      requestCode: request.requestCode,
      reminderKey: key,
    },
  });

  if (request.acceptedDriverAccountId) {
    await safeCreateNotification({
      accountId: request.acceptedDriverAccountId,
      title,
      body,
      type: 'scheduled_reminder',
      data: {
        serviceRequestId: request._id,
        requestCode: request.requestCode,
        reminderKey: key,
      },
    });
  }

  request.reminderStatus[key] = true;
  await request.save();
  return true;
};

const checkScheduledRideReminders = async () => {
  const settings = await getScheduledRequestSettings();
  const reminders = settings.remindersMinutes;
  const maxReminderMinutes = Math.max(...Object.values(reminders));
  const now = new Date();
  const upperBound = new Date(now.getTime() + (maxReminderMinutes + 5) * 60 * 1000);

  const requests = await ServiceRequest.find({
    serviceType: 'scheduled_ride',
    status: {
      $in: ['offer_accepted', 'driver_arriving', 'arrived_to_pickup'],
    },
    scheduledAt: {
      $gte: now,
      $lte: upperBound,
    },
  });

  const thresholds = REMINDER_DEFINITIONS
    .map((item) => ({ ...item, minutes: Number(reminders[item.key] || 0) }))
    .filter((item) => item.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);

  for (const request of requests) {
    const diffMinutes = getMinutesUntil(request.scheduledAt);

    for (let index = 0; index < thresholds.length; index += 1) {
      const reminder = thresholds[index];
      const nextReminder = thresholds[index + 1];
      const lowerBound = nextReminder ? nextReminder.minutes : -1;

      if (
        diffMinutes <= reminder.minutes &&
        diffMinutes > lowerBound &&
        diffMinutes >= 0
      ) {
        await sendReminderIfNeeded({ request, ...reminder });
      }
    }
  }
};

const dispatchDueScheduledRequests = async () => {
  // القرار النهائي: الحجز بموعد يرسل للسائقين فورًا عند الإنشاء.
  // هذا الجزء موجود فقط لمعالجة أي طلبات قديمة اتسجلت بحالة scheduled_waiting قبل التصحيح.
  const lifecycle = await getRequestLifecycleSettings();
  const now = new Date();

  const requests = await ServiceRequest.find({
    serviceType: 'scheduled_ride',
    status: { $in: OPEN_REQUEST_STATUSES },
    dispatchStatus: 'scheduled_waiting',
    requestExpiresAt: { $gt: now },
  })
    .sort({ createdAt: 1 })
    .limit(lifecycle.cleanupBatchLimit);

  for (const request of requests) {
    await dispatchServiceRequestToNearbyDrivers({
      request,
      reason: 'scheduled_request_created_immediate_dispatch',
      notifyCustomer: true,
    });
  }

  return requests.length;
};

const expireRequest = async ({ request, reason }) => {
  if (!request || !OPEN_REQUEST_STATUSES.includes(request.status)) {
    return false;
  }

  const wasDispatched = request.dispatchStatus === 'dispatched';

  request.status = 'expired';
  request.dispatchStatus = 'expired';
  request.cancelledAt = new Date();
  request.cancellationReason = reason;
  request.lastStatusChangedAt = new Date();
  await request.save();

  await ServiceOffer.updateMany(
    {
      serviceRequestId: request._id,
      status: 'pending',
    },
    {
      status: 'expired',
      expiredAt: new Date(),
      closedAt: new Date(),
      closedBy: 'system',
      closedReason: reason,
    },
  );

  await cancelPromoReservationsForRequest({ serviceRequestId: request._id });

  safeSocketEmit(() => {
    const payload = {
      request,
      status: 'expired',
      reason,
    };

    emitToAccount(request.customerAccountId.toString(), 'request:expired', payload);

    if (request.vehicleTypeCode && wasDispatched) {
      emitToVehicle(request.vehicleTypeCode, 'request:expired', payload);
    }

    emitToAdmins('admin:request-expired', payload);
  });

  await safeCreateNotification({
    accountId: request.customerAccountId,
    title: 'انتهت صلاحية الطلب',
    body: 'انتهت صلاحية الطلب بدون قبول عرض مناسب',
    type: 'request',
    data: {
      serviceRequestId: request._id,
      requestCode: request.requestCode,
      reason,
    },
  });

  return true;
};

const expireOpenRequestsAndOffers = async () => {
  const lifecycle = await getRequestLifecycleSettings();
  const now = new Date();

  const [expiredOffersResult, requests] = await Promise.all([
    ServiceOffer.updateMany(
      {
        status: 'pending',
        expiresAt: { $ne: null, $lte: now },
      },
      {
        status: 'expired',
        expiredAt: now,
        closedAt: now,
        closedBy: 'system',
        closedReason: 'انتهت صلاحية العرض تلقائيًا',
      },
    ),
    ServiceRequest.find({
      status: { $in: OPEN_REQUEST_STATUSES },
      requestExpiresAt: { $ne: null, $lte: now },
    })
      .sort({ requestExpiresAt: 1 })
      .limit(lifecycle.cleanupBatchLimit),
  ]);

  let expiredRequestsCount = 0;

  for (const request of requests) {
    const expired = await expireRequest({
      request,
      reason: 'انتهت صلاحية الطلب تلقائيًا',
    });

    if (expired) {
      expiredRequestsCount += 1;
    }
  }

  return {
    expiredOffersCount: expiredOffersResult.modifiedCount || 0,
    expiredRequestsCount,
  };
};

const runScheduledRequestTick = async () => {
  await checkScheduledRideReminders();
  const dispatchedCount = await dispatchDueScheduledRequests();
  const cleanupResult = await expireOpenRequestsAndOffers();

  return {
    dispatchedCount,
    ...cleanupResult,
  };
};

module.exports = {
  dispatchServiceRequestToNearbyDrivers,
  checkScheduledRideReminders,
  dispatchDueScheduledRequests,
  expireOpenRequestsAndOffers,
  runScheduledRequestTick,
};
