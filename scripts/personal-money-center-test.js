'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const migration = read('migrations/20260916_personal_money_center.sql');
const controller = read('controllers/personalMoneyController.js');
const routes = read('routes/financeRoutes.js');
const client = read('public/personal-money-center.js');
const html = read('public/finance-intelligence.html');

for (const table of ['personal_money_wallets','personal_money_entries','personal_money_debts','personal_money_debt_payments','personal_money_budgets']) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`), `${table} schema is required.`);
}
assert.match(migration, /user_id VARCHAR\(191\) NOT NULL/, 'Personal Money records must be owner keyed.');
assert.match(controller, /WHERE user_id = \?/g, 'Personal Money reads must filter by the authenticated owner.');
assert.match(controller, /GROUP BY w\.currency/, 'Cash-flow analytics must remain separated by wallet currency.');
assert.match(controller, /GROUP BY currency/, 'Debt analytics must remain separated by currency.');
assert.match(controller, /Currencies are reported separately/, 'API must explain that currencies are never silently mixed.');
assert.match(controller, /Enter an FX rate showing how 1 .* converts to/, 'Cross-currency entries must require an explicit FX rate.');
assert.match(controller, /beginTransaction\(\)/, 'Wallet and repayment mutations must be transactional.');
assert.doesNotMatch(controller, /INSERT INTO finance_transactions|INSERT INTO journal|INSERT INTO journals/i, 'Personal Money Center must not silently post company accounting journals.');
assert.match(routes, /router\.get\('\/personal-money'.*VIEW_BANKING/, 'Personal Money dashboard must remain behind authenticated finance permissions.');
assert.match(routes, /router\.post\('\/personal-money\/entries'.*EDIT_FINANCE/, 'Personal Money mutations require edit permission.');
assert.match(client, /Owner-private/, 'UI must visibly explain owner privacy.');
assert.match(client, /Currencies stay separate/, 'UI must explain multi-currency separation.');
assert.match(client, /Borrowed & lent/, 'Borrowed/lent workflow must be visible.');
assert.match(client, /Budgets & forecast/, 'Budget and forecast workflow must be visible.');
assert.match(html, /\/personal-money-center\.js/, 'Finance Intelligence page must load Personal Money Center.');

console.log('Personal Money Center regression tests passed.');
