const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const routes = read('routes/securityDashboardRoutes.js');
const controller = read('controllers/securityDashboardController.js');
const ui = read('public/admin-dashboard.html');
const js = read('public/admin-dashboard.js');

assert.match(routes, /requireAnyPermission\('MANAGE_SECURITY'\)/);
assert.match(routes, /VIEW_AUDIT_LOG/);
assert.match(controller, /Operational readiness indicator only; not a security certification/);
assert.match(controller, /privileged-without-mfa/);
assert.match(controller, /LOGIN_FAILURE/);
assert.match(ui, /Security Centre/);
assert.match(ui, /securityReadinessScore/);
assert.match(js, /loadSecurityCentre/);
assert.match(js, /hasCurrentPermission\('MANAGE_SECURITY'\)/);

console.log('Security dashboard tests passed.');
