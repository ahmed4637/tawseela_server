const express = require('express');
const { body, param } = require('express-validator');

const {
  getAdminStats,

  getAllAccounts,
  getAccountDetails,
  activateAccount,
  deactivateAccount,
  getCustomers,
  getDrivers,

  getPendingDrivers,
  approveDriverProfile,
  rejectDriverProfile,

  getAllDriverVehicles,
  getPendingDriverVehicles,
  approveDriverVehicle,
  rejectDriverVehicle,

  getDriversWithDebts,
  getAllServiceRequestsForAdmin,
  getAllRatingsForAdmin,

  getFinanceSummary,
  getCommissionTransactionsForAdmin,
  getDriverPaymentsForAdmin,
} = require('../controllers/admin.controller');

const validateRequest = require('../middlewares/validateRequest');
const { protect, allowRoles } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(protect);
router.use(allowRoles('admin'));

router.get('/stats', getAdminStats);

router.get('/accounts', getAllAccounts);

router.get('/accounts/:accountId', [
  param('accountId')
    .isMongoId()
    .withMessage('رقم الحساب غير صحيح'),
], validateRequest, getAccountDetails);

router.patch('/accounts/:accountId/activate', [
  param('accountId')
    .isMongoId()
    .withMessage('رقم الحساب غير صحيح'),
], validateRequest, activateAccount);

router.patch('/accounts/:accountId/deactivate', [
  param('accountId')
    .isMongoId()
    .withMessage('رقم الحساب غير صحيح'),

  body('reason')
    .optional({ checkFalsy: true })
    .trim(),
], validateRequest, deactivateAccount);

router.get('/customers', getCustomers);

router.get('/drivers', getDrivers);

router.get('/drivers/pending', getPendingDrivers);

router.get('/drivers/debts', getDriversWithDebts);

router.patch('/drivers/:driverProfileId/approve', [
  param('driverProfileId')
    .isMongoId()
    .withMessage('رقم ملف السائق غير صحيح'),
], validateRequest, approveDriverProfile);

router.patch('/drivers/:driverProfileId/reject', [
  param('driverProfileId')
    .isMongoId()
    .withMessage('رقم ملف السائق غير صحيح'),

  body('rejectionReason')
    .optional({ checkFalsy: true })
    .trim(),
], validateRequest, rejectDriverProfile);

router.get('/driver-vehicles', getAllDriverVehicles);

router.get('/driver-vehicles/pending', getPendingDriverVehicles);

router.patch('/driver-vehicles/:driverVehicleId/approve', [
  param('driverVehicleId')
    .isMongoId()
    .withMessage('رقم مركبة السائق غير صحيح'),
], validateRequest, approveDriverVehicle);

router.patch('/driver-vehicles/:driverVehicleId/reject', [
  param('driverVehicleId')
    .isMongoId()
    .withMessage('رقم مركبة السائق غير صحيح'),

  body('rejectionReason')
    .optional({ checkFalsy: true })
    .trim(),
], validateRequest, rejectDriverVehicle);

router.get('/requests', getAllServiceRequestsForAdmin);

router.get('/ratings', getAllRatingsForAdmin);

router.get('/finance/summary', getFinanceSummary);

router.get('/finance/commissions', getCommissionTransactionsForAdmin);

router.get('/finance/payments', getDriverPaymentsForAdmin);

module.exports = router;