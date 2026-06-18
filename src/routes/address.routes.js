const express = require('express');
const { body, param } = require('express-validator');

const {
  getAllAddresses,
  getAddressById,
  createAddress,
  updateAddress,
  deleteAddress,
} = require('../controllers/address.controller');

const validateRequest = require('../middlewares/validateRequest');
const { protect } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(protect);

router.get(
  '/all/:accountId',
  [
    param('accountId')
      .isMongoId()
      .withMessage('رقم الحساب غير صحيح'),
  ],
  validateRequest,
  getAllAddresses
);

router.get(
  '/:id',
  [
    param('id')
      .isMongoId()
      .withMessage('رقم العنوان غير صحيح'),
  ],
  validateRequest,
  getAddressById
);

router.post(
  '/',
  [
    body('name')
      .trim()
      .notEmpty()
      .withMessage('اسم العنوان مطلوب')
      .isLength({ min: 2 })
      .withMessage('اسم العنوان قصير جدًا'),

    body('type')
      .optional({ checkFalsy: true })
      .isIn(['home', 'work', 'last_destination', 'custom'])
      .withMessage('نوع العنوان غير صحيح'),

    body('address')
      .trim()
      .notEmpty()
      .withMessage('وصف العنوان مطلوب')
      .isLength({ min: 3 })
      .withMessage('وصف العنوان قصير جدًا'),

    body('notes')
      .optional({ checkFalsy: true })
      .trim()
      .isLength({ max: 300 })
      .withMessage('ملاحظات العنوان طويلة جدًا'),

    body('lng')
      .notEmpty()
      .withMessage('خط الطول مطلوب')
      .isFloat({ min: -180, max: 180 })
      .withMessage('خط الطول غير صحيح'),

    body('lat')
      .notEmpty()
      .withMessage('خط العرض مطلوب')
      .isFloat({ min: -90, max: 90 })
      .withMessage('خط العرض غير صحيح'),

    body('order')
      .optional({ checkFalsy: true })
      .isInt({ min: 0 })
      .withMessage('ترتيب العنوان غير صحيح'),
  ],
  validateRequest,
  createAddress
);

router.put(
  '/:id',
  [
    param('id')
      .isMongoId()
      .withMessage('رقم العنوان غير صحيح'),

    body('name')
      .optional({ checkFalsy: true })
      .trim()
      .isLength({ min: 2 })
      .withMessage('اسم العنوان قصير جدًا'),

    body('type')
      .optional({ checkFalsy: true })
      .isIn(['home', 'work', 'last_destination', 'custom'])
      .withMessage('نوع العنوان غير صحيح'),

    body('address')
      .optional({ checkFalsy: true })
      .trim()
      .isLength({ min: 3 })
      .withMessage('وصف العنوان قصير جدًا'),

    body('notes')
      .optional({ checkFalsy: true })
      .trim()
      .isLength({ max: 300 })
      .withMessage('ملاحظات العنوان طويلة جدًا'),

    body('lng')
      .optional()
      .isFloat({ min: -180, max: 180 })
      .withMessage('خط الطول غير صحيح'),

    body('lat')
      .optional()
      .isFloat({ min: -90, max: 90 })
      .withMessage('خط العرض غير صحيح'),

    body('order')
      .optional({ checkFalsy: true })
      .isInt({ min: 0 })
      .withMessage('ترتيب العنوان غير صحيح'),

    body('isActive')
      .optional()
      .isBoolean()
      .withMessage('حالة العنوان غير صحيحة'),
  ],
  validateRequest,
  updateAddress
);

router.delete(
  '/:id',
  [
    param('id')
      .isMongoId()
      .withMessage('رقم العنوان غير صحيح'),
  ],
  validateRequest,
  deleteAddress
);

module.exports = router;