const express = require('express');

const { protect } = require('../middlewares/authMiddleware');
const {
  getMyActiveRestrictions,
} = require('../controllers/penalty.controller');

const router = express.Router();

router.use(protect);

router.get('/active', getMyActiveRestrictions);

module.exports = router;
