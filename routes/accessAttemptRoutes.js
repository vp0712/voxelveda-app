const express = require('express');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const { getAccessAttempts } = require('../controllers/accessAttemptController');

const router = express.Router();

router.get('/', requireAnyPermission('VIEW_AUDIT_LOG'), getAccessAttempts);

module.exports = router;
