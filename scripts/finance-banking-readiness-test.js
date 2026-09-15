const fs = require('node:fs');
const path = require('node:path');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const routes = read('routes/financeRoutes.js');
const controller = read('controllers/financeBankingReadinessController.js');
const html = read('public/finance-intelligence.html');
const client = read('public/finance-banking-readiness.js');
const css = read('public/finance-banking-readiness.css');

assert(routes.includes("router.get('/intelligence/banking-readiness'"), 'Banking readiness API route is missing.');
assert(routes.includes("requireAnyPermission('VIEW_BANKING')"), 'Banking readiness route must remain permission protected.');
assert(controller.includes("BANK_DATA_CLIENT_SECRET"), 'Readiness controller must check provider-secret presence.');
assert(!controller.includes('process.env.BANK_DATA_CLIENT_SECRET,'), 'Controller must not return the bank provider secret.');
assert(controller.includes('internet-banking passwords, PINs or bank OTPs'), 'Bank credential safety rule is missing.');
assert(controller.includes("enabled: false"), 'Open Banking must remain fail-closed until provider adapter verification is complete.');
assert(html.includes('Banking Setup & Safety'), 'Finance Intelligence safety entry is missing.');
assert(html.includes('bankingSafetyControls'), 'Finance Intelligence safety controls are missing.');
assert(html.includes('/finance-banking-readiness.js'), 'Finance banking readiness client is not loaded.');
assert(client.includes("data.readinessBlocked") || client.includes("dataset.readinessBlocked"), 'Connect Bank readiness guard is missing.');
assert(client.includes('stopImmediatePropagation'), 'Connect Bank must be blocked before the unverified provider request is sent.');
assert(css.includes('.safety-status.ready'), 'Banking readiness status styles are missing.');

console.log('Finance banking readiness regression checks passed.');
