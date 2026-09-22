const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const controller = read('controllers/personalMoneySmartController.js');
const routes = read('routes/financeRoutes.js');
const ui = read('public/personal-money-smart.js');
const html = read('public/finance-intelligence.html');
const migration = read('migrations/20260916_personal_money_smart_cashflow.sql');

assert.match(controller, /ba\.created_by=\?/i, 'Smart analysis must be scoped to the authenticated account owner.');
assert.match(controller, /ba\.ownership_scope='PERSONAL'/, 'Recurring detection must exclude business and mixed bank accounts.');
assert.match(controller, /bt\.ownership_scope='PERSONAL'/, 'Recurring detection must exclude non-personal bank transactions.');
assert.match(controller, /bt\.is_internal_transfer=0/, 'Internal transfers must not be treated as recurring spending.');
assert.match(controller, /items\.length < 3/, 'Recurring suggestions must require repeated evidence.');
assert.match(controller, /already_added/, 'Detected patterns must be protected against duplicate recurring reminders.');
assert.match(controller, /Expected income is shown separately and is not counted as available money/, 'Safe-to-spend must not assume future income will arrive.');
assert.match(controller, /visible_funds - row\.known_outflows_30d - row\.safety_buffer/, 'Safe-to-spend must reserve known outflows and the user safety buffer.');
assert.doesNotMatch(controller, /INSERT INTO finance_transactions|INSERT INTO journal_entries|supplier_bill_payments/, 'Smart Money must not create company accounting or payment records.');
assert.match(routes, /personal-money\/smart'.*VIEW_BANKING/, 'Smart Money read endpoint must require banking permission.');
assert.match(routes, /personal-money\/smart\/recurring\/:key\/apply'.*EDIT_FINANCE/, 'Applying a suggestion must require finance edit permission.');
assert.match(routes, /personal-money\/smart\/safety-buffer'.*EDIT_FINANCE/, 'Changing the safety buffer must require finance edit permission.');
assert.match(ui, /Create reminder/, 'UI must require an explicit action before a detected pattern becomes a reminder.');
assert.match(ui, /Set Safety Buffer/, 'UI must expose the safety buffer clearly.');
assert.match(ui, /60-day cash-flow calendar/, 'UI must explain the cash-flow horizon.');
assert.match(html, /finance-master\.js/, 'Finance OS must load the unified master client.');
assert.match(migration, /uniq_personal_recurring_detected_source/, 'Detected recurring sources must have duplicate protection.');
assert.match(migration, /personal_money_safety_buffers/, 'Safety buffers must be persisted per user and currency.');

console.log('Personal Money Smart planning regression tests passed.');
