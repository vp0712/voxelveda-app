const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const { getDashboardStats } = require('../controllers/dashboardController');

const router = express.Router();

router.get(
  '/stats',
  authMiddleware,
  requireAnyPermission('VIEW_DASHBOARD'),
  getDashboardStats
);

module.exports = router;
