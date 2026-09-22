const fs = require('node:fs');
const path = require('node:path');

function read(file) { return fs.readFileSync(path.join(__dirname, '..', file), 'utf8'); }
function expect(source, token, message) {
  if (!source.includes(token)) throw new Error(message + ' (missing: ' + token + ')');
}

const ui = read('public/finance-master.js');
const settings = read('controllers/settingsController.js');
const finance = read('controllers/financeController.js');
const routes = read('routes/financeRoutes.js');
const notificationRoutes = read('routes/notificationRoutes.js');

[
  ["/personal-money/daily-briefing", 'Daily briefing must load in the Finance OS'],
  ["/personal-money/saved-views", 'Saved views must load in the Finance OS'],
  ["'/budgets'", 'Banking budgets must load in the Finance OS'],
  ["/api/notifications?limit=50", 'Notifications must load in the Finance OS'],
  ["/api/notifications/preferences", 'Notification preferences must load in the Finance OS'],
  ["/api/settings", 'Company settings must load in the Finance OS'],
  ["data-debt-pay", 'Debt repayment action must be exposed'],
  ["data-goal-contribute", 'Savings goal contribution action must be exposed'],
  ["data-recurring-complete", 'Recurring completion action must be exposed'],
  ["data-bank-budget-archive", 'Banking budget lifecycle action must be exposed'],
  ["saveCurrentView", 'Saved transaction view action must be exposed'],
  ["notificationsView", 'Notification Centre must be part of the Finance OS'],
  ["openCompanySettings", 'Company reporting settings must be editable']
].forEach(([token, message]) => expect(ui, token, message));

[
  'company_legal_name','trading_name','company_address','base_currency',
  'financial_year_start','gst_registration','report_footer'
].forEach((key) => expect(settings, key, 'Company/report setting must be allow-listed: ' + key));

[
  "const settingKeys = ['company_legal_name'",
  "const logoPath = path.join(__dirname, '..', 'public', 'Frame 1.png')",
  "doc.switchToPage(index)",
  "profile.footer",
  "report_id: reportId"
].forEach((token) => expect(finance, token, 'Accountant PDF must use every-page company branding and report identity'));

[
  "router.get('/personal-money/daily-briefing'",
  "router.get('/personal-money/saved-views'",
  "router.post('/personal-money/debts/:id/payments'",
  "router.post('/personal-money/goals/:id/contributions'",
  "router.post('/personal-money/recurring/:id/complete'",
  "router.get('/intelligence/budgets'",
  "router.post('/intelligence/budgets'"
].forEach((token) => expect(routes, token, 'Finance backend route must remain available'));

expect(notificationRoutes, "router.get('/preferences'", 'Notification preferences route must remain available');
expect(notificationRoutes, "router.post('/mark-all-read'", 'Notification mark-all-read route must remain available');

const duplicateFunctionNames = [...ui.matchAll(/(?:^|\n)(?:async )?function\s+([A-Za-z0-9_]+)\s*\(/g)]
  .map((match) => match[1])
  .filter((name, index, all) => all.indexOf(name) !== index);
if (duplicateFunctionNames.length) {
  throw new Error('Finance master contains duplicate function declarations: ' + [...new Set(duplicateFunctionNames)].join(', '));
}

console.log('FINANCE_CONTROL_CENTRE_COMPLETION_TEST_OK');
