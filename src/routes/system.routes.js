const express = require('express');

const {
  getSystemHealth,
  getSystemReadiness,
} = require('../controllers/system.controller');

const router = express.Router();

router.get('/health', getSystemHealth);
router.get('/readiness', getSystemReadiness);

module.exports = router;
