const express = require('express');

const {
  getLiveSummary,
  getLiveDrivers,
  getLiveRequests,
  getLiveTrips,
  getLiveIssues,
  getLiveMap,
} = require('../controllers/adminLive.controller');
const { protect, allowRoles } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(protect, allowRoles('admin'));

router.get('/summary', getLiveSummary);
router.get('/drivers', getLiveDrivers);
router.get('/requests', getLiveRequests);
router.get('/trips', getLiveTrips);
router.get('/issues', getLiveIssues);
router.get('/map', getLiveMap);

module.exports = router;
