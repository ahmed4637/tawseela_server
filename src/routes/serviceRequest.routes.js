const express = require('express');
const { body, param } = require('express-validator');

const {
  createServiceRequest,
  getMyServiceRequests,
  getAvailableServiceRequestsForDriver,
  getServiceRequestById,
  createDriverOffer,
  createCustomerCounterOffer,
  acceptOffer,
  rejectOffer,
  acceptCustomerCounterOffer,
  rejectCustomerCounterOffer,
  updateServiceRequestStatus,
} = require('../controllers/serviceRequest.controller');

const validateRequest = require('../middlewares/validateRequest');
const { protect } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(protect);

router.post(
  '/',
  [
    body('serviceType')
      .trim()
      .notEmpty()
      .withMessage('نوع الخدمة مطلوب')
      .isIn(['instant_ride', 'scheduled_ride', 'delivery_order'])
      .withMessage('نوع الخدمة غير صحيح'),

    body('vehicleTypeCode')
      .trim()
      .notEmpty()
      .withMessage('كود نوع المركبة مطلوب'),

    body('vehicleTypeName')
      .optional({ checkFalsy: true })
      .trim(),

    body('vehicleTypeId')
      .optional({ checkFalsy: true })
      .isMongoId()
      .withMessage('نوع المركبة غير صحيح'),

    body('pickup.address')
      .trim()
      .notEmpty()
      .withMessage('عنوان الانطلاق مطلوب'),

    body('pickup.lat')
      .notEmpty()
      .withMessage('خط عرض الانطلاق مطلوب')
      .isFloat({ min: -90, max: 90 })
      .withMessage('خط عرض الانطلاق غير صحيح'),

    body('pickup.lng')
      .notEmpty()
      .withMessage('خط طول الانطلاق مطلوب')
      .isFloat({ min: -180, max: 180 })
      .withMessage('خط طول الانطلاق غير صحيح'),

    body('pickup.notes')
      .optional({ checkFalsy: true })
      .trim(),

    body('destination.address')
      .optional({ checkFalsy: true })
      .trim(),

    body('destination.lat')
      .optional({ nullable: true })
      .isFloat({ min: -90, max: 90 })
      .withMessage('خط عرض الوجهة غير صحيح'),

    body('destination.lng')
      .optional({ nullable: true })
      .isFloat({ min: -180, max: 180 })
      .withMessage('خط طول الوجهة غير صحيح'),

    body('destination.notes')
      .optional({ checkFalsy: true })
      .trim(),

    body('distanceKm')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('المسافة غير صحيحة'),

    body('customerOfferedPrice')
      .optional()
      .isFloat({ min: 1 })
      .withMessage('السعر المعروض من العميل غير صحيح'),


    body('scheduledAt')
      .optional({ checkFalsy: true })
      .isISO8601()
      .withMessage('وقت الحجز غير صحيح'),

    body('deliveryDetails.itemDescription')
      .optional({ checkFalsy: true })
      .trim(),

    body('deliveryDetails.driverWillPayForItems')
      .optional()
      .isBoolean()
      .withMessage('حالة دفع السائق غير صحيحة'),

    body('deliveryDetails.expectedItemCost')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('قيمة الطلب غير صحيحة'),

    body('deliveryDetails.paymentNotes')
      .optional({ checkFalsy: true })
      .trim(),
  ],
  validateRequest,
  createServiceRequest
);

router.get('/mine', getMyServiceRequests);

router.get('/available', getAvailableServiceRequestsForDriver);

router.get(
  '/:id',
  [
    param('id')
      .isMongoId()
      .withMessage('رقم الطلب غير صحيح'),
  ],
  validateRequest,
  getServiceRequestById
);

router.post(
  '/:id/offers',
  [
    param('id')
      .isMongoId()
      .withMessage('رقم الطلب غير صحيح'),

    body('driverVehicleId')
      .notEmpty()
      .withMessage('مركبة السائق مطلوبة')
      .isMongoId()
      .withMessage('رقم مركبة السائق غير صحيح'),

    body('offeredPrice')
      .notEmpty()
      .withMessage('السعر المعروض مطلوب')
      .isFloat({ min: 1 })
      .withMessage('السعر المعروض غير صحيح'),

    body('message')
      .optional({ checkFalsy: true })
      .trim()
      .isLength({ max: 500 })
      .withMessage('رسالة العرض طويلة جدًا'),
  ],
  validateRequest,
  createDriverOffer
);

router.post(
  '/:id/offers/:offerId/accept',
  [
    param('id')
      .isMongoId()
      .withMessage('رقم الطلب غير صحيح'),

    param('offerId')
      .isMongoId()
      .withMessage('رقم العرض غير صحيح'),
  ],
  validateRequest,
  acceptOffer
);

router.post(
  '/:id/offers/:offerId/reject',
  [
    param('id')
      .isMongoId()
      .withMessage('رقم الطلب غير صحيح'),

    param('offerId')
      .isMongoId()
      .withMessage('رقم العرض غير صحيح'),
  ],
  validateRequest,
  rejectOffer
);

router.post(
  '/:id/offers/:offerId/counter',
  [
    param('id')
      .isMongoId()
      .withMessage('رقم الطلب غير صحيح'),

    param('offerId')
      .isMongoId()
      .withMessage('رقم العرض غير صحيح'),

    body('offeredPrice')
      .notEmpty()
      .withMessage('السعر المضاد مطلوب')
      .isFloat({ min: 1 })
      .withMessage('السعر المضاد غير صحيح'),

    body('message')
      .optional({ checkFalsy: true })
      .trim()
      .isLength({ max: 500 })
      .withMessage('رسالة العرض طويلة جدًا'),
  ],
  validateRequest,
  createCustomerCounterOffer
);

router.post(
  '/:id/offers/:offerId/driver-accept',
  [
    param('id')
      .isMongoId()
      .withMessage('رقم الطلب غير صحيح'),

    param('offerId')
      .isMongoId()
      .withMessage('رقم العرض غير صحيح'),
  ],
  validateRequest,
  acceptCustomerCounterOffer
);

router.post(
  '/:id/offers/:offerId/driver-reject',
  [
    param('id')
      .isMongoId()
      .withMessage('رقم الطلب غير صحيح'),

    param('offerId')
      .isMongoId()
      .withMessage('رقم العرض غير صحيح'),
  ],
  validateRequest,
  rejectCustomerCounterOffer
);

router.patch(
  '/:id/status',
  [
    param('id')
      .isMongoId()
      .withMessage('رقم الطلب غير صحيح'),

    body('status')
      .trim()
      .notEmpty()
      .withMessage('حالة الطلب مطلوبة')
      .isIn([
        'driver_arriving',
        'arrived_to_pickup',
        'in_progress',
        'completed',
        'cancelled_by_customer',
        'cancelled_by_driver',
        'driver_no_show',
        'customer_no_show',
      ])
      .withMessage('حالة الطلب غير صحيحة'),

    body('cancellationReason')
      .optional({ checkFalsy: true })
      .trim(),
  ],
  validateRequest,
  updateServiceRequestStatus
);

module.exports = router;