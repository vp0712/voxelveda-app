const assert = require('assert');
const fs = require('fs');
const { ROLE_TEMPLATES } = require('../config/permissionCatalog');
const { validateSettings } = require('../controllers/settingsController');
const { bodyContract } = require('../middleware/requestContractMiddleware');
const { denyDelegatedSensitiveAccess } = require('../middleware/securityContextMiddleware');
const { redactSensitive } = require('../utils/securityRedaction');

function runMiddleware(middleware, body, securityContext = null) {
  return new Promise((resolve, reject) => {
    const state = { statusCode: 200, body: null };
    const req = { body, securityContext };
    const res = {
      status(code) { state.statusCode = code; return this; },
      json(payload) { state.body = payload; resolve({ next: false, ...state }); return this; }
    };
    try { middleware(req, res, () => resolve({ next: true, ...state })); } catch (error) { reject(error); }
  });
}

async function main() {
  const strictProfile = bodyContract(['display_name'], { required: ['display_name'] });
  assert.equal((await runMiddleware(strictProfile, { display_name: 'User', role: 'SUPER_ADMIN' })).statusCode, 400);
  assert.equal((await runMiddleware(strictProfile, { display_name: 'User', isAdmin: true })).statusCode, 400);
  assert.equal((await runMiddleware(strictProfile, JSON.parse('{"display_name":"User","constructor":{"prototype":{"admin":true}}}'))).statusCode, 400);
  assert.equal((await runMiddleware(strictProfile, { display_name: 'User' })).next, true);

  assert.throws(() => validateSettings({ JWT_SECRET: 'leak' }), /Unsupported settings/);
  assert.throws(() => validateSettings({ website: 'javascript:alert(1)' }), /not valid/);
  assert.deepEqual(validateSettings({ company_email: 'security@voxelveda.com' }), { company_email: 'security@voxelveda.com' });

  assert(ROLE_TEMPLATES.super_admin.includes('MANAGE_BREAK_GLASS'));
  assert(!ROLE_TEMPLATES.admin.includes('MANAGE_BREAK_GLASS'));
  assert(!ROLE_TEMPLATES.finance_admin.includes('USE_SUPPORT_IMPERSONATION'));

  assert.equal((await runMiddleware(denyDelegatedSensitiveAccess, {}, { impersonation: true })).statusCode, 403);
  assert.equal((await runMiddleware(denyDelegatedSensitiveAccess, {}, { breakGlass: true })).statusCode, 403);
  assert.equal((await runMiddleware(denyDelegatedSensitiveAccess, {}, null)).next, true);

  const redacted = redactSensitive({ password: 'secret', account_number_ciphertext: 'cipher', nested: { authorization: 'Bearer abc' } });
  assert.equal(redacted.password, '[REDACTED]');
  assert.equal(redacted.account_number_ciphertext, '[REDACTED]');
  assert.equal(redacted.nested.authorization, '[REDACTED]');

  const files = {
    app: fs.readFileSync('app.js', 'utf8'),
    governance: fs.readFileSync('controllers/securityGovernanceController.js', 'utf8'),
    context: fs.readFileSync('services/securityContextService.js', 'utf8'),
    auth: fs.readFileSync('middleware/auth.js', 'utf8'),
    audit: fs.readFileSync('services/auditService.js', 'utf8'),
    verifier: fs.readFileSync('services/auditIntegrityService.js', 'utf8'),
    users: fs.readFileSync('services/userSecurityService.js', 'utf8'),
    routes: fs.readFileSync('routes/securityGovernanceRoutes.js', 'utf8'),
    migration: fs.readFileSync('migrations/20260908_phase_51_70_identity_governance.sql', 'utf8')
  };
  for (const table of ['break_glass_requests', 'impersonation_contexts', 'database_security_attestations', 'sensitive_data_registry', 'ownership_transfer_events']) {
    assert(files.migration.includes(table), `migration missing ${table}`);
  }
  assert(!/\b(?:DROP|TRUNCATE|DELETE)\b/i.test(files.migration), 'migration must remain additive');
  assert(files.governance.includes('Requester and beneficiary cannot approve'));
  assert(files.governance.includes('minutes > 60'));
  assert(files.governance.includes('minutes > 15'));
  assert(files.governance.includes('FINANCE_DELEGATION_BLOCKLIST'));
  assert(files.context.includes("!['GET', 'HEAD'].includes(req.method)"));
  assert(files.context.includes("'/api/high-risk-finance'"));
  assert(files.context.includes('req.originalUrl'));
  assert(files.auth.includes('BREAK_GLASS_ACCESS_USED'));
  assert(files.auth.includes('IMPERSONATION_ACCESS_USED'));
  assert(files.audit.includes('previous_integrity_hash'));
  assert(files.audit.includes("GET_LOCK('voxelveda_audit_chain'"));
  assert(files.audit.includes('LIMIT 1 FOR UPDATE'));
  assert(files.verifier.includes('CONTENT_HASH_MISMATCH'));
  assert(files.verifier.includes('PREDECESSOR_MISMATCH'));
  assert(files.users.includes('OWNERSHIP_TRANSFER_REQUIRED'));
  assert(files.users.includes('ownership_transfer_events'));
  assert(files.routes.match(/requireStepUp/g).length >= 2);
  assert(files.app.includes("app.set('query parser', 'simple')"));
  assert(/extended\s*:\s*false/.test(files.app));

  console.log('Phases 51-70 identity-governance tests passed.');
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
