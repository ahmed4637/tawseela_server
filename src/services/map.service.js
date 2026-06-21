const GOOGLE_MAPS_SERVER_KEY = process.env.GOOGLE_MAPS_SERVER_KEY;
const MAPS_COUNTRY_CODE = process.env.MAPS_COUNTRY_CODE || 'EG';

function createHttpError(message, statusCode = 400, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;

  if (details) {
    error.details = details;
  }

  return error;
}

function ensureGoogleKey() {
  if (!GOOGLE_MAPS_SERVER_KEY || !GOOGLE_MAPS_SERVER_KEY.trim()) {
    throw createHttpError('مفتاح Google Maps غير موجود على السيرفر', 500);
  }
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function assertLatLng(point, label) {
  const lat = toNumber(point?.lat);
  const lng = toNumber(point?.lng);

  if (lat === null || lng === null) {
    throw createHttpError(`${label} غير صحيح`, 400);
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw createHttpError(`${label} خارج النطاق الصحيح`, 400);
  }

  return { lat, lng };
}

function parseGoogleDurationToMinutes(duration) {
  if (!duration || typeof duration !== 'string') return 0;

  const seconds = Number(duration.replace('s', ''));

  if (!Number.isFinite(seconds)) return 0;

  return Math.ceil(seconds / 60);
}

function roundFare(value) {
  return Math.ceil(value / 5) * 5;
}

function calculateFare({ distanceKm, durationMinutes, vehicleTypeCode }) {
  const code = String(vehicleTypeCode || '').toLowerCase();

  let baseFare = 25;
  let perKm = 7;
  let perMinute = 0.8;
  let minimumFare = 30;

  if (code.includes('tuktuk')) {
    baseFare = 15;
    perKm = 5;
    perMinute = 0.5;
    minimumFare = 20;
  } else if (code.includes('motorcycle')) {
    baseFare = 20;
    perKm = 5.5;
    perMinute = 0.5;
    minimumFare = 25;
  } else if (code.includes('tricycle')) {
    baseFare = 25;
    perKm = 6;
    perMinute = 0.6;
    minimumFare = 30;
  } else if (code.includes('private_car') || code.includes('car')) {
    baseFare = 35;
    perKm = 8;
    perMinute = 1;
    minimumFare = 40;
  } else if (code.includes('eight')) {
    baseFare = 45;
    perKm = 9;
    perMinute = 1.1;
    minimumFare = 55;
  } else if (code.includes('microbus')) {
    baseFare = 80;
    perKm = 12;
    perMinute = 1.5;
    minimumFare = 100;
  } else if (code.includes('quarter')) {
    baseFare = 120;
    perKm = 16;
    perMinute = 2;
    minimumFare = 150;
  } else if (code.includes('half')) {
    baseFare = 200;
    perKm = 22;
    perMinute = 2.5;
    minimumFare = 250;
  }

  const fare = baseFare + distanceKm * perKm + durationMinutes * perMinute;

  return Math.max(minimumFare, roundFare(fare));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.error_message ||
      data?.message ||
      'Google Maps request failed';

    throw createHttpError(message, response.status, data);
  }

  return data;
}

async function autocompletePlaces({ input, lat, lng, sessionToken }) {
  ensureGoogleKey();

  const cleanInput = String(input || '').trim();

  if (cleanInput.length < 2) {
    return [];
  }

  const body = {
    input: cleanInput,
    languageCode: 'ar',
    regionCode: MAPS_COUNTRY_CODE,
    includedRegionCodes: [MAPS_COUNTRY_CODE],
  };

  const cleanLat = toNumber(lat);
  const cleanLng = toNumber(lng);

  if (cleanLat !== null && cleanLng !== null) {
    body.locationBias = {
      circle: {
        center: {
          latitude: cleanLat,
          longitude: cleanLng,
        },
        radius: 50000,
      },
    };
  }

  if (sessionToken) {
    body.sessionToken = String(sessionToken);
  }

  const data = await fetchJson(
    'https://places.googleapis.com/v1/places:autocomplete',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_SERVER_KEY,
      },
      body: JSON.stringify(body),
    }
  );

  const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];

  return suggestions
    .map((item) => {
      const prediction = item.placePrediction;

      if (!prediction) return null;

      return {
        placeId: prediction.placeId,
        fullText: prediction.text?.text || '',
        mainText:
          prediction.structuredFormat?.mainText?.text ||
          prediction.text?.text ||
          '',
        secondaryText:
          prediction.structuredFormat?.secondaryText?.text || '',
      };
    })
    .filter(Boolean);
}

async function getPlaceDetails({ placeId, sessionToken }) {
  ensureGoogleKey();

  const cleanPlaceId = String(placeId || '').trim();

  if (!cleanPlaceId) {
    throw createHttpError('رقم المكان غير موجود', 400);
  }

  const url = new URL(`https://places.googleapis.com/v1/places/${cleanPlaceId}`);

  url.searchParams.set('languageCode', 'ar');
  url.searchParams.set('regionCode', MAPS_COUNTRY_CODE);

  if (sessionToken) {
    url.searchParams.set('sessionToken', String(sessionToken));
  }

  const data = await fetchJson(url.toString(), {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key': GOOGLE_MAPS_SERVER_KEY,
      'X-Goog-FieldMask':
        'id,displayName,formattedAddress,location,shortFormattedAddress',
    },
  });

  return {
    placeId: data.id || cleanPlaceId,
    name: data.displayName?.text || '',
    address: data.formattedAddress || data.shortFormattedAddress || '',
    latitude: data.location?.latitude,
    longitude: data.location?.longitude,
  };
}

async function reverseGeocode({ lat, lng }) {
  ensureGoogleKey();

  const point = assertLatLng({ lat, lng }, 'الإحداثيات');

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');

  url.searchParams.set('latlng', `${point.lat},${point.lng}`);
  url.searchParams.set('language', 'ar');
  url.searchParams.set('region', MAPS_COUNTRY_CODE.toLowerCase());
  url.searchParams.set('key', GOOGLE_MAPS_SERVER_KEY);

  const data = await fetchJson(url.toString());

  const first = Array.isArray(data.results) ? data.results[0] : null;

  return {
    address:
      first?.formatted_address ||
      `موقع محدد على الخريطة ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`,
    latitude: point.lat,
    longitude: point.lng,
    placeId: first?.place_id || '',
  };
}

async function computeRoute({ origin, destination, vehicleTypeCode }) {
  ensureGoogleKey();

  const start = assertLatLng(origin, 'نقطة الانطلاق');
  const end = assertLatLng(destination, 'نقطة الوصول');

  const body = {
    origin: {
      location: {
        latLng: {
          latitude: start.lat,
          longitude: start.lng,
        },
      },
    },
    destination: {
      location: {
        latLng: {
          latitude: end.lat,
          longitude: end.lng,
        },
      },
    },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
    computeAlternativeRoutes: false,
    languageCode: 'ar',
    regionCode: MAPS_COUNTRY_CODE,
    units: 'METRIC',
    polylineQuality: 'HIGH_QUALITY',
    polylineEncoding: 'ENCODED_POLYLINE',
  };

  const data = await fetchJson(
    'https://routes.googleapis.com/directions/v2:computeRoutes',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_SERVER_KEY,
        'X-Goog-FieldMask':
          'routes.distanceMeters,routes.duration,routes.staticDuration,routes.polyline.encodedPolyline,routes.viewport',
      },
      body: JSON.stringify(body),
    }
  );

  const route = Array.isArray(data.routes) ? data.routes[0] : null;

  if (!route) {
    throw createHttpError('لم يتم العثور على مسار مناسب', 404);
  }

  const distanceMeters = route.distanceMeters || 0;
  const distanceKm = Number((distanceMeters / 1000).toFixed(2));
  const durationMinutes = parseGoogleDurationToMinutes(route.duration);
  const staticDurationMinutes = parseGoogleDurationToMinutes(
    route.staticDuration
  );

  const estimatedPrice = calculateFare({
    distanceKm,
    durationMinutes,
    vehicleTypeCode,
  });

  return {
    distanceMeters,
    distanceKm,
    durationMinutes,
    staticDurationMinutes,
    estimatedPrice,
    encodedPolyline: route.polyline?.encodedPolyline || '',
    viewport: route.viewport || null,
  };
}

module.exports = {
  autocompletePlaces,
  getPlaceDetails,
  reverseGeocode,
  computeRoute,
};