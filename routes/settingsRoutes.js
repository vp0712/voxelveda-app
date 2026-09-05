const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const {
  getSettings,
  updateSettings
} = require('../controllers/settingsController');

const router = express.Router();

router.get('/', authMiddleware, requireAnyPermission('VIEW_DASHBOARD'), getSettings);
router.post('/', authMiddleware, requireAnyPermission('MANAGE_USERS'), updateSettings);

module.exports = router;
