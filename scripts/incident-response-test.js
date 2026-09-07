const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { HIGH_RISK_PERMISSIONS, ROLE_TEMPLATES } = require('../config/permissionCatalog');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const routes = read('routes/securityIncidentRoutes.js');
const controller = read('controllers/securityIncidentController.js');
const schema = read('services/securityOperationsSchema.js');
const report = read('services/securityReportService.js');
const ui = read('public/admin-dashboard.js');

for (const permission of ['MANAGE_SECURITY_INCIDENTS', 'EXPORT_SECURITY_REPORT', 'REVOKE_ORGANISATION_SESSIONS']) {
  assert(HIGH_RISK_PERMISSIONS.has(permission), `${permission} must remain high risk`);
  assert(ROLE_TEMPLATES.super_admin.includes(permission), `${permission} must be explicitly available to super administrators`);
  assert(!ROLE_TEMPLATES.admin.includes(permission), `${permission} must not be granted to ordinary administrators`);
}

assert.match(routes, /requireStepUp\('OPEN_SECURITY_INCIDENT'\)/);
assert.match(routes, /requireStepUp\('CONTAIN_COMPROMISED_ACCOUNT'\)/);
assert.match(routes, /requireStepUp\('INITIATE_ACCOUNT_RECOVERY'\)/);
assert.match(routes, /requireStepUp\('REVOKE_ORGANISATION_SESSIONS'\)/);
assert.match(routes, /requireStepUp\('EXPORT_SECURITY_REPORT'\)/);
assert.match(controller, /Only a super administrator can revoke organisation sessions/);
assert.match(controller, /A different authorised administrator must handle your account incident/);
assert.match(controller, /confirmation !== 'REVOKE ALL SESSIONS'/);
assert.match(controller, /UPDATE auth_sessions SET revoked_at/);
assert.match(controller, /session_version = session_version \+ 1/);
assert.match(report, /security_report_snapshots/i);
assert.match(schema, /CREATE TABLE IF NOT EXISTS security_incidents/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS security_incident_actions/);
assert.match(ui, /Emergency Organisation Sign-out/);
assert.match(ui, /Immutable action history/);

console.log('Incident-response tests passed.');
