const express = require('express');
const requireRole = require('../middleware/roleMiddleware');
const { getAccessAttempts } = require('../controllers/accessAttemptController');

const router = express.Router();

router.get('/', requireRole('admin'), getAccessAttempts);

module.exports = router;
