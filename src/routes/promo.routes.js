const express = require('express');
const { body } = require('express-validator');

const validateRequest = require('../middlewares/validateRequest');
const { protect } = require('../middlewares/authMiddleware');
const {
  getAvailablePromos,
  validateCustomerPromo,
  validateDriverPromo,
} = require('../controllers/promo.controller');

const router = express.Router();

router.use(protect);

router.get('/', getAvailablePromos);

router.post(
  '/customer/validate',
  [
    body('code').trim().notEmpty().withMessage('كود الكوبون مطلوب'),
    body('serviceType')
      .isIn(['instant_ride', 'scheduled_ride', 'delivery_order'])
      .withMessage('نوع الخدمة غير صحيح'),
    body('vehicleTypeCode').trim().notEmpty().withMessage('نوع المركبة مطلوب'),
    body('amount').isFloat({ min: 1 }).withMessage('قيمة الطلب غير صحيحة'),
  ],
  validateRequest,
  validateCustomerPromo
);

router.post(
  '/driver/validate',
  [
    body('code').trim().notEmpty().withMessage('كود الكوبون مطلوب'),
    body('serviceType')
      .isIn(['instant_ride', 'scheduled_ride', 'delivery_order'])
      .withMessage('نوع الخدمة غير صحيح'),
    body('vehicleTypeCode').trim().notEmpty().withMessage('نوع المركبة مطلوب'),
    body('amount').isFloat({ min: 0 }).withMessage('قيمة العمولة غير صحيحة'),
  ],
  validateRequest,
  validateDriverPromo
);

module.exports = router;
