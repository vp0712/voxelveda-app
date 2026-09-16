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
const providerService = read('services/openBankingProviderService.js');
const html = read('public/finance-intelligence.html');
const loader = read('public/finance-banking-readiness.js');
const client = read('public/finance-banking-readiness-core.js');
const css = read('public/finance-banking-readiness.css');

assert(routes.includes("router.get('/intelligence/banking-readiness'"), 'Banking readiness API route is missing.');
assert(routes.includes("requireAnyPermission('VIEW_BANKING')"), 'Banking readiness route must remain permission protected.');
assert(providerService.includes("BANK_DATA_CLIENT_SECRET"), 'Provider registry must support provider-secret presence checks.');
assert(providerService.includes("BANK_DATA_API_KEY"), 'Provider registry must support Basiq API-key presence checks.');
assert(!controller.includes('process.env.BANK_DATA_CLIENT_SECRET,'), 'Controller must not return the bank provider secret.');
assert(!providerService.includes('client_secret: process.env.BANK_DATA_CLIENT_SECRET'), 'Provider service must not expose provider secrets in status output.');
assert(controller.includes('internet-banking passwords, PINs or bank OTPs'), 'Bank credential safety rule is missing.');
assert(controller.includes('productionBankFeedReady'), 'Open Banking must calculate a fail-closed production readiness gate.');
assert(controller.includes("bankEnvironment === 'PRODUCTION' && liveEnabled"), 'Production Open Banking must require explicit production environment and live-sync enablement.');
assert(html.includes('Banking Setup & Safety'), 'Finance Intelligence safety entry is missing.');
assert(html.includes('bankingSafetyControls'), 'Finance Intelligence safety controls are missing.');
assert(html.includes('/finance-banking-readiness.js'), 'Finance banking readiness loader is not loaded.');
assert(loader.includes('/finance-banking-readiness-core.js'), 'Banking readiness loader must load the protected core client.');
assert(client.includes("data.readinessBlocked") || client.includes("dataset.readinessBlocked"), 'Connect Bank readiness guard is missing.');
assert(client.includes('stopImmediatePropagation'), 'Connect Bank must be blocked before the unverified provider request is sent.');
assert(css.includes('.safety-status.ready'), 'Banking readiness status styles are missing.');

console.log('Finance banking readiness regression checks passed.');
