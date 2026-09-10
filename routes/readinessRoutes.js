const express = require('express');
const controller = require('../controllers/readinessController');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const { rateLimit } = require('../middleware/securityMiddleware');

const router = express.Router();
const readinessLimit = rateLimit({ windowMs: 60 * 1000, max: 60, keyPrefix: 'readiness-detail' });

router.get('/', requireAnyPermission('MANAGE_SECURITY', 'VIEW_SECURITY_GOVERNANCE'), readinessLimit, controller.details);

module.exports = router;
