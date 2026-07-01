const express = require('express');

const {
  getOverviewReport,
  getTripsReport,
  getRevenueReport,
  getCommissionReport,
  getDriversReport,
  getCustomersReport,
  getPromosReport,
  getLoyaltyReport,
  getCancellationsReport,
  getComplaintsReport,
  getSupportReport,
  getAnyReport,
  exportReport,
} = require('../controllers/adminReport.controller');
const { protect, allowRoles } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(protect, allowRoles('admin'));

router.get('/overview', getOverviewReport);
router.get('/trips', getTripsReport);
router.get('/revenue', getRevenueReport);
router.get('/commissions', getCommissionReport);
router.get('/drivers', getDriversReport);
router.get('/customers', getCustomersReport);
router.get('/promos', getPromosReport);
router.get('/loyalty', getLoyaltyReport);
router.get('/cancellations', getCancellationsReport);
router.get('/complaints', getComplaintsReport);
router.get('/support', getSupportReport);
router.get('/export/:reportKey', exportReport);
router.get('/:reportKey', getAnyReport);

module.exports = router;
