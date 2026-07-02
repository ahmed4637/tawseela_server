const express = require('express');
const { param } = require('express-validator');

const {
  getOfferNegotiations,
} = require('../controllers/serviceRequest.controller');
const validateRequest = require('../middlewares/validateRequest');
const { protect } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(protect);

router.get(
  '/:offerId/negotiations',
  [
    param('offerId')
      .isMongoId()
      .withMessage('رقم العرض غير صحيح'),
  ],
  validateRequest,
  getOfferNegotiations,
);

module.exports = router;
