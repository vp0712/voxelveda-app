const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const requireRole = require('../middleware/roleMiddleware');
const {
  getSettings,
  updateSettings
} = require('../controllers/settingsController');

const router = express.Router();

router.get('/', authMiddleware, requireRole('admin', 'sales'), getSettings);
router.post('/', authMiddleware, requireRole('admin'), updateSettings);

module.exports = router;
