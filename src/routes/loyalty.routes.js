const express = require('express');

const { protect } = require('../middlewares/authMiddleware');
const {
  getMyLoyalty,
  getMyLoyaltyTransactions,
  ensureLoyaltyAccountForCurrentUser,
} = require('../controllers/loyalty.controller');

const router = express.Router();

router.use(protect);

router.get('/me', getMyLoyalty);
router.post('/me/ensure', ensureLoyaltyAccountForCurrentUser);
router.get('/transactions', getMyLoyaltyTransactions);

module.exports = router;
