const fs = require('node:fs');
const path = require('node:path');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

function expect(source, needle, message) {
  if (!source.includes(needle)) throw new Error(message || `Expected ${needle}`);
}

const migration = read('migrations/20260916_open_banking_sandbox_foundation.sql');
[
  'open_banking_provider_users',
  'open_banking_consent_sessions',
  'open_banking_sync_runs',
  'open_banking_webhook_events'
].forEach((table) => expect(migration, table, `Missing Open Banking table ${table}`));

const service = read('services/openBankingProviderService.js');
expect(service, "BASIQ", 'Basiq provider registry missing');
expect(service, "SERVER_ACCESS", 'Basiq server-token scope missing');
expect(service, "CLIENT_ACCESS", 'Basiq client-token scope missing');
expect(service, "BANK_DATA_LIVE_SYNC_ENABLED", 'Explicit production live-sync lock missing');
expect(service, "https://consent.basiq.io/home", 'Basiq consent UI endpoint missing');
expect(service, "BANK_DATA_API_KEY", 'Basiq API key configuration missing');

const controller = read('controllers/openBankingController.js');
expect(controller, "environment() === 'PRODUCTION' && !liveSyncEnabled()", 'Production Open Banking must fail closed');
expect(controller, "PROVIDER_ADAPTER_NOT_READY", 'Unimplemented provider adapters must fail closed');
expect(controller, "stateHash(state)", 'Consent session state must be stored as a hash');
expect(controller, "db.rollback()", 'Consent transaction must roll back on failure');
expect(controller, "never receives or stores your bank password, PIN or OTP", 'Bank credential safety message missing');

const routes = read('routes/financeRoutes.js');
expect(routes, "/intelligence/open-banking/providers", 'Provider status endpoint missing');
expect(routes, "/intelligence/open-banking/sessions", 'Consent session endpoint missing');
expect(routes, "/intelligence/open-banking/consent", 'Consent start endpoint missing');
expect(routes, "requireStepUp('CHANGE_BANK_DETAILS')", 'Open Banking consent must require step-up authentication');

const readiness = read('controllers/financeBankingReadinessController.js');
expect(readiness, "sandbox_consent_ready", 'Sandbox consent readiness state missing');
expect(readiness, "production_controls_ready", 'Production banking controls state missing');
expect(readiness, "BANK_DATA_WEBHOOK_SECRET", 'Webhook readiness check missing');
expect(readiness, "liveSyncEnabled()", 'Readiness must use the explicit live-sync lock');

const loader = read('public/finance-banking-readiness.js');
const ui = read('public/finance-banking-readiness-core.js');
expect(loader, '/finance-banking-readiness-core.js', 'Readiness loader must load the Open Banking UI core.');
expect(ui, "providerSetupPanel", 'Provider setup UI missing');
expect(ui, "Start sandbox consent", 'Sandbox consent action missing');
expect(ui, "Open Banking Setup", 'Guided Connect Bank label missing');
expect(ui, "Railway", 'Credential setup guidance missing');

const env = read('.env.example');
expect(env, 'BANK_DATA_ENVIRONMENT=sandbox', 'Sandbox must be the documented default');
expect(env, 'BANK_DATA_LIVE_SYNC_ENABLED=false', 'Live bank sync must default off');
expect(env, 'BANK_DATA_API_KEY=', 'Basiq API key variable missing');

const newSources = [service, controller, readiness, loader, ui].join('\n').toLowerCase();
if (newSources.includes('bank_password') || newSources.includes('bank_pin') || newSources.includes('bank_otp')) {
  throw new Error('Open Banking source must not introduce fields for bank passwords, PINs or OTPs');
}

console.log('Open Banking sandbox foundation checks passed.');
