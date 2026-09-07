const fs = require('fs');
const path = require('path');
const assert = require('assert');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const risk = read('services/adaptiveRiskService.js');
const schema = read('services/enterpriseControlPlaneSchema.js');
const controller = read('controllers/enterpriseControlPlaneController.js');
const routes = read('routes/enterpriseControlPlaneRoutes.js');
const guard = read('middleware/enterpriseMutationGuard.js');
const governance = read('routes/securityGovernanceRoutes.js');

assert(risk.includes('IMPERSONATION_CONTEXT'));
assert(risk.includes('requires_additional_review'));
assert(schema.includes('control_evidence'));
assert(schema.includes('enterprise_change_requests'));
assert(schema.includes('resilience_drills'));
assert(schema.includes('vendor_risk_assessments'));
assert(schema.includes('ai_action_policies'));
assert(schema.includes('manufacturing_trace_events'));
assert(controller.includes('Requester cannot approve their own change'));
assert(controller.includes('Provider controls are not inferred from application code'));
assert(routes.includes("requireStepUp(action)"));
assert(routes.includes("requireAnyPermission('MANAGE_SECURITY')"));
assert(guard.includes('IMPERSONATION_WRITE_DENIED'));
assert(governance.includes("router.use('/enterprise', enterpriseControlPlaneRoutes)"));

console.log('Phase 71-140 enterprise control-plane checks passed.');
