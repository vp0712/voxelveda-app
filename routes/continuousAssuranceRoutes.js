const express = require('express');
const controller = require('../controllers/continuousAssuranceController');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const requireStepUp = require('../middleware/stepUpMiddleware');
const { rateLimit } = require('../middleware/securityMiddleware');

const router = express.Router();
const readLimit = rateLimit({ windowMs: 60000, max: 120, keyPrefix: 'assurance-read' });
const actionLimit = rateLimit({ windowMs: 60000, max: 15, keyPrefix: 'assurance-action' });
const read = [requireAnyPermission('MANAGE_CONTINUOUS_ASSURANCE'), readLimit];
const action = (name) => [requireAnyPermission('MANAGE_CONTINUOUS_ASSURANCE'), actionLimit, requireStepUp(name)];

router.get('/summary', ...read, controller.summary);
router.get('/catalog', ...read, controller.catalog);
router.post('/audit-integrity/seal', ...action('SEAL_AUDIT_INTEGRITY'), controller.sealAudit);
router.post('/jit-access', ...action('REQUEST_TEMPORARY_PRIVILEGE'), controller.requestJit);
router.post('/jit-access/:id/approve', ...action('APPROVE_TEMPORARY_PRIVILEGE'), controller.approveJit);
router.post('/access-reviews', ...action('CREATE_ACCESS_REVIEW'), controller.createReview);
router.post('/access-reviews/:id/decisions', ...action('RECORD_ACCESS_REVIEW'), controller.recordReviewDecision);
router.post('/segregation-policies', ...action('CHANGE_SEGREGATION_POLICY'), controller.saveSodPolicy);
router.post('/risk-exceptions', ...action('REQUEST_RISK_EXCEPTION'), controller.requestException);
router.post('/risk-exceptions/:id/approve', ...action('APPROVE_RISK_EXCEPTION'), controller.approveException);
router.post('/key-versions', ...action('RECORD_KEY_VERSION'), controller.recordKeyVersion);
router.post('/service-accounts', ...action('CREATE_SERVICE_ACCOUNT'), controller.createServiceAccount);
router.post('/resilience-exercises', ...action('RECORD_RESILIENCE_EXERCISE'), controller.recordExercise);

module.exports = router;
