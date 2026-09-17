const assert = require('assert');
const fs = require('fs');

const controller = fs.readFileSync('controllers/recoveryDrillGovernanceController.js', 'utf8');
const routes = fs.readFileSync('routes/readinessRoutes.js', 'utf8');

for (const marker of ['CRITICAL', 'PASS_OBJECTIVES_MISSED', 'days_until_next_drill', 'provider_telemetry_verified_by_this_view: false', 'production_restore_available: false']) {
  assert(controller.includes(marker), `Governance controller must preserve ${marker}`);
}
assert(routes.includes("router.get('/recovery/drills/governance'"), 'Protected governance endpoint must be routed.');
assert(routes.includes("securityAccess, recoveryLimit, governanceController.status"), 'Governance endpoint must use security authorization and rate limiting.');
assert(!controller.includes('UPDATE recovery_drill_records'), 'Governance status must be read-only.');
assert(!controller.includes('DELETE FROM recovery_drill_records'), 'Governance status must not delete evidence.');
assert(!controller.includes('production restore'), 'Governance status must not implement production restore actions.');
console.log('Recovery drill governance safeguards passed.');
