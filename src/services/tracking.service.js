const mongoose = require('mongoose');

const DriverProfile = require('../models/driverProfile.model');
const ServiceRequest = require('../models/serviceRequest.model');
const TripLocationSnapshot = require('../models/tripLocationSnapshot.model');
const { getAppSettings } = require('./appSettings.service');

const ACTIVE_TRACKING_STATUSES = [
  'accepted',
  'driver_arriving',
  'driver_arrived',
  'in_progress',
];

const DEFAULT_TRACKING_SETTINGS = {
  liveUpdateSeconds: 1,
  driverProfileSaveSeconds: 3,
  dbSaveSeconds: 5,
  minDistanceMetersToSave: 10,
  staleLocationWarningSeconds: 30,
  saveOnlyDuringActiveRequest: true,
  adminLiveTrackingEnabled: true,
};

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value?.toString() || '');

const toNumberOrNull = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const normalizeCoordinates = ({ lat, lng, latitude, longitude }) => {
  const latNumber = Number(lat ?? latitude);
  const lngNumber = Number(lng ?? longitude);

  if (!Number.isFinite(latNumber) || latNumber < -90 || latNumber > 90) {
    const error = new Error('خط عرض الموقع غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  if (!Number.isFinite(lngNumber) || lngNumber < -180 || lngNumber > 180) {
    const error = new Error('خط طول الموقع غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  return {
    lat: latNumber,
    lng: lngNumber,
  };
};

const getTrackingSettings = async () => {
  const settings = await getAppSettings();
  const tracking = settings.tracking || {};

  return {
    liveUpdateSeconds: Number(
      tracking.liveUpdateSeconds ?? DEFAULT_TRACKING_SETTINGS.liveUpdateSeconds
    ),
    driverProfileSaveSeconds: Number(
      tracking.driverProfileSaveSeconds ??
        DEFAULT_TRACKING_SETTINGS.driverProfileSaveSeconds
    ),
    dbSaveSeconds: Number(
      tracking.dbSaveSeconds ?? DEFAULT_TRACKING_SETTINGS.dbSaveSeconds
    ),
    minDistanceMetersToSave: Number(
      tracking.minDistanceMetersToSave ??
        DEFAULT_TRACKING_SETTINGS.minDistanceMetersToSave
    ),
    staleLocationWarningSeconds: Number(
      tracking.staleLocationWarningSeconds ??
        DEFAULT_TRACKING_SETTINGS.staleLocationWarningSeconds
    ),
    saveOnlyDuringActiveRequest:
      tracking.saveOnlyDuringActiveRequest !== false,
    adminLiveTrackingEnabled:
      tracking.adminLiveTrackingEnabled !== false,
  };
};

const getTrackingPhaseFromStatus = (status) => {
  if (status === 'in_progress') {
    return 'in_trip';
  }

  return 'driver_arriving';
};

const toRadians = (degrees) => (degrees * Math.PI) / 180;

const getDistanceMeters = (first, second) => {
  if (!first || !second) {
    return Infinity;
  }

  const lat1 = Number(first.lat);
  const lng1 = Number(first.lng);
  const lat2 = Number(second.lat);
  const lng2 = Number(second.lng);

  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) {
    return Infinity;
  }

  const earthRadiusMeters = 6371000;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const resolveDriverActiveRequest = async ({ driverProfile, accountId, requestId }) => {
  const profileRequestId = driverProfile.activeServiceRequestId?.toString() || '';
  const requestedId = requestId?.toString().trim() || '';
  const serviceRequestId = profileRequestId || requestedId;

  if (!serviceRequestId) {
    return null;
  }

  if (!isValidObjectId(serviceRequestId)) {
    const error = new Error('رقم الطلب غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const request = await ServiceRequest.findById(serviceRequestId)
    .select('customerAccountId acceptedDriverAccountId status pickup destination requestCode')
    .lean();

  const isAcceptedDriver =
    request?.acceptedDriverAccountId?.toString() === accountId.toString();

  if (!request || !isAcceptedDriver) {
    const error = new Error('غير مسموح بتحديث موقع هذا الطلب');
    error.statusCode = 403;
    throw error;
  }

  return request;
};

const shouldSaveDriverProfileLocation = ({ driverProfile, now, settings }) => {
  const lastSavedAt = driverProfile.currentLocationUpdatedAt
    ? new Date(driverProfile.currentLocationUpdatedAt).getTime()
    : 0;

  const intervalMs = Math.max(settings.driverProfileSaveSeconds || 3, 1) * 1000;
  return now.getTime() - lastSavedAt >= intervalMs;
};

const shouldSaveTripSnapshot = async ({ request, lat, lng, now, settings }) => {
  if (!request) {
    return false;
  }

  if (!ACTIVE_TRACKING_STATUSES.includes(request.status)) {
    return false;
  }

  const lastSnapshot = await TripLocationSnapshot.findOne({
    serviceRequestId: request._id,
  })
    .sort({ createdAt: -1 })
    .select('lat lng createdAt')
    .lean();

  if (!lastSnapshot) {
    return true;
  }

  const intervalMs = Math.max(settings.dbSaveSeconds || 5, 1) * 1000;
  const distanceMeters = getDistanceMeters(
    { lat: lastSnapshot.lat, lng: lastSnapshot.lng },
    { lat, lng }
  );

  const isTimePassed = now.getTime() - new Date(lastSnapshot.createdAt).getTime() >= intervalMs;
  const isDistancePassed = distanceMeters >= Math.max(settings.minDistanceMetersToSave || 0, 0);

  return isTimePassed || isDistancePassed;
};

const updateDriverLiveLocation = async ({
  accountId,
  requestId,
  lat,
  lng,
  latitude,
  longitude,
  speed,
  heading,
  accuracy,
  metadata,
}) => {
  const coordinates = normalizeCoordinates({ lat, lng, latitude, longitude });
  const now = new Date();

  const [settings, driverProfile] = await Promise.all([
    getTrackingSettings(),
    DriverProfile.findOne({ accountId }),
  ]);

  if (!driverProfile) {
    const error = new Error('ملف السائق غير موجود');
    error.statusCode = 404;
    throw error;
  }

  const request = await resolveDriverActiveRequest({
    driverProfile,
    accountId,
    requestId,
  });

  let savedDriverProfile = false;
  let savedSnapshot = null;

  if (shouldSaveDriverProfileLocation({ driverProfile, now, settings })) {
    driverProfile.currentLat = coordinates.lat;
    driverProfile.currentLng = coordinates.lng;
    driverProfile.currentLocation = {
      type: 'Point',
      coordinates: [coordinates.lng, coordinates.lat],
    };
    driverProfile.currentLocationUpdatedAt = now;
    await driverProfile.save();
    savedDriverProfile = true;
  }

  if (await shouldSaveTripSnapshot({ request, lat: coordinates.lat, lng: coordinates.lng, now, settings })) {
    savedSnapshot = await TripLocationSnapshot.create({
      serviceRequestId: request._id,
      driverAccountId: accountId,
      customerAccountId: request.customerAccountId || null,
      location: {
        type: 'Point',
        coordinates: [coordinates.lng, coordinates.lat],
      },
      lat: coordinates.lat,
      lng: coordinates.lng,
      speed: toNumberOrNull(speed),
      heading: toNumberOrNull(heading),
      accuracy: toNumberOrNull(accuracy),
      phase: getTrackingPhaseFromStatus(request.status),
      requestStatus: request.status,
      metadata: metadata || null,
    });
  }

  const activeRequestId = request?._id?.toString() || '';

  return {
    settings,
    driverProfile,
    request,
    savedDriverProfile,
    savedSnapshot,
    locationPayload: {
      driverAccountId: accountId.toString(),
      lat: coordinates.lat,
      lng: coordinates.lng,
      latitude: coordinates.lat,
      longitude: coordinates.lng,
      speed: toNumberOrNull(speed),
      heading: toNumberOrNull(heading),
      accuracy: toNumberOrNull(accuracy),
      requestId: activeRequestId,
      serviceRequestId: activeRequestId,
      rideId: activeRequestId,
      phase: request ? getTrackingPhaseFromStatus(request.status) : null,
      requestStatus: request?.status || '',
      savedToDriverProfile: savedDriverProfile,
      savedToHistory: !!savedSnapshot,
      snapshotId: savedSnapshot?._id || null,
      updatedAt: now,
    },
  };
};

const ensureRequestTrackingAccess = async ({ serviceRequestId, accountId, roles = [] }) => {
  if (!isValidObjectId(serviceRequestId)) {
    const error = new Error('رقم الطلب غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const request = await ServiceRequest.findById(serviceRequestId)
    .select('customerAccountId acceptedDriverAccountId status requestCode')
    .lean();

  if (!request) {
    const error = new Error('الطلب غير موجود');
    error.statusCode = 404;
    throw error;
  }

  const isCustomer = request.customerAccountId?.toString() === accountId.toString();
  const isDriver = request.acceptedDriverAccountId?.toString() === accountId.toString();
  const isAdmin = roles.includes('admin');

  if (!isCustomer && !isDriver && !isAdmin) {
    const error = new Error('غير مسموح لك بعرض تتبع هذا الطلب');
    error.statusCode = 403;
    throw error;
  }

  return request;
};

const getLatestDriverLocationForRequest = async ({ serviceRequestId, accountId, roles = [] }) => {
  const request = await ensureRequestTrackingAccess({
    serviceRequestId,
    accountId,
    roles,
  });

  const [snapshot, driverProfile] = await Promise.all([
    TripLocationSnapshot.findOne({ serviceRequestId })
      .sort({ createdAt: -1 })
      .lean(),
    request.acceptedDriverAccountId
      ? DriverProfile.findOne({ accountId: request.acceptedDriverAccountId })
          .select('accountId currentLat currentLng currentLocation currentLocationUpdatedAt isOnline isAvailable')
          .lean()
      : null,
  ]);

  return {
    request,
    snapshot,
    driverProfile,
    latestLocation: snapshot || (
      driverProfile?.currentLat !== null && driverProfile?.currentLng !== null
        ? {
            serviceRequestId,
            driverAccountId: driverProfile.accountId,
            lat: driverProfile.currentLat,
            lng: driverProfile.currentLng,
            latitude: driverProfile.currentLat,
            longitude: driverProfile.currentLng,
            createdAt: driverProfile.currentLocationUpdatedAt || null,
            source: 'driver_profile',
          }
        : null
    ),
  };
};

const getRequestLocationHistory = async ({ serviceRequestId, accountId, roles = [], limit = 500 }) => {
  const request = await ensureRequestTrackingAccess({
    serviceRequestId,
    accountId,
    roles,
  });

  const limitNumber = Math.min(Math.max(Number(limit) || 500, 1), 2000);

  const docs = await TripLocationSnapshot.find({ serviceRequestId })
    .sort({ createdAt: 1 })
    .limit(limitNumber);

  return {
    request,
    docs,
  };
};

module.exports = {
  ACTIVE_TRACKING_STATUSES,
  DEFAULT_TRACKING_SETTINGS,
  getTrackingSettings,
  normalizeCoordinates,
  updateDriverLiveLocation,
  ensureRequestTrackingAccess,
  getLatestDriverLocationForRequest,
  getRequestLocationHistory,
};
