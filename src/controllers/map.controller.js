const mapService = require('../services/map.service');

function sendMapSuccess(res, data) {
  return res.status(200).json({
    status: 'success',
    data,
  });
}

async function autocomplete(req, res, next) {
  try {
    const results = await mapService.autocompletePlaces({
      input: req.query.input,
      lat: req.query.lat,
      lng: req.query.lng,
      sessionToken: req.query.sessionToken,
    });

    return sendMapSuccess(res, { results });
  } catch (error) {
    return next(error);
  }
}

async function placeDetails(req, res, next) {
  try {
    const place = await mapService.getPlaceDetails({
      placeId: req.query.placeId,
      sessionToken: req.query.sessionToken,
    });

    return sendMapSuccess(res, { place });
  } catch (error) {
    return next(error);
  }
}

async function reverseGeocode(req, res, next) {
  try {
    const place = await mapService.reverseGeocode({
      lat: req.query.lat,
      lng: req.query.lng,
    });

    return sendMapSuccess(res, { place });
  } catch (error) {
    return next(error);
  }
}

async function route(req, res, next) {
  try {
    const routeResult = await mapService.computeRoute({
      origin: req.body.origin,
      destination: req.body.destination,
      vehicleTypeCode: req.body.vehicleTypeCode,
    });

    return sendMapSuccess(res, { route: routeResult });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  autocomplete,
  placeDetails,
  reverseGeocode,
  route,
};