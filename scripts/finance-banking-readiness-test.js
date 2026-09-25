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
const client = read('public/finance-master.js');
const css = read('public/finance-master.css');

assert(routes.includes("router.get('/intelligence/banking-readiness'"), 'Banking readiness API route is missing.');
assert(routes.includes("requireAnyPermission('VIEW_BANKING')"), 'Banking readiness route must remain permission protected.');
assert(providerService.includes("BANK_DATA_CLIENT_SECRET"), 'Provider registry must support provider-secret presence checks.');
assert(providerService.includes("BANK_DATA_API_KEY"), 'Provider registry must support Basiq API-key presence checks.');
assert(!controller.includes('process.env.BANK_DATA_CLIENT_SECRET,'), 'Controller must not return the bank provider secret.');
assert(!providerService.includes('client_secret: process.env.BANK_DATA_CLIENT_SECRET'), 'Provider service must not expose provider secrets in status output.');
assert(controller.includes('internet-banking passwords, PINs or bank OTPs'), 'Bank credential safety rule is missing.');
assert(controller.includes('productionBankFeedReady'), 'Open Banking must calculate a fail-closed production readiness gate.');
assert(controller.includes("bankEnvironment === 'PRODUCTION' && liveEnabled"), 'Production Open Banking must require explicit production environment and live-sync enablement.');
assert(html.includes('finance-master.js'), 'Finance Master OS client is not loaded.');
assert(client.includes("I+'/banking-readiness'"), 'Finance OS must load banking readiness status.');
assert(client.includes('Banking Setup & Safety'), 'Finance OS safety settings are missing.');
assert(client.includes('Fail-closed until provider and production controls are verified.'), 'Finance OS must keep Open Banking fail-closed messaging.');
assert(css.includes('.fm-badge.good'), 'Finance OS readiness status styles are missing.');
assert(controller.includes('public_launch'),'Banking readiness must expose a separate public-launch gate.');
assert(controller.includes('AU_ADI_AUTHORITY_REFERENCE'),'Bank branding gate must require recorded ADI authority evidence.');
assert(controller.includes('AU_RESTRICTED_BANK_WORD_CONSENT_REFERENCE'),'Restricted bank-word gate must require recorded consent evidence.');
assert(controller.includes("mode: publicBankBrandingReady ? 'BANK_BRANDING_EVIDENCE_PRESENT' : 'FINANCE_PLATFORM_ONLY'"),'Public launch must default to finance-platform-only wording.');
assert(controller.includes('Independent legal verification is still required before public bank claims.'),'Technical readiness must not self-authorise public bank claims.');
assert(client.includes('PUBLIC SERVICE LAUNCH GATE'),'Finance OS must show the public launch gate to administrators.');
assert(css.includes('.fm-public-launch-gate'),'Public launch gate styling is missing.');

console.log('Finance banking readiness regression checks passed.');
