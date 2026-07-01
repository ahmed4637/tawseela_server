const express = require('express');
const { body, param, query } = require('express-validator');

const {
  listDriverProfilesForReview,
  listPendingDriverProfiles,
  getDriverProfileReviewDetails,
  approveDriverProfileForAdmin,
  rejectDriverProfileForAdmin,
  requestDriverProfileUpdateForAdmin,
  listDriverVehiclesForReview,
  listPendingDriverVehicles,
  getDriverVehicleReviewDetails,
  approveDriverVehicleForAdmin,
  rejectDriverVehicleForAdmin,
  requestDriverVehicleUpdateForAdmin,
  listDriverReviewLogs,
} = require('../controllers/adminDriverReview.controller');
const validateRequest = require('../middlewares/validateRequest');
const { protect, allowRoles } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(protect);
router.use(allowRoles('admin'));

const idParam = (name, message) => param(name).isMongoId().withMessage(message);
const optionalReason = body('reason').optional({ checkFalsy: true }).trim();
const optionalRejectionReason = body('rejectionReason').optional({ checkFalsy: true }).trim();

router.get(
  '/drivers',
  [
    query('reviewStatus')
      .optional({ checkFalsy: true })
      .isIn(['pending', 'approved', 'rejected', 'needs_update'])
      .withMessage('حالة المراجعة غير صحيحة'),
    query('accountId').optional({ checkFalsy: true }).isMongoId().withMessage('رقم الحساب غير صحيح'),
  ],
  validateRequest,
  listDriverProfilesForReview
);

router.get('/drivers/pending', listPendingDriverProfiles);

router.get(
  '/drivers/:driverProfileId',
  [idParam('driverProfileId', 'رقم ملف السائق غير صحيح')],
  validateRequest,
  getDriverProfileReviewDetails
);

router.patch(
  '/drivers/:driverProfileId/approve',
  [idParam('driverProfileId', 'رقم ملف السائق غير صحيح'), optionalReason],
  validateRequest,
  approveDriverProfileForAdmin
);

router.patch(
  '/drivers/:driverProfileId/reject',
  [idParam('driverProfileId', 'رقم ملف السائق غير صحيح'), optionalReason, optionalRejectionReason],
  validateRequest,
  rejectDriverProfileForAdmin
);

router.patch(
  '/drivers/:driverProfileId/request-update',
  [idParam('driverProfileId', 'رقم ملف السائق غير صحيح'), optionalReason, optionalRejectionReason],
  validateRequest,
  requestDriverProfileUpdateForAdmin
);

router.get(
  '/vehicles',
  [
    query('reviewStatus')
      .optional({ checkFalsy: true })
      .isIn(['pending', 'approved', 'rejected', 'needs_update'])
      .withMessage('حالة المراجعة غير صحيحة'),
    query('accountId').optional({ checkFalsy: true }).isMongoId().withMessage('رقم الحساب غير صحيح'),
  ],
  validateRequest,
  listDriverVehiclesForReview
);

router.get('/vehicles/pending', listPendingDriverVehicles);

router.get(
  '/vehicles/:driverVehicleId',
  [idParam('driverVehicleId', 'رقم مركبة السائق غير صحيح')],
  validateRequest,
  getDriverVehicleReviewDetails
);

router.patch(
  '/vehicles/:driverVehicleId/approve',
  [idParam('driverVehicleId', 'رقم مركبة السائق غير صحيح'), optionalReason],
  validateRequest,
  approveDriverVehicleForAdmin
);

router.patch(
  '/vehicles/:driverVehicleId/reject',
  [idParam('driverVehicleId', 'رقم مركبة السائق غير صحيح'), optionalReason, optionalRejectionReason],
  validateRequest,
  rejectDriverVehicleForAdmin
);

router.patch(
  '/vehicles/:driverVehicleId/request-update',
  [idParam('driverVehicleId', 'رقم مركبة السائق غير صحيح'), optionalReason, optionalRejectionReason],
  validateRequest,
  requestDriverVehicleUpdateForAdmin
);

router.get('/logs', listDriverReviewLogs);

module.exports = router;
