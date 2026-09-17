const express = require('express');
const controller = require('../controllers/readinessController');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const { rateLimit } = require('../middleware/securityMiddleware');

const router = express.Router();
const readinessLimit = rateLimit({ windowMs: 60 * 1000, max: 60, keyPrefix: 'readiness-detail' });
const recoveryLimit = rateLimit({ windowMs: 60 * 1000, max: 20, keyPrefix: 'recovery-assurance' });
const securityAccess = requireAnyPermission('MANAGE_SECURITY', 'VIEW_SECURITY_GOVERNANCE');

router.get('/', securityAccess, readinessLimit, controller.details);
router.get('/recovery', securityAccess, recoveryLimit, controller.recovery);
router.get('/recovery/drill', securityAccess, recoveryLimit, controller.recoveryDrill);

module.exports = router;
