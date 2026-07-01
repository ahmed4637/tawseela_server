const express = require('express');
const { param } = require('express-validator');

const {
  getPublicServiceTypes,
  getPublicServiceTypeByIdOrKey,
} = require('../controllers/serviceType.controller');

const validateRequest = require('../middlewares/validateRequest');

const router = express.Router();

router.get('/', getPublicServiceTypes);

router.get(
  '/:idOrKey',
  [
    param('idOrKey')
      .trim()
      .notEmpty()
      .withMessage('رقم أو كود الخدمة مطلوب'),
  ],
  validateRequest,
  getPublicServiceTypeByIdOrKey
);

module.exports = router;
