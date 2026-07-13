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
  emitToRequest,
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


const recordScheduledActivationError = async ({ request, message }) => {
  const cleanMessage = String(message || '').trim();
  const previousMessage = String(request.scheduledActivationLastError || '').trim();

  request.scheduledActivationAttempts = Number(request.scheduledActivationAttempts || 0) + 1;
  request.scheduledActivationLastError = cleanMessage;
  await request.save();

  if (cleanMessage && cleanMessage !== previousMessage) {
    await safeCreateNotification({
      accountId: request.acceptedDriverAccountId,
      title: 'تنبيه بخصوص الحجز المجدول',
      body: cleanMessage,
      type: 'scheduled_reminder',
      data: {
        serviceRequestId: request._id,
        requestCode: request.requestCode,
        scheduledAt: request.scheduledAt,
        reason: 'scheduled_activation_blocked',
      },
    });
  }
};

const reserveDriverForScheduledRequest = async ({ request, now = new Date() }) => {
  if (!request?.acceptedDriverAccountId) {
    return { reserved: false, reason: 'لا يوجد سائق مؤكد للحجز' };
  }

  if (request.scheduledDriverReservedAt) {
    return { reserved: true, alreadyReserved: true };
  }

  const profile = await DriverProfile.findOneAndUpdate(
    {
      accountId: request.acceptedDriverAccountId,
      isActive: true,
      isApproved: true,
      reviewStatus: 'approved',
      isBlockedForDebt: false,
      $or: [
        { activeServiceRequestId: null },
        { activeServiceRequestId: request._id },
      ],
      $expr: {
        $lt: ['$commissionDebt', '$commissionDebtLimit'],
      },
    },
    {
      activeServiceRequestId: request._id,
      currentVehicleId: request.acceptedDriverVehicleId,
      isAvailable: false,
    },
    {
      new: true,
      runValidators: true,
    },
  );

  if (!profile) {
    return {
      reserved: false,
      reason: 'لديك طلب آخر نشط. أنهِه حتى يتم تشغيل الحجز المجدول تلقائيًا',
    };
  }

  request.scheduledDriverReservedAt = request.scheduledDriverReservedAt || now;
  request.scheduledActivationAttempts = Number(request.scheduledActivationAttempts || 0) + 1;
  request.scheduledActivationLastError = '';
  await request.save();

  safeSocketEmit(() => {
    const payload = {
      request,
      requestId: request._id,
      serviceRequestId: request._id,
      scheduledAt: request.scheduledAt,
      status: request.status,
      phase: 'driver_reserved',
    };

    emitToAccount(request.acceptedDriverAccountId.toString(), 'scheduled:driver-reserved', payload);
    emitToAccount(request.customerAccountId.toString(), 'scheduled:driver-reserved', payload);
    emitToRequest(request._id.toString(), 'scheduled:driver-reserved', payload);
    emitToAdmins('admin:scheduled-driver-reserved', payload);
  });

  return { reserved: true };
};

