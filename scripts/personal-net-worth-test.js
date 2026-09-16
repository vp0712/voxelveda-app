const fs = require('fs');
const assert = require('assert');

const controller = fs.readFileSync('controllers/personalNetWorthController.js','utf8');
const routes = fs.readFileSync('routes/financeRoutes.js','utf8');
const ui = fs.readFileSync('public/personal-net-worth.js','utf8');
const loader = fs.readFileSync('public/personal-money-health.js','utf8');
const migration = fs.readFileSync('migrations/20260916_personal_net_worth_assets.sql','utf8');

assert(controller.includes("WHERE created_by=? AND ownership_scope='PERSONAL'"), 'Net worth bank balances must be owner-scoped PERSONAL only');
assert(controller.includes('WHERE user_id=? AND active=1'), 'Net worth records must be owner scoped');
assert(controller.includes('personal_money_debts WHERE user_id=?'), 'Existing borrowed/lent money must remain owner scoped');
assert(controller.includes('const out = {}'), 'Net worth totals must be grouped by currency');
assert(controller.includes('row.net_worth'), 'Net worth must be calculated per currency');
assert(!controller.includes('finance_transactions'), 'Personal net worth must not silently create company finance transactions');
assert(!controller.includes('journal_entries'), 'Personal net worth must not silently create company journals');
assert(controller.includes('beginTransaction()') && controller.includes('personal_net_worth_asset_values'), 'Asset current value and history must be transactional');
assert(controller.includes('personal_net_worth_liability_values'), 'Liability balance updates must retain history');
assert(controller.includes('exports.saveSnapshot'), 'Net worth snapshot must be an explicit action');
assert(controller.includes('ON DUPLICATE KEY UPDATE'), 'Same-day snapshot should update rather than duplicate');

assert(routes.includes("router.get('/personal-money/net-worth'"), 'Protected Net Worth GET route missing');
assert(routes.includes("router.post('/personal-money/net-worth/assets'"), 'Asset creation route missing');
assert(routes.includes("router.post('/personal-money/net-worth/liabilities'"), 'Liability creation route missing');
assert(routes.includes("router.post('/personal-money/net-worth/snapshot'"), 'Explicit snapshot route missing');
assert(routes.includes("requireAnyPermission('VIEW_BANKING'), personalNetWorth.getDashboard"), 'Net Worth view must remain permission protected');

assert(migration.includes('user_id VARCHAR(191) NOT NULL'), 'Net worth schema must store owner identity');
assert(migration.includes('UNIQUE KEY uq_pnws_user_currency_date'), 'Snapshot history must prevent duplicate same-day currency snapshots');
assert(migration.includes('personal_net_worth_asset_values'), 'Asset valuation history table missing');
assert(migration.includes('personal_net_worth_liability_values'), 'Liability history table missing');

assert(ui.includes("btn.textContent='Net Worth'"), 'Net Worth button missing');
assert(ui.includes('Save Today’s Snapshot'), 'Explicit snapshot control missing');
assert(ui.includes('Do not add bank/cash balances here'), 'Double-counting guidance missing');
assert(ui.includes('Update value') && ui.includes('Update balance'), 'Simple valuation update controls missing');
assert(ui.includes('Currencies stay separate') || ui.includes('currency_rule'), 'Currency separation explanation missing');
assert(loader.includes('/personal-net-worth.js?v=20260916-net-worth'), 'Financial Health module must load Net Worth Center');

console.log('Personal Net Worth regression checks passed.');
