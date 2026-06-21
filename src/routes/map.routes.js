const express = require('express');

const mapController = require('../controllers/map.controller');

const router = express.Router();

router.get('/autocomplete', mapController.autocomplete);
router.get('/place-details', mapController.placeDetails);
router.get('/reverse-geocode', mapController.reverseGeocode);
router.post('/route', mapController.route);

module.exports = router;