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

function getAddressComponent(result, types) {
  const components = Array.isArray(result?.address_components)
    ? result.address_components
    : [];

  const match = components.find((component) => {
    const componentTypes = Array.isArray(component.types) ? component.types : [];
    return types.some((type) => componentTypes.includes(type));
  });

  return match?.long_name || match?.short_name || '';
}

function getAddressComponentFromResults(results, types) {
  for (const result of results) {
    const value = getAddressComponent(result, types);
    if (value) return value;
  }

  return '';
}

function hasAnyType(result, types) {
  const resultTypes = Array.isArray(result?.types) ? result.types : [];
  return types.some((type) => resultTypes.includes(type));
}

function scoreReverseGeocodeResult(result) {
  let score = 0;

  if (hasAnyType(result, ['street_address', 'premise', 'subpremise'])) score += 120;
  if (hasAnyType(result, ['point_of_interest', 'establishment'])) score += 95;
  if (hasAnyType(result, ['route', 'intersection'])) score += 80;
  if (
    hasAnyType(result, [
      'neighborhood',
      'sublocality',
      'sublocality_level_1',
      'sublocality_level_2',
      'sublocality_level_3',
      'administrative_area_level_3',
    ])
  ) {
    score += 65;
  }
  if (hasAnyType(result, ['locality', 'postal_town'])) score += 15;
  if (hasAnyType(result, ['administrative_area_level_1', 'administrative_area_level_2', 'country'])) score -= 35;

  const formatted = String(result?.formatted_address || '');
  const commaParts = formatted.split(',').map((item) => item.trim()).filter(Boolean);

  score += Math.min(commaParts.length, 5) * 4;

  return score;
}

