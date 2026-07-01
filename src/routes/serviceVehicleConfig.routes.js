const express = require('express');
const { param } = require('express-validator');

const {
  getPublicServiceVehicleConfigs,
  getPublicServiceVehicleConfigById,
} = require('../controllers/serviceVehicleConfig.controller');

const validateRequest = require('../middlewares/validateRequest');

const router = express.Router();

router.get('/', getPublicServiceVehicleConfigs);

router.get(
  '/:id',
  [
    param('id')
      .isMongoId()
      .withMessage('رقم إعداد الخدمة والمركبة غير صحيح'),
  ],
  validateRequest,
  getPublicServiceVehicleConfigById
);

module.exports = router;
