const assert = require('assert');
const { assessProductionReadiness, secretBytes } = require('../config/productionReadiness');

const key = (byte) => Buffer.alloc(32, byte).toString('base64');
const valid = {
  NODE_ENV: 'production', JWT_SECRET: 'j'.repeat(48), SESSION_SECRET: 's'.repeat(48),
  MFA_ENCRYPTION_KEY: key(1), FINANCE_ENCRYPTION_KEY: key(2), SHIFT_QR_SIGNING_KEY: key(3),
  ALLOWED_ORIGINS: 'https://app.voxelveda.com,https://voxelveda.com',
  APP_URL: 'https://app.voxelveda.com', TRUST_PROXY: 'true',
  ALLOW_LEGACY_QUERY_TOKENS: 'false', ENABLE_ADMIN_BOOTSTRAP: 'false',
  ALLOW_PUBLIC_ADMIN_REGISTRATION: 'false', DEBUG_AUTH_BYPASS: 'false',
  RATE_LIMIT_STORE: 'redis', MALWARE_SCANNER_PROVIDER: 'clamav', BACKUP_STATUS_PROVIDER: 'configured',
  FORCE_CANONICAL_HOST: 'true', WEBHOOK_SIGNING_KEY: 'w'.repeat(48), OUTBOUND_ALLOWED_HOSTS: 'api.example.com',
  DB_USER: 'voxelveda_app', DB_TLS_REQUIRED: 'true'
};

assert.equal(secretBytes(key(9)), 32);
assert.deepEqual(assessProductionReadiness(valid), { production: true, ready: true, failures: [], warnings: [] });

for (const mutation of [
  { JWT_SECRET: 'secret' }, { SESSION_SECRET: valid.JWT_SECRET }, { ALLOWED_ORIGINS: '*' },
  { APP_URL: 'http://app.voxelveda.com' }, { TRUST_PROXY: 'false' }, { DEBUG_AUTH_BYPASS: 'true' },
  { SHIFT_QR_SIGNING_KEY: '' }, { DB_TLS_REJECT_UNAUTHORIZED: 'false' }
]) {
  const result = assessProductionReadiness({ ...valid, ...mutation });
  assert.equal(result.ready, false, JSON.stringify(mutation));
  assert(result.failures.length > 0);
}

const urlConfigured = { ...valid, DB_USER: '', DATABASE_URL: 'mysqls://voxelveda_app:secret@db.example.com/voxelveda' };
assert.equal(assessProductionReadiness(urlConfigured).ready, true);

const honestWarnings = assessProductionReadiness({ ...valid, MALWARE_SCANNER_PROVIDER: '', BACKUP_STATUS_PROVIDER: 'unverified', RATE_LIMIT_STORE: 'memory', FORCE_CANONICAL_HOST: 'false' });
assert.equal(honestWarnings.ready, true);
assert.equal(honestWarnings.warnings.length, 4);

console.log('Production-readiness tests passed.');