function buildDetailedAddress(result, point, rankedResults = []) {
  if (!result) {
    return {
      name: '',
      address: `موقع محدد على الخريطة ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`,
    };
  }

  const sources = [
    result,
    ...rankedResults.filter((item) => item && item !== result),
  ];
  const streetNumber = getAddressComponentFromResults(sources, ['street_number']);
  const route = getAddressComponentFromResults(sources, ['route']);
  const premise = getAddressComponentFromResults(sources, ['premise', 'subpremise']);
  const poi = getAddressComponentFromResults(sources, [
    'point_of_interest',
    'establishment',
  ]);
  const neighborhood = getAddressComponentFromResults(sources, [
    'neighborhood',
  ]);
  const sublocalityLevel3 = getAddressComponentFromResults(sources, [
    'sublocality_level_3',
  ]);
  const sublocalityLevel2 = getAddressComponentFromResults(sources, [
    'sublocality_level_2',
  ]);
  const sublocalityLevel1 = getAddressComponentFromResults(sources, [
    'sublocality_level_1',
    'sublocality',
  ]);
  const adminArea3 = getAddressComponentFromResults(sources, [
    'administrative_area_level_3',
  ]);
  const locality = getAddressComponentFromResults(sources, [
    'locality',
    'postal_town',
  ]);
  const area2 = getAddressComponentFromResults(sources, [
    'administrative_area_level_2',
  ]);

  const street = [streetNumber, route].filter(Boolean).join(' ');
  const detailedArea =
    neighborhood ||
    sublocalityLevel3 ||
    sublocalityLevel2 ||
    sublocalityLevel1 ||
    adminArea3;
  const name = poi || premise || street || detailedArea || locality || '';

  const parts = [
    poi || premise,
    street,
    neighborhood,
    sublocalityLevel3,
    sublocalityLevel2,
    sublocalityLevel1,
    adminArea3,
    locality,
    area2,
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index);

  let address = parts.join('، ');

  if (!address || parts.length < 2) {
    const formattedAddress = String(result.formatted_address || '').trim();
    if (formattedAddress && formattedAddress !== address) {
      address = [address, formattedAddress]
        .filter(Boolean)
        .join('، ');
    }
  }

  if (!address) {
    address = `موقع محدد على الخريطة ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
  }

  return { name, address };
}

async function reverseGeocode({ lat, lng }) {
  ensureGoogleKey();

  const point = assertLatLng({ lat, lng }, 'الإحداثيات');

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');

  url.searchParams.set('latlng', `${point.lat},${point.lng}`);
  url.searchParams.set('language', 'ar');
  url.searchParams.set('region', MAPS_COUNTRY_CODE.toLowerCase());
  url.searchParams.set('result_type', [
    'street_address',
    'premise',
    'point_of_interest',
    'establishment',
    'route',
    'intersection',
    'neighborhood',
    'sublocality',
    'sublocality_level_1',
    'sublocality_level_2',
    'sublocality_level_3',
    'administrative_area_level_3',
    'locality',
  ].join('|'));
  url.searchParams.set('key', GOOGLE_MAPS_SERVER_KEY);

  const data = await fetchJson(url.toString());

  const results = Array.isArray(data.results) ? data.results : [];
  const rankedResults = results
    .slice()
    .sort((a, b) => scoreReverseGeocodeResult(b) - scoreReverseGeocodeResult(a));
  const best = rankedResults[0];
  const detailed = buildDetailedAddress(best, point, rankedResults);

  return {
    name: detailed.name,
    address: detailed.address,
    latitude: point.lat,
    longitude: point.lng,
    placeId: best?.place_id || '',
    formattedAddress: best?.formatted_address || detailed.address,
  };
}

function buildRoutePayload({ distanceMeters, durationMinutes, staticDurationMinutes, encodedPolyline, viewport, vehicleTypeCode }) {
  const distanceKm = Number((distanceMeters / 1000).toFixed(2));

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
    encodedPolyline: encodedPolyline || '',
    viewport: viewport || null,
  };
}

function parseDirectionsDurationToMinutes(duration) {
  const seconds = Number(duration?.value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.ceil(seconds / 60);
}

async function computeRouteWithRoutesApi({ start, end, vehicleTypeCode }) {
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
    throw createHttpError('لم يتم العثور على مسار مناسب', 404, data);
  }

  const distanceMeters = Number(route.distanceMeters || 0);

  return buildRoutePayload({
    distanceMeters,
    durationMinutes: parseGoogleDurationToMinutes(route.duration),
    staticDurationMinutes: parseGoogleDurationToMinutes(route.staticDuration),
    encodedPolyline: route.polyline?.encodedPolyline || '',
    viewport: route.viewport || null,
    vehicleTypeCode,
  });
}

async function computeRouteWithDirectionsApi({ start, end, vehicleTypeCode }) {
  const url = new URL('https://maps.googleapis.com/maps/api/directions/json');

  url.searchParams.set('origin', `${start.lat},${start.lng}`);
  url.searchParams.set('destination', `${end.lat},${end.lng}`);
  url.searchParams.set('mode', 'driving');
  url.searchParams.set('language', 'ar');
  url.searchParams.set('region', MAPS_COUNTRY_CODE.toLowerCase());
  url.searchParams.set('alternatives', 'false');
  url.searchParams.set('departure_time', 'now');
  url.searchParams.set('key', GOOGLE_MAPS_SERVER_KEY);

  const data = await fetchJson(url.toString());

  if (data.status !== 'OK') {
    const message = data.error_message || data.status || 'تعذر حساب المسار من Google';
    throw createHttpError(message, 502, data);
  }

  const route = Array.isArray(data.routes) ? data.routes[0] : null;
  const leg = route && Array.isArray(route.legs) ? route.legs[0] : null;

  if (!route || !leg) {
    throw createHttpError('لم يتم العثور على مسار مناسب', 404, data);
  }

  const distanceMeters = Number(leg.distance?.value || 0);
  const durationMinutes = parseDirectionsDurationToMinutes(
    leg.duration_in_traffic || leg.duration
  );
  const staticDurationMinutes = parseDirectionsDurationToMinutes(leg.duration);

  return buildRoutePayload({
    distanceMeters,
    durationMinutes,
    staticDurationMinutes,
    encodedPolyline: route.overview_polyline?.points || '',
    viewport: route.bounds || null,
    vehicleTypeCode,
  });
}

async function computeRoute({ origin, destination, vehicleTypeCode }) {
  ensureGoogleKey();

  const start = assertLatLng(origin, 'نقطة الانطلاق');
  const end = assertLatLng(destination, 'نقطة الوصول');

  try {
    return await computeRouteWithRoutesApi({ start, end, vehicleTypeCode });
  } catch (routesError) {
    try {
      return await computeRouteWithDirectionsApi({ start, end, vehicleTypeCode });
    } catch (directionsError) {
      console.warn('Google route calculation failed', {
        routesStatus: routesError.statusCode,
        routesMessage: routesError.message,
        directionsStatus: directionsError.statusCode,
        directionsMessage: directionsError.message,
      });

      throw createHttpError(
        'تعذر حساب المسار حاليًا، تأكد من إعدادات خرائط Google وحاول مرة أخرى',
        directionsError.statusCode || routesError.statusCode || 502,
        {
          routes: routesError.details || routesError.message,
          directions: directionsError.details || directionsError.message,
        }
      );
    }
  }
}

module.exports = {
  autocompletePlaces,
  getPlaceDetails,
  reverseGeocode,
  computeRoute,
};