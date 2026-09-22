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


const app = read('app.js');
const financeUi = read('public/finance-master.js');

expect(financeUi, "function dateRange()", 'Finance period presets must resolve to explicit date ranges');
expect(financeUi, "filterQuery(", 'Finance APIs must receive explicit filter query parameters');
expect(financeUi, "Mixed currencies", 'Finance UI must warn rather than fabricate mixed-currency totals');
expect(financeUi, "server-side filters and pagination", 'Transaction Explorer must remain server-side');
expect(financeUi, "ORIGINAL BANK DATA", 'Transaction detail must preserve source provenance');
expect(financeUi, "CURRENT CLASSIFICATION", 'Transaction detail must separate editable classification from source evidence');
expect(app, "app.post('/api/security/csp-report'", 'CSP reporting endpoint must exist');
const cspIndex = app.indexOf("app.post('/api/security/csp-report'");
const csrfIndex = app.indexOf("app.use(csrfProtection)");
if (cspIndex < 0 || csrfIndex < 0 || cspIndex > csrfIndex) {
  throw new Error('CSP report ingestion must remain before CSRF enforcement while retaining rate limiting and validation');
}

const trustedTotals = read('services/financeTrustedTotals.js');
expect(trustedTotals, 'net_economic_expense', 'Trusted totals must expose net economic expense semantics');
expect(trustedTotals, 'linked_refund_inflow', 'Trusted totals must expose linked refund inflow semantics');
expect(routes, "router.get('/reports/builder'", 'Report Builder route must exist');
expect(routes, "router.get('/reports/builder.csv'", 'Filtered CSV export route must exist');
expect(routes, "router.get('/preferences'", 'Finance user preferences route must exist');
expect(routes, "router.put('/preferences'", 'Finance user preferences update route must exist');
expect(routes, "router.post('/accounting-periods/:id/status'", 'Accounting period transition route must exist');
expect(routes, "router.post('/categories'", 'Finance category creation route must exist');
expect(routes, "router.post('/bank-transactions/:id/archive'", 'Recoverable transaction archive route must exist');
expect(routes, "router.post('/bank-transactions/:id/restore'", 'Recoverable transaction restore route must exist');
expect(ui.toLowerCase(), 'global search', 'Finance UI must keep global search capability discoverable');

expect(routes, "router.get('/reports/builder.pdf'", 'Protected branded Report Builder PDF route must exist');
expect(ui, "id=\"reportPdf\"", 'Report Builder must expose PDF export');
expect(ui, "reports/builder.pdf", 'Report Builder PDF button must use the filtered report definition');
const reportBuilder = read('controllers/financeReportBuilderController.js');
expect(reportBuilder, "INCOME_VS_EXPENSE", 'Report Builder must include income vs expense reporting');
expect(reportBuilder, "GST_SUMMARY", 'Report Builder must include GST summary reporting');
expect(reportBuilder, "COMPANY_MONTHLY_SUMMARY", 'Report Builder must include company monthly summary reporting');
expect(reportBuilder, "doc.switchToPage(index)", 'Filtered Finance PDFs must repeat branding on every page');

console.log('FINANCE_FINAL_PRODUCTION_VERIFICATION_OK');

console.log('FINANCE_CONTROL_CENTRE_COMPLETION_TEST_OK');
