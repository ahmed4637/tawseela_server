const DriverProfile = require('../models/driverProfile.model');
const TripLocationSnapshot = require('../models/tripLocationSnapshot.model');
const { getTrackingSettings } = require('./appSettings.service');

const toRadians = (degrees) => (degrees * Math.PI) / 180;

const getDistanceMeters = (first, second) => {
  const lat1 = Number(first?.lat);
  const lng1 = Number(first?.lng);
  const lat2 = Number(second?.lat);
  const lng2 = Number(second?.lng);

  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) {
    return Infinity;
  }

  const earthRadiusMeters = 6371000;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(deltaLng / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const toFiniteNumber = (value, { min = -Infinity, max = Infinity } = {}) => {
  if (value === undefined || value === null || value === '') return null;

  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;

  return number;
};

const normalizeTimestamp = (value) => {
  if (value === undefined || value === null || value === '') return null;

  const numeric = Number(value);
  const parsed = Number.isFinite(numeric)
    ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
    : new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const resolvePickupCoordinates = (request) => {
  const lat = toFiniteNumber(request?.pickup?.lat, { min: -90, max: 90 });
  const lng = toFiniteNumber(request?.pickup?.lng, { min: -180, max: 180 });

  if (lat !== null && lng !== null) {
    return { lat, lng };
  }

  const coordinates = request?.pickupLocation?.coordinates;
  if (Array.isArray(coordinates) && coordinates.length >= 2) {
    const geoLng = toFiniteNumber(coordinates[0], { min: -180, max: 180 });
    const geoLat = toFiniteNumber(coordinates[1], { min: -90, max: 90 });

    if (geoLat !== null && geoLng !== null) {
      return { lat: geoLat, lng: geoLng };
    }
  }

  const error = new Error('موقع نقطة الاستلام غير متاح لهذا الطلب');
  error.statusCode = 409;
  throw error;
};

const readProvidedLocation = (body = {}) => {
  const lat = toFiniteNumber(
    body.driverLat ?? body.lat ?? body.latitude,
    { min: -90, max: 90 },
  );
  const lng = toFiniteNumber(
    body.driverLng ?? body.lng ?? body.longitude,
    { min: -180, max: 180 },
  );

  if (lat === null || lng === null) return null;

  return {
    lat,
    lng,
    accuracy: toFiniteNumber(
      body.driverAccuracy ?? body.accuracy,
      { min: 0 },
    ),
    timestamp:
      normalizeTimestamp(
        body.driverLocationTimestamp ?? body.locationTimestamp ?? body.timestamp,
      ) || new Date(),
    source: 'status_request',
  };
};

const readProfileLocation = (profile) => {
  const lat = toFiniteNumber(profile?.currentLat, { min: -90, max: 90 });
  const lng = toFiniteNumber(profile?.currentLng, { min: -180, max: 180 });
  const timestamp = normalizeTimestamp(profile?.currentLocationUpdatedAt);

  if (lat === null || lng === null || !timestamp) return null;

  return {
    lat,
    lng,
    accuracy: toFiniteNumber(profile?.currentLocationAccuracy, { min: 0 }),
    timestamp,
    source: 'driver_profile',
  };
};

const readSnapshotLocation = (snapshot) => {
  const lat = toFiniteNumber(snapshot?.lat, { min: -90, max: 90 });
  const lng = toFiniteNumber(snapshot?.lng, { min: -180, max: 180 });
  const timestamp = normalizeTimestamp(snapshot?.createdAt);

  if (lat === null || lng === null || !timestamp) return null;

  return {
    lat,
    lng,
    accuracy: toFiniteNumber(snapshot?.accuracy, { min: 0 }),
    timestamp,
    source: 'trip_snapshot',
  };
};

const chooseLatestLocation = (locations) => {
  return locations
    .filter(Boolean)
    .sort((first, second) => second.timestamp.getTime() - first.timestamp.getTime())[0] || null;
};

const formatDistance = (distanceMeters) => {
  const rounded = Math.max(Math.round(Number(distanceMeters) || 0), 0);
  if (rounded < 1000) return `${rounded} متر`;
  return `${(rounded / 1000).toFixed(1)} كم`;
};

const buildArrivalError = (message, details = {}) => {
  const error = new Error(message);
  error.statusCode = 409;
  error.arrivalDetails = details;
  return error;
};

const assertDriverAtPickup = async ({ request, accountId, body = {} }) => {
  if (!request?.acceptedDriverAccountId ||
      request.acceptedDriverAccountId.toString() !== accountId.toString()) {
    const error = new Error('السائق المقبول فقط يمكنه تسجيل الوصول');
    error.statusCode = 403;
    throw error;
  }

  const pickup = resolvePickupCoordinates(request);
  const provided = readProvidedLocation(body);

  const [settings, profile, snapshot] = await Promise.all([
    getTrackingSettings(),
    DriverProfile.findOne({ accountId })
      .select(
        'accountId activeServiceRequestId currentLat currentLng currentLocationUpdatedAt currentLocationAccuracy',
      )
      .lean(),
    TripLocationSnapshot.findOne({
      serviceRequestId: request._id,
      driverAccountId: accountId,
    })
      .sort({ createdAt: -1 })
      .select('lat lng accuracy createdAt')
      .lean(),
  ]);

  const location = chooseLatestLocation([
    provided,
    readProfileLocation(profile),
    readSnapshotLocation(snapshot),
  ]);

  if (!location) {
    throw buildArrivalError(
      'تعذر التحقق من موقعك الحالي. فعّل GPS وانتظر تحديث الموقع ثم حاول مرة أخرى',
    );
  }

  const now = Date.now();
  const locationTime = location.timestamp.getTime();
  const ageSeconds = Math.max((now - locationTime) / 1000, 0);
  const maxAgeSeconds = Math.max(
    Number(settings.staleLocationWarningSeconds || 30),
    5,
  );

  if (locationTime > now + 60 * 1000 || ageSeconds > maxAgeSeconds) {
    throw buildArrivalError(
      'موقعك الحالي قديم. انتظر تحديث GPS ثم حاول تسجيل الوصول مرة أخرى',
      {
        ageSeconds: Math.round(ageSeconds),
        maxAgeSeconds,
      },
    );
  }

  const accuracy = location.accuracy;
  const maxAccuracyMeters = Math.max(
    Number(settings.maxArrivalAccuracyMeters || 100),
    10,
  );

  if (accuracy !== null && accuracy > maxAccuracyMeters) {
    throw buildArrivalError(
      'دقة GPS غير كافية لتأكيد الوصول. تحرك لمكان مفتوح وانتظر ثواني ثم حاول مرة أخرى',
      {
        accuracyMeters: Math.round(accuracy),
        maxAccuracyMeters,
      },
    );
  }

  const baseRadius = Math.max(Number(settings.arrivalRadiusMeters || 80), 20);
  const maxEffectiveRadius = Math.max(
    Number(settings.maxArrivalEffectiveRadiusMeters || 120),
    baseRadius,
  );
  const accuracyAllowance = Math.min(Math.max(accuracy || 0, 0), 50);
  const allowedRadiusMeters = Math.min(
    baseRadius + accuracyAllowance,
    maxEffectiveRadius,
  );
  const distanceMeters = getDistanceMeters(location, pickup);

  if (!Number.isFinite(distanceMeters)) {
    throw buildArrivalError('تعذر حساب المسافة إلى نقطة الاستلام');
  }

  if (distanceMeters > allowedRadiusMeters) {
    throw buildArrivalError(
      `لا يمكن تسجيل الوصول الآن. أنت على بعد ${formatDistance(distanceMeters)} من نقطة الاستلام`,
      {
        distanceMeters: Math.round(distanceMeters),
        allowedRadiusMeters: Math.round(allowedRadiusMeters),
        accuracyMeters: accuracy === null ? null : Math.round(accuracy),
      },
    );
  }

  return {
    verifiedAt: new Date(),
    locationAt: location.timestamp,
    distanceMeters: Math.round(distanceMeters),
    allowedRadiusMeters: Math.round(allowedRadiusMeters),
    accuracyMeters: accuracy === null ? null : Math.round(accuracy),
    source: location.source,
    lat: location.lat,
    lng: location.lng,
  };
};

module.exports = {
  getDistanceMeters,
  resolvePickupCoordinates,
  assertDriverAtPickup,
};
