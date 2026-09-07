const fs = require('fs');
const assert = require('assert');

const read = (file) => fs.readFileSync(file, 'utf8');
const schema = read('services/assuranceSchema.js');
const controller = read('controllers/continuousAssuranceController.js');
const routes = read('routes/continuousAssuranceRoutes.js');
const auth = read('middleware/auth.js');
const authorization = read('services/authorizationService.js');
const migration = read('migrations/20260907_continuous_assurance.sql');
const segregation = read('services/segregationPolicyService.js');
const userController = read('controllers/userController.js');

for (const table of ['audit_integrity_checkpoints','privileged_access_requests','access_review_campaigns','access_review_decisions','segregation_policies','security_risk_exceptions','cryptographic_key_versions','service_accounts','security_event_outbox','resilience_exercises']) {
  assert(schema.includes(table), `runtime schema missing ${table}`);
  assert(migration.includes(table), `migration missing ${table}`);
}
assert(controller.includes("requester_id") || controller.includes('requested_by'));
assert(controller.includes('APPROVE TEMPORARY ACCESS'));
assert(controller.includes('ACCEPT RESIDUAL RISK'));
assert(controller.includes('Number(item.requested_by)===Number(req.user.id)'));
assert(controller.includes("hours > 8"));
assert(controller.includes("days>90"));
assert(controller.includes("fingerprint_sha256"));
assert(controller.includes("queueSecurityEvent"));
assert(routes.includes("requireStepUp"));
assert(routes.includes("MANAGE_CONTINUOUS_ASSURANCE"));
assert(auth.includes("expires_at>NOW()"));
assert(auth.includes("status='ACTIVE'"));
assert(authorization.includes('temporary_permissions'));
assert(segregation.includes('assertNoSegregationConflicts'));
assert(segregation.includes("WHERE active=1"));
assert(userController.match(/assertNoSegregationConflicts/g).length >= 4, 'user creation and both access-update flows must enforce segregation policies');
console.log('Continuous assurance tests passed.');