const activateScheduledRequest = async ({ request, now = new Date() }) => {
  if (request.status !== 'offer_accepted') {
    return { activated: false, skipped: true };
  }

  const reservation = await reserveDriverForScheduledRequest({ request, now });

  if (!reservation.reserved) {
    await recordScheduledActivationError({ request, message: reservation.reason });
    return { activated: false, blocked: true, reason: reservation.reason };
  }

  const activatedRequest = await ServiceRequest.findOneAndUpdate(
    {
      _id: request._id,
      serviceType: 'scheduled_ride',
      status: 'offer_accepted',
      acceptedDriverAccountId: { $ne: null },
    },
    {
      $set: {
        status: 'driver_arriving',
        driverArrivingAt: now,
        scheduledActivatedAt: now,
        scheduledActivationLastError: '',
        'reminderStatus.tenMinutes': true,
        lastStatusChangedAt: now,
      },
      $inc: {
        scheduledActivationAttempts: 1,
      },
    },
    {
      new: true,
      runValidators: true,
    },
  );

  if (!activatedRequest) {
    return { activated: false, skipped: true };
  }

  const payload = {
    request: activatedRequest,
    requestId: activatedRequest._id,
    serviceRequestId: activatedRequest._id,
    status: activatedRequest.status,
    scheduledAt: activatedRequest.scheduledAt,
    phase: 'runtime_started',
    emittedAt: now,
  };

  safeSocketEmit(() => {
    emitToAccount(
      activatedRequest.customerAccountId.toString(),
      'request:status-live',
      payload,
    );
    emitToAccount(
      activatedRequest.acceptedDriverAccountId.toString(),
      'request:status-live',
      payload,
    );
    emitToRequest(
      activatedRequest._id.toString(),
      'request:status-live',
      payload,
    );
    emitToAdmins('admin:request-status-live', payload);

    // Keep compatibility with screens that still listen to the enriched/status
    // event while the compact live event remains the primary runtime tunnel.
    emitToAccount(
      activatedRequest.customerAccountId.toString(),
      'request:status-changed',
      payload,
    );
    emitToAccount(
      activatedRequest.acceptedDriverAccountId.toString(),
      'request:status-changed',
      payload,
    );
    emitToRequest(
      activatedRequest._id.toString(),
      'request:status-changed',
      payload,
    );
    emitToAdmins('admin:request-status-changed', payload);
  });

  await Promise.all([
    safeCreateNotification({
      accountId: activatedRequest.customerAccountId,
      title: 'بدأ وقت الاستعداد للحجز',
      body: 'السائق يبدأ الآن التحرك إلى نقطة الانطلاق',
      type: 'scheduled_reminder',
      data: {
        serviceRequestId: activatedRequest._id,
        requestCode: activatedRequest.requestCode,
        scheduledAt: activatedRequest.scheduledAt,
        status: activatedRequest.status,
      },
    }),
    safeCreateNotification({
      accountId: activatedRequest.acceptedDriverAccountId,
      title: 'ابدأ التوجه للحجز',
      body: 'متبقي حوالي 10 دقائق على الحجز. افتح الخريطة وتوجه للعميل',
      type: 'scheduled_reminder',
      data: {
        serviceRequestId: activatedRequest._id,
        requestCode: activatedRequest.requestCode,
        scheduledAt: activatedRequest.scheduledAt,
        status: activatedRequest.status,
      },
    }),
  ]);

  return { activated: true, request: activatedRequest };
};


const expireMissedScheduledRequest = async ({ request, now = new Date() }) => {
  const expiredRequest = await ServiceRequest.findOneAndUpdate(
    {
      _id: request._id,
      serviceType: 'scheduled_ride',
      status: 'offer_accepted',
    },
    {
      $set: {
        status: 'expired',
        dispatchStatus: 'expired',
        cancelledAt: now,
        cancellationReason: 'انتهت مهلة تشغيل الحجز المجدول',
        lastStatusChangedAt: now,
        scheduledActivationLastError: 'انتهت مهلة تشغيل الحجز المجدول',
      },
    },
    { new: true, runValidators: true },
  );

  if (!expiredRequest) return false;

  await DriverProfile.updateOne(
    {
      accountId: expiredRequest.acceptedDriverAccountId,
      activeServiceRequestId: expiredRequest._id,
    },
    {
      $set: {
        activeServiceRequestId: null,
        isAvailable: true,
      },
    },
  );

  const payload = {
    request: expiredRequest,
    requestId: expiredRequest._id,
    serviceRequestId: expiredRequest._id,
    status: expiredRequest.status,
    reason: 'scheduled_runtime_expired',
  };

  safeSocketEmit(() => {
    emitToAccount(expiredRequest.customerAccountId.toString(), 'request:expired', payload);
    emitToAccount(expiredRequest.acceptedDriverAccountId.toString(), 'request:expired', payload);
    emitToRequest(expiredRequest._id.toString(), 'request:expired', payload);
    emitToAdmins('admin:request-expired', payload);
  });

  await Promise.all([
    safeCreateNotification({
      accountId: expiredRequest.customerAccountId,
      title: 'تعذر تشغيل الحجز المجدول',
      body: 'انتهت مهلة تشغيل الحجز. يمكنك إنشاء حجز جديد أو التواصل مع الدعم',
      type: 'scheduled_reminder',
      data: { serviceRequestId: expiredRequest._id, reason: 'runtime_expired' },
    }),
    safeCreateNotification({
      accountId: expiredRequest.acceptedDriverAccountId,
      title: 'انتهت مهلة الحجز المجدول',
      body: 'لم يتم تشغيل الحجز في موعده وتم إغلاقه تلقائيًا',
      type: 'scheduled_reminder',
      data: { serviceRequestId: expiredRequest._id, reason: 'runtime_expired' },
    }),
  ]);

  return true;
};

