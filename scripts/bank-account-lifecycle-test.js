const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const routes = fs.readFileSync(path.join(root, 'routes', 'financeRoutes.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'finance-intelligence.html'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'public', 'finance-master.js'), 'utf8');
const controllerSource = fs.readFileSync(path.join(root, 'controllers', 'bankAccountLifecycleController.js'), 'utf8');
const controller = require('../controllers/bankAccountLifecycleController');

assert.match(routes, /bankAccountLifecycleController/);
assert.match(routes, /\/intelligence\/accounts\/:id\/archive/);
assert.match(routes, /\/intelligence\/accounts\/:id\/inactive/);
assert.match(routes, /\/intelligence\/accounts\/:id\/restore/);
assert.match(routes, /router\.delete\('\/intelligence\/accounts\/:id'/);
assert.match(routes, /requireStepUp\('CHANGE_BANK_DETAILS'\)/);
assert.match(routes, /financePrivacy\.accountParam\('id'\)/);
assert.match(routes, /\/intelligence\/active-overview/);

assert.match(html, /finance-master\.css/);
assert.match(html, /finance-master\.js/);
assert.match(ui, /Archive/);
assert.match(ui, /Set inactive/);
assert.match(ui, /Restore/);
assert.match(ui, /Permanently delete/);
assert.match(ui, /accountLifecycle/);
assert.match(ui, /intelligence\/accounts\/'\+id/);

assert.match(controllerSource, /INFORMATION_SCHEMA\.COLUMNS/);
assert.match(controllerSource, /COLUMN_NAME = 'bank_account_id'/);
assert.match(controllerSource, /BANK_ACCOUNT_HAS_DEPENDENCIES/);
assert.match(controllerSource, /BANK_ACCOUNT_DELETE_SAFETY_UNVERIFIED/);
assert.match(controllerSource, /status='ACTIVE'/);
assert.equal(controller._test.quoteIdentifier('bank_transactions'), '`bank_transactions`');
assert.throws(() => controller._test.quoteIdentifier('bank_transactions;DROP TABLE users'), /Unsafe database identifier/);

console.log('BANK_ACCOUNT_LIFECYCLE_OK');
