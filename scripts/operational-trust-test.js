const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isPrivateIp, validateOutboundUrl } = require('../services/outboundRequestPolicy');
const { verifyWebhookSignature } = require('../services/webhookSecurityService');
const { enforceAiAction, sanitizeAiValue } = require('../services/aiSecurityPolicy');
const { effectivePermissions } = require('../services/authorizationService');

assert.equal(isPrivateIp('127.0.0.1'), true);
assert.equal(isPrivateIp('10.2.3.4'), true);
assert.equal(isPrivateIp('169.254.169.254'), true);
assert.equal(isPrivateIp('100.64.0.1'), true);
assert.equal(isPrivateIp('::ffff:127.0.0.1'), true);
assert.equal(isPrivateIp('8.8.8.8'), false);
assert.equal(validateOutboundUrl('https://api.example.com/path', { OUTBOUND_ALLOWED_HOSTS: 'api.example.com' }).hostname, 'api.example.com');
for (const target of ['http://api.example.com', 'https://127.0.0.1', 'https://user:pass@api.example.com', 'https://unknown.example']) {
  assert.throws(() => validateOutboundUrl(target, { OUTBOUND_ALLOWED_HOSTS: 'api.example.com' }));
}

const webhookSecret = 'w'.repeat(48);
const body = Buffer.from('{"safe":true}');
const timestamp = Math.floor(Date.now() / 1000);
const signature = `sha256=${crypto.createHmac('sha256', webhookSecret).update(`${timestamp}.`).update(body).digest('hex')}`;
assert.equal(verifyWebhookSignature({ rawBody: body, timestamp, signature, secret: webhookSecret }).ok, true);
assert.equal(verifyWebhookSignature({ rawBody: Buffer.from('{}'), timestamp, signature, secret: webhookSecret }).ok, false);
assert.equal(verifyWebhookSignature({ rawBody: body, timestamp: timestamp - 301, signature, secret: webhookSecret }).ok, false);

const filtered = sanitizeAiValue({ note: 'Bearer abcdefghijklmnopqrstuvwxyz', password: 'NeverStoreMe', nested: { bank_account: '123456-123456' } });
assert(!JSON.stringify(filtered).includes('NeverStoreMe'));
assert(!JSON.stringify(filtered).includes('abcdefghijklmnopqrstuvwxyz'));
assert.equal(filtered.password, '[REDACTED]');
assert.throws(() => enforceAiAction('EXECUTE_PAYMENT'));
assert.equal(enforceAiAction('SUMMARISE_JOB'), true);

const bounded = effectivePermissions({ role: 'super_admin', permission_boundary: ['VIEW_INVENTORY'] });
assert.deepEqual([...bounded], ['VIEW_INVENTORY']);

const root = path.join(__dirname, '..');
const routes = fs.readFileSync(path.join(root, 'routes/operationalTrustRoutes.js'), 'utf8');
assert(routes.includes("requireStepUp('CREATE_SCOPED_API_TOKEN')"));
assert(routes.includes("requireStepUp('APPROVE_SENSITIVE_EXPORT')"));
assert(routes.includes("requireStepUp('RECORD_SECRET_ROTATION')"));
const schema = fs.readFileSync(path.join(root, 'services/operationalTrustSchema.js'), 'utf8');
for (const table of ['webhook_receipts', 'data_retention_policies', 'sensitive_export_requests', 'backup_attestations', 'security_evidence_snapshots']) assert(schema.includes(table));
assert(!/secret_(?:value|plaintext)/i.test(schema), 'secret inventory must never store secret values');
const controller = fs.readFileSync(path.join(root, 'controllers/operationalTrustController.js'), 'utf8');
assert(/initiator cannot approve/i.test(controller));
assert(controller.includes('execution_enabled: false'), 'retention execution must remain disabled without an archival adapter');

console.log('Operational-trust tests passed.');
