const express = require('express');
const { body } = require('express-validator');

const {
  createRating,
  getMyGivenRatings,
  getMyReceivedRatings,
} = require('../controllers/rating.controller');

const validateRequest = require('../middlewares/validateRequest');
const { protect } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(protect);

router.post(
  '/',
  [
    body('serviceRequestId')
      .notEmpty()
      .withMessage('رقم الطلب مطلوب')
      .isMongoId()
      .withMessage('رقم الطلب غير صحيح'),

    body('stars')
      .notEmpty()
      .withMessage('عدد النجوم مطلوب')
      .isInt({ min: 1, max: 5 })
      .withMessage('التقييم يجب أن يكون من 1 إلى 5'),

    body('comment')
      .optional({ checkFalsy: true })
      .trim()
      .isLength({ max: 500 })
      .withMessage('التعليق طويل جدًا'),
  ],
  validateRequest,
  createRating
);

router.get('/given', getMyGivenRatings);

router.get('/received', getMyReceivedRatings);

module.exports = router;