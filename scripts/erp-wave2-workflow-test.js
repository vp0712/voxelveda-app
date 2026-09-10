const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const schema = read('services/workflowSchema.js');
const migration = read('migrations/20260910_erp_wave2_workflow_engine.sql');
const service = read('services/workflowService.js');
const sla = read('services/workflowEscalationService.js');
const routes = read('routes/workflowRoutes.js');
const permissions = read('config/permissionCatalog.js');
const app = read('app.js');
const server = read('server.js');
const ui = read('public/workflow-ui.js');
const adminHtml = read('public/admin-dashboard.html');
const staffHtml = read('public/staff-dashboard.html');

const tables = [
  'workflow_definitions', 'workflow_steps', 'workflow_instances', 'workflow_actions',
  'workflow_assignments', 'workflow_escalations', 'workflow_sla_events'
];
for (const table of tables) {
  assert(schema.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `${table} must exist in runtime schema`);
  assert(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `${table} must exist in additive migration`);
}

assert(schema.includes('SEEDED_WORKFLOWS'), 'workflow definitions must be seeded');
for (const key of ['PROCUREMENT_APPROVAL', 'EXPENSE_APPROVAL', 'FINANCE_APPROVAL', 'SUPPLIER_APPROVAL', 'QUALITY_APPROVAL', 'CAPA_APPROVAL', 'DOCUMENT_APPROVAL', 'SECURITY_APPROVAL', 'HR_APPROVAL']) {
  assert(schema.includes(key), `${key} must be available`);
}

assert(service.includes('FOR UPDATE'), 'workflow state changes must lock records');
assert(service.includes('GET_LOCK'), 'workflow submission and definition publication must use advisory locks');
assert(service.includes('WORKFLOW_SELF_APPROVAL_DENIED'), 'self approval must be denied by default');
assert(service.includes('WORKFLOW_DUPLICATE_REQUEST'), 'duplicate active requests must be rejected');
assert(service.includes('logAudit'), 'workflow actions must be audited');
assert(service.includes('createNotification'), 'workflow actions must generate notifications');
assert(!routes.includes("router.delete("), 'workflow controlled records must not expose destructive delete routes');
assert(routes.includes("requireStepUp('PUBLISH_WORKFLOW_DEFINITION')"), 'definition publication must require step-up authentication');
assert(routes.includes("requireStepUp('REASSIGN_WORKFLOW_APPROVER')"), 'reviewer reassignment must require step-up authentication');

for (const permission of ['VIEW_APPROVALS', 'CREATE_APPROVAL_REQUEST', 'ACTION_APPROVALS', 'MANAGE_WORKFLOWS']) {
  assert(permissions.includes(`'${permission}'`), `${permission} must be in the permission catalog`);
}
assert(sla.includes("'DUE_SOON'"), 'SLA due-soon events must be recorded');
assert(sla.includes("'BREACHED'"), 'SLA breaches must be recorded');
assert(sla.includes("'ESCALATED'"), 'SLA escalations must be recorded');
assert(sla.includes('WORKFLOW_SLA_${eventType}'), 'automated SLA events must be written to the central audit ledger');
assert(server.includes('startWorkflowSlaScheduler'), 'workflow SLA scheduler must start with the server');
assert(app.includes("app.use('/api/workflows'"), 'workflow API must be mounted');
assert(app.includes("app.get('/approvals'"), 'the universal approvals route must be available');
assert(app.includes("['admin','super_admin'].includes"), 'the approvals route must keep non-admin reviewers in the staff portal');

assert(adminHtml.includes('data-workflow-portal="admin"'), 'admin My Approvals view must exist');
assert(staffHtml.includes('data-workflow-portal="staff"'), 'staff My Approvals view must exist');
assert(ui.includes("api('/my-approvals')"), 'shared UI must load assigned approvals');
assert(ui.includes("api('/my-requests')"), 'shared UI must load submitted requests');
assert(ui.includes("data-workflow-action=\"APPROVE\""), 'shared UI must expose approval action');
assert(ui.includes('reportValidity'), 'workflow request form must use client validation');

console.log('ERP Wave 2 workflow source audit passed.');
