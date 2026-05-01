const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const requireRole = require('../middleware/roleMiddleware');
const { getDashboardStats } = require('../controllers/dashboardController');

const router = express.Router();

router.get(
  '/stats',
  authMiddleware,
  requireRole('admin', 'sales', 'viewer'),
  getDashboardStats
);

module.exports = router;