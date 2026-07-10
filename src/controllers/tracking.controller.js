const AppSettings = require('../models/appSettings.model');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const { createAdminAuditLog } = require('../services/adminAuditLog.service');
const { emitToAdmins, emitToRequest } = require('../sockets/socket.server');
const {
  getTrackingSettings,
  getLatestDriverLocationForRequest,
  getRequestLocationHistory,
  saveDriverLocationForRequest,
} = require('../services/tracking.service');

const readRequestBody = (req) =>
  req.body && typeof req.body === 'object' ? req.body : {};

const TRACKING_FIELDS = [
  'liveUpdateSeconds',
  'driverProfileSaveSeconds',
  'dbSaveSeconds',
  'minDistanceMetersToSave',
  'staleLocationWarningSeconds',
  'saveOnlyDuringActiveRequest',
  'adminLiveTrackingEnabled',
];

const getPublicTrackingSettings = asyncHandler(async (req, res) => {
  const settings = await getTrackingSettings();

  return sendSuccess({
    res,
    message: 'تم جلب إعدادات التتبع بنجاح',
    doc: settings,
  });
});

const getRequestLatestDriverLocation = asyncHandler(async (req, res) => {
  const data = await getLatestDriverLocationForRequest({
    serviceRequestId: req.params.serviceRequestId,
    accountId: req.accountId,
    roles: req.roles || [],
  });

  return sendSuccess({
    res,
    message: 'تم جلب آخر موقع للسائق بنجاح',
    doc: data.latestLocation,
    extra: {
      request: data.request,
      driverProfile: data.driverProfile,
    },
  });
});

const getMyRequestLocationHistory = asyncHandler(async (req, res) => {
  const data = await getRequestLocationHistory({
    serviceRequestId: req.params.serviceRequestId,
    accountId: req.accountId,
    roles: req.roles || [],
    limit: req.query.limit,
  });

  return sendSuccess({
    res,
    message: 'تم جلب مسار التتبع بنجاح',
    docs: data.docs,
    extra: {
      request: data.request,
    },
  });
});


const updateMyDriverLocationForRequest = asyncHandler(async (req, res) => {
  if (!req.roles?.includes('driver')) {
    const error = new Error('هذا الإجراء متاح للسائق فقط');
    error.statusCode = 403;
    throw error;
  }

  const body = readRequestBody(req);
  const data = await saveDriverLocationForRequest({
    accountId: req.accountId,
    serviceRequestId: req.params.serviceRequestId,
    lat: body.lat,
    lng: body.lng,
    latitude: body.latitude,
    longitude: body.longitude,
    speed: body.speed,
    heading: body.heading,
    accuracy: body.accuracy,
    timestamp: body.timestamp ?? body.updatedAt,
    metadata: {
      source: 'rest_fallback',
      platform: body.platform || null,
      appVersion: body.appVersion || null,
    },
  });

  if (data.locationPayload.serviceRequestId) {
    emitToRequest(
      data.locationPayload.serviceRequestId,
      'driver:location-updated',
      data.locationPayload
    );
  }

  if (data.settings.adminLiveTrackingEnabled) {
    emitToAdmins('driver:location-updated', {
      ...data.locationPayload,
      activeServiceRequestId: data.locationPayload.serviceRequestId,
    });
  }

  return sendSuccess({
    res,
    message: 'تم حفظ موقع السائق بنجاح',
    doc: data.locationPayload,
    extra: {
      savedToHistory: data.locationPayload.savedToHistory,
      savedToDriverProfile: data.locationPayload.savedToDriverProfile,
    },
  });
});

const getAdminTrackingSettings = asyncHandler(async (req, res) => {
  const settings = await getTrackingSettings();

  return sendSuccess({
    res,
    message: 'تم جلب إعدادات التتبع بنجاح',
    doc: settings,
  });
});

const updateAdminTrackingSettings = asyncHandler(async (req, res) => {
  const settingsDoc = await AppSettings.findOneAndUpdate(
    { key: 'main' },
    { $setOnInsert: { key: 'main' } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  const oldValue = {
    tracking: settingsDoc.tracking ? settingsDoc.tracking.toObject?.() || settingsDoc.tracking : null,
  };

  const nextTracking = {
    ...(settingsDoc.tracking?.toObject?.() || settingsDoc.tracking || {}),
  };

  TRACKING_FIELDS.forEach((field) => {
    if (req.body[field] !== undefined) {
      nextTracking[field] = req.body[field];
    }
  });

  settingsDoc.tracking = nextTracking;
  settingsDoc.updatedByAdminId = req.accountId;
  await settingsDoc.save();

  await createAdminAuditLog({
    req,
    module: 'tracking_settings',
    action: 'update',
    entityType: 'AppSettings',
    entityId: settingsDoc._id,
    oldValue,
    newValue: { tracking: settingsDoc.tracking },
    reason: req.body.reason || 'تعديل إعدادات التتبع من الداشبورد',
  });

  return sendSuccess({
    res,
    message: 'تم تحديث إعدادات التتبع بنجاح',
    doc: settingsDoc.tracking,
  });
});

const getAdminRequestLocationHistory = asyncHandler(async (req, res) => {
  const data = await getRequestLocationHistory({
    serviceRequestId: req.params.serviceRequestId,
    accountId: req.accountId,
    roles: req.roles || [],
    limit: req.query.limit,
  });

  return sendSuccess({
    res,
    message: 'تم جلب مسار الرحلة بنجاح',
    docs: data.docs,
    extra: {
      request: data.request,
    },
  });
});

module.exports = {
  getPublicTrackingSettings,
  getRequestLatestDriverLocation,
  getMyRequestLocationHistory,
  updateMyDriverLocationForRequest,
  getAdminTrackingSettings,
  updateAdminTrackingSettings,
  getAdminRequestLocationHistory,
};