const releasePrematureScheduledReservations = async ({
  now = new Date(),
  lockBeforeMinutes = 30,
} = {}) => {
  const lockBoundary = new Date(
    now.getTime() + Math.max(Number(lockBeforeMinutes || 30), 1) * 60 * 1000,
  );

  // Recover future bookings created by the old flow, which locked the driver
  // immediately after accepting the offer instead of waiting for the 30-minute
  // reservation window.
  const requests = await ServiceRequest.find({
    serviceType: 'scheduled_ride',
    status: 'offer_accepted',
    acceptedDriverAccountId: { $ne: null },
    scheduledAt: { $gt: lockBoundary },
  })
    .select(
      '_id acceptedDriverAccountId scheduledDriverReservedAt scheduledActivationLastError',
    )
    .limit(200);

  let releasedCount = 0;

  for (const request of requests) {
    const releaseResult = await DriverProfile.updateOne(
      {
        accountId: request.acceptedDriverAccountId,
        activeServiceRequestId: request._id,
      },
      {
        $set: {
          activeServiceRequestId: null,
          currentVehicleId: null,
          isAvailable: true,
        },
      },
    );

    const hasPrematureMetadata =
      request.scheduledDriverReservedAt != null ||
      String(request.scheduledActivationLastError || '').trim().length > 0;

    if (hasPrematureMetadata) {
      request.scheduledDriverReservedAt = null;
      request.scheduledActivationLastError = '';
      await request.save();
    }

    if ((releaseResult.modifiedCount || 0) > 0 || hasPrematureMetadata) {
      releasedCount += 1;
    }
  }

  return releasedCount;
};

const processScheduledRideRuntime = async () => {
  const settings = await getScheduledRequestSettings();
  const now = new Date();
  const lockBeforeMinutes = Math.max(Number(settings.driverLockBeforeMinutes || 30), 1);
  const activateBeforeMinutes = Math.max(
    Math.min(Number(settings.activateBeforeMinutes || 10), lockBeforeMinutes),
    0,
  );
  const upperBound = new Date(now.getTime() + lockBeforeMinutes * 60 * 1000);
  const releasedPrematureCount = await releasePrematureScheduledReservations({
    now,
    lockBeforeMinutes,
  });

  const requests = await ServiceRequest.find({
    serviceType: 'scheduled_ride',
    status: 'offer_accepted',
    acceptedDriverAccountId: { $ne: null },
    scheduledAt: { $ne: null, $lte: upperBound },
  })
    .sort({ scheduledAt: 1 })
    .limit(200);

  let reservedCount = 0;
  let activatedCount = 0;
  let blockedCount = 0;
  let missedExpiredCount = 0;

  for (const request of requests) {
    const minutesUntil = (new Date(request.scheduledAt).getTime() - now.getTime()) / 60000;

    if (minutesUntil < -Math.max(Number(settings.expireAfterScheduledMinutes || 30), 1)) {
      const expired = await expireMissedScheduledRequest({ request, now });
      if (expired) missedExpiredCount += 1;
      continue;
    }

    if (minutesUntil <= lockBeforeMinutes && !request.scheduledDriverReservedAt) {
      const reservation = await reserveDriverForScheduledRequest({ request, now });

      if (reservation.reserved) {
        if (!reservation.alreadyReserved) reservedCount += 1;
      } else {
        blockedCount += 1;
        await recordScheduledActivationError({ request, message: reservation.reason });
        continue;
      }
    }

    if (minutesUntil <= activateBeforeMinutes) {
      const activation = await activateScheduledRequest({ request, now });
      if (activation.activated) activatedCount += 1;
      if (activation.blocked) blockedCount += 1;
    }
  }

  return {
    releasedPrematureCount,
    reservedCount,
    activatedCount,
    blockedCount,
    missedExpiredCount,
  };
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
  // Runtime first: at the 10-minute boundary activation sends the actionable
  // notification and marks the generic 10-minute reminder as handled.
  const runtimeResult = await processScheduledRideRuntime();
  await checkScheduledRideReminders();
  const dispatchedCount = await dispatchDueScheduledRequests();
  const cleanupResult = await expireOpenRequestsAndOffers();

  return {
    dispatchedCount,
    ...runtimeResult,
    ...cleanupResult,
  };
};

module.exports = {
  dispatchServiceRequestToNearbyDrivers,
  checkScheduledRideReminders,
  dispatchDueScheduledRequests,
  processScheduledRideRuntime,
  expireOpenRequestsAndOffers,
  runScheduledRequestTick,
};
