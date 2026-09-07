const express = require('express');
const controller = require('../controllers/continuousAssuranceController');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const requireStepUp = require('../middleware/stepUpMiddleware');
const { rateLimit } = require('../middleware/securityMiddleware');
const { bodyContract } = require('../middleware/requestContractMiddleware');

const router = express.Router();
const readLimit = rateLimit({ windowMs: 60000, max: 120, keyPrefix: 'assurance-read' });
const actionLimit = rateLimit({ windowMs: 60000, max: 15, keyPrefix: 'assurance-action' });
const read = [requireAnyPermission('MANAGE_CONTINUOUS_ASSURANCE'), readLimit];
const action = (name) => [requireAnyPermission('MANAGE_CONTINUOUS_ASSURANCE'), actionLimit, requireStepUp(name)];

router.get('/summary', ...read, controller.summary);
router.get('/catalog', ...read, controller.catalog);
router.post('/audit-integrity/seal', ...action('SEAL_AUDIT_INTEGRITY'), bodyContract([], { allowEmpty: true }), controller.sealAudit);
router.post('/jit-access', ...action('REQUEST_TEMPORARY_PRIVILEGE'), bodyContract(['permission','reason','duration_hours','user_id','scope_type','scope_id'], { required: ['permission','reason','user_id'] }), controller.requestJit);
router.post('/jit-access/:id/approve', ...action('APPROVE_TEMPORARY_PRIVILEGE'), bodyContract(['reason','confirmation'], { required: ['reason','confirmation'] }), controller.approveJit);
router.post('/access-reviews', ...action('CREATE_ACCESS_REVIEW'), bodyContract(['name','due_days','roles'], { required: ['name'] }), controller.createReview);
router.post('/access-reviews/:id/decisions', ...action('RECORD_ACCESS_REVIEW'), bodyContract(['decision','reason','user_id'], { required: ['decision','reason','user_id'] }), controller.recordReviewDecision);
router.post('/segregation-policies', ...action('CHANGE_SEGREGATION_POLICY'), bodyContract(['policy_key','permission_a','permission_b','severity','active'], { required: ['policy_key','permission_a','permission_b','severity'] }), controller.saveSodPolicy);
router.post('/risk-exceptions', ...action('REQUEST_RISK_EXCEPTION'), bodyContract(['control_key','owner_id','reason','compensating_controls','duration_days'], { required: ['control_key','owner_id','reason','compensating_controls'] }), controller.requestException);
router.post('/risk-exceptions/:id/approve', ...action('APPROVE_RISK_EXCEPTION'), bodyContract(['confirmation'], { required: ['confirmation'] }), controller.approveException);
router.post('/key-versions', ...action('RECORD_KEY_VERSION'), bodyContract(['key_name','key_version','purpose','fingerprint_sha256','status'], { required: ['key_name','key_version','purpose','fingerprint_sha256','status'] }), controller.recordKeyVersion);
router.post('/service-accounts', ...action('CREATE_SERVICE_ACCOUNT'), bodyContract(['account_name','purpose','scopes','owner_user_id','expires_in_days'], { required: ['account_name','purpose','scopes','owner_user_id'] }), controller.createServiceAccount);
router.post('/resilience-exercises', ...action('RECORD_RESILIENCE_EXERCISE'), bodyContract(['exercise_type','scenario','findings','result','recovery_minutes','started_at'], { required: ['exercise_type','scenario','findings','result','recovery_minutes','started_at'] }), controller.recordExercise);

module.exports = router;
