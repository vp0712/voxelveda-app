const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const controller = read('controllers/personalMoneyHealthController.js');
const routes = read('routes/financeRoutes.js');
const ui = read('public/personal-money-health.js');
const html = read('public/finance-intelligence.html');

assert(controller.includes("ba.created_by=? AND ba.ownership_scope='PERSONAL'"), 'Financial Health bank calculations must be owner-scoped and PERSONAL only.');
assert(controller.includes("bt.ownership_scope='PERSONAL'"), 'Financial Health transactions must remain PERSONAL only.');
assert(controller.includes('bt.is_internal_transfer=0'), 'Internal transfers must be excluded from income/spending calculations.');
assert(controller.includes('Every currency is shown separately'), 'Currency separation must be explained.');
assert(controller.includes('Manual wallets are shown separately from bank balances'), 'Possible manual-wallet double counting must be explained.');
assert(controller.includes('net_position_estimate'), 'Visible net position must be calculated.');
assert(controller.includes('savings_rate_percent'), 'Savings rate must be calculated.');
assert(controller.includes('runway_months'), 'Cash runway must be calculated.');
assert(controller.includes('projected_month_end_spending'), 'Spending velocity must be exposed as a month-end pace.');
assert(controller.includes('buffer_progress_percent'), 'Safety-buffer progress must be calculated.');
assert(controller.includes('budget_used_percent'), 'Budget performance must be calculated.');
assert(controller.includes('debt_payoff_months_if_current_surplus_used'), 'Debt payoff illustration must be explicit.');
assert(controller.includes('does not assume interest, fees'), 'Debt payoff calculation limitations must be disclosed.');
assert(!controller.includes("ownership_scope='BUSINESS'"), 'Business accounts must not be included in Personal Financial Health.');
assert(!controller.includes("ownership_scope='MIXED'"), 'Mixed accounts must not be included in Personal Financial Health.');
assert(!controller.includes('INSERT INTO'), 'Financial Health must remain read-only and must not create records.');
assert(!controller.includes('UPDATE '), 'Financial Health must remain read-only and must not update records.');
assert(!controller.includes('DELETE FROM'), 'Financial Health must remain read-only and must not delete records.');

assert(routes.includes("router.get('/personal-money/health', requireAnyPermission('VIEW_BANKING')"), 'Financial Health endpoint must require banking view permission.');
assert(ui.includes("const API='/api/finance/personal-money/health'"), 'Financial Health UI must use the protected endpoint.');
assert(ui.includes('Financial Health'), 'Financial Health must be visible in the mobile finance UI.');
assert(ui.includes('After safety buffer + known bills'), 'UI must explain spendable money after known commitments.');
assert(ui.includes('Debt payoff illustration'), 'UI must label debt payoff as an illustration.');
assert(ui.includes('How these numbers are calculated'), 'UI must expose methodology instead of hiding formulas.');
assert.match(html, /finance-master\.js/, 'Finance OS must load the unified master client.');

console.log('Personal Financial Health regression checks passed.');
