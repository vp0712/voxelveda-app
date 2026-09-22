'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const migration = read('migrations/20260916_personal_money_attention_center.sql');
const controller = read('controllers/personalMoneyAttentionController.js');
const routes = read('routes/financeRoutes.js');
const client = read('public/personal-money-attention.js');
const html = read('public/finance-intelligence.html');

for (const table of ['personal_money_recurring_items','personal_money_savings_goals','personal_money_goal_contributions']) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`), `${table} schema is required.`);
}
assert.match(migration, /user_id VARCHAR\(191\) NOT NULL/g, 'Attention Center records must remain owner keyed.');
assert.match(controller, /WHERE user_id=\?/g, 'Attention Center reads must filter by authenticated owner.');
assert.match(controller, /GROUP BY currency/, 'Wallet calculations must remain separated by currency.');
assert.match(controller, /Nothing will be paid automatically/, 'Recurring setup must explicitly remain reminder-only.');
assert.match(controller, /No payment transaction was created/, 'Mark-completed must not pretend a payment was recorded.');
assert.match(controller, /No wallet balance was changed automatically/, 'Savings goal progress must not move wallet money silently.');
assert.doesNotMatch(controller, /INSERT INTO finance_transactions|INSERT INTO journals|INSERT INTO journal_entries/i, 'Attention Center must not silently post company accounting journals.');
assert.match(controller, /beginTransaction\(\)/, 'Goal contribution updates must be transactional.');
assert.match(routes, /\/personal-money\/attention'.*VIEW_BANKING/, 'Attention Center view must be permission protected.');
assert.match(routes, /\/personal-money\/recurring'.*EDIT_FINANCE/, 'Recurring-item mutations must require finance edit permission.');
assert.match(routes, /\/personal-money\/goals'.*EDIT_FINANCE/, 'Savings-goal mutations must require finance edit permission.');
assert.match(client, /What needs your attention\?/, 'Plain-language attention heading is required.');
assert.match(client, /Nothing is paid or moved automatically/, 'UI must explain non-automation clearly.');
assert.match(client, /Wallet headroom after known 30-day obligations/, '30-day planning headroom must be visible.');
assert.match(client, /Bills & subscriptions/, 'Recurring commitments UI is required.');
assert.match(client, /Savings goals/, 'Savings-goal UI is required.');
assert.match(html, /finance-master\.js/, 'Finance OS must load the unified master client.');

console.log('Smart Money Attention Center regression tests passed.');
