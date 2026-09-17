const express = require('express');
const controller = require('../controllers/readinessController');
const evidenceController = require('../controllers/recoveryDrillEvidenceController');
const governanceController = require('../controllers/recoveryDrillGovernanceController');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const { rateLimit } = require('../middleware/securityMiddleware');

const router = express.Router();
const readinessLimit = rateLimit({ windowMs: 60 * 1000, max: 60, keyPrefix: 'readiness-detail' });
const recoveryLimit = rateLimit({ windowMs: 60 * 1000, max: 20, keyPrefix: 'recovery-assurance' });
const recoveryWriteLimit = rateLimit({ windowMs: 60 * 1000, max: 12, keyPrefix: 'recovery-evidence-write' });
const securityAccess = requireAnyPermission('MANAGE_SECURITY', 'VIEW_SECURITY_GOVERNANCE');
const securityWriteAccess = requireAnyPermission('MANAGE_SECURITY');

router.get('/', securityAccess, readinessLimit, controller.details);
router.get('/recovery', securityAccess, recoveryLimit, controller.recovery);
router.get('/recovery/drill', securityAccess, recoveryLimit, controller.recoveryDrill);
router.get('/recovery/drills', securityAccess, recoveryLimit, evidenceController.list);
router.get('/recovery/drills/governance', securityAccess, recoveryLimit, governanceController.status);
router.get('/recovery/drills/:id/history', securityAccess, recoveryLimit, evidenceController.history);
router.post('/recovery/drills', securityWriteAccess, recoveryWriteLimit, evidenceController.create);
router.put('/recovery/drills/:id', securityWriteAccess, recoveryWriteLimit, evidenceController.update);
router.post('/recovery/drills/:id/finalize', securityWriteAccess, recoveryWriteLimit, evidenceController.finalize);

module.exports = router;
