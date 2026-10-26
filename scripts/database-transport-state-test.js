'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildDatabaseConfig } = require('../config/databaseConfig');
const runtime = require('../services/runtimeState');

const source = fs.readFileSync(path.join(__dirname, '../services/databaseRuntimeService.js'), 'utf8');
function session(cipher, { authorized = true, verifyIdentity = true, rejectUnauthorized = true, host = 'database.fixture.invalid' } = {}) {
  return {
    connection: { stream: { encrypted: Boolean(cipher), authorized, getPeerCertificate: () => ({ subjectaltname: 'DNS:database.fixture.invalid', subject: { CN: 'database.fixture.invalid' } }) }, config: { host, ssl: { verifyIdentity, rejectUnauthorized } } },
    released: 0, ended: 0,
    async ping() {},
    async query(sql) { assert.equal(sql, "SHOW SESSION STATUS LIKE 'Ssl_cipher'"); return [[{ Variable_name: 'Ssl_cipher', Value: cipher }]]; },
    release() { this.released++; }, async end() { this.ended++; }
  };
}
function service(probes = []) {
  const calls = [], module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports,
    process: { env: { DB_HOST: 'localhost', DB_PORT: '3306', DB_USER: 'fixture', DB_PASSWORD: 'not-used', DB_NAME: 'fixture' } },
    console: { log() {}, warn() {} },
    require(name) {
      if (name === 'mysql2/promise') return { async createConnection(options) {
        calls.push(options);
        const next = probes.shift(); if (next instanceof Error) throw next;
        assert(next, 'Unexpected capability probe'); next.connection.config.ssl = options.ssl; return next;
      } };
      if (name === '../config/db') return {};
      if (name === '../config/databaseConfig') return { buildDatabaseConfig };
      if (name === './runtimeState') return runtime;
      if (name === 'node:tls') return require('node:tls');
      throw new Error('Unexpected transport fixture dependency');
    }
  }, { filename: 'databaseRuntimeService.js' });
  return { api: module.exports, calls };
}
function pool(connection, required = false) {
  return { databaseConfigSummary: { tls_requested: required, tls_certificate_verification: required, tls_identity_verification: required }, async getConnection() { return connection; } };
}
async function main() {
  const cfg = buildDatabaseConfig({ DATABASE_URL: 'mysqls://fixture:not-used@localhost/fixture' });
  assert.equal(cfg.options.ssl.rejectUnauthorized, true);
  assert.equal(cfg.options.ssl.verifyIdentity, true, 'mysql2 hostname verification must be explicit');
  for (const env of [{ DB_TLS_CA_BASE64: 'not base64!' }, { DB_TLS_CA_BASE64: Buffer.from('not a certificate').toString('base64') }, { DB_TLS_CA_FILE: path.join(__dirname, 'missing-fixture-ca.pem') }]) {
    assert.throws(() => buildDatabaseConfig(env), { code: 'DB_TLS_CA_INVALID' });
  }

  runtime.resetRuntimeState();
  const plain = session(''), looseProbe = session('TLS_AES_256_GCM_SHA384', { authorized: false });
  let fixture = service([Object.assign(new Error('fixture trust failure'), { code: 'HANDSHAKE_SSL_ERROR' }), looseProbe]);
  const plainResult = await fixture.api.verifyDatabaseConnection(pool(plain));
  assert.equal(plainResult.tls_active, false);
  assert.equal(plainResult.tls_cipher, null);
  assert.equal(plainResult.tls_certificate_verification, false);
  assert.equal(plainResult.tls_identity_verification, false);
  assert.equal(plainResult.tls_verified, false);
  assert.equal(plainResult.tls_trust_status, 'PLAINTEXT');
  assert.equal(plainResult.tls_probe.trust_status, 'ENCRYPTION_ONLY');
  assert.equal(plainResult.tls_probe.cipher, 'TLS_AES_256_GCM_SHA384');
  assert.equal(fixture.calls[0].ssl.verifyIdentity, true);
  assert.equal(fixture.calls[1].ssl.verifyIdentity, false);
  assert.equal(looseProbe.ended, 1); assert.equal(plain.released, 1);

  runtime.setDatabase({ runtime_user: 'private-identity', runtime_database: 'private-database', least_privilege_source: 'private-source', tls_probe_error_code: 'PRIVATE_DIAGNOSTIC', future_sensitive_field: 'private-value' });
  const publicState = runtime.publicReadiness().database;
  assert.deepEqual(Object.keys(publicState).sort(), ['connected', 'state', 'tls_active', 'tls_certificate_verification', 'tls_identity_verification', 'tls_requested', 'tls_verified']);
  assert(!JSON.stringify(publicState).includes('private-'));
  assert.equal(runtime.detailedReadiness().database.runtime_user, 'private-identity');
  assert.equal(runtime.detailedReadiness().database.tls_probe.trust_status, 'ENCRYPTION_ONLY');

  runtime.resetRuntimeState();
  const verifiedProbe = session('TLS_AES_128_GCM_SHA256'); fixture = service([verifiedProbe]);
  const available = await fixture.api.verifyDatabaseConnection(pool(session('')));
  assert.equal(available.tls_probe.trust_status, 'VERIFIED');
  assert.equal(available.tls_verified, false, 'A trusted diagnostic connection cannot secure a plaintext pool');
  assert.equal(available.tls_cipher, null); assert.equal(verifiedProbe.ended, 1);

  runtime.resetRuntimeState();
  const secure = session('TLS_AES_128_GCM_SHA256'); fixture = service();
  const verified = await fixture.api.verifyDatabaseConnection(pool(secure, true));
  assert.equal(verified.tls_verified, true); assert.equal(verified.tls_identity_verification, true);
  assert.equal(verified.tls_probe, null); assert.equal(fixture.calls.length, 0); assert.equal(secure.released, 1);
  assert.equal(runtime.controlSnapshot().database_tls.state, 'EXTERNALLY_VERIFIED');

  for (const connection of [session(''), session('TLS_AES_128_GCM_SHA256', { authorized: false }), session('TLS_AES_128_GCM_SHA256', { verifyIdentity: false }), session('TLS_AES_128_GCM_SHA256', { host: 'wrong.fixture.invalid' })]) {
    runtime.resetRuntimeState(); fixture = service();
    await assert.rejects(() => fixture.api.verifyDatabaseConnection(pool(connection, true)), error => ['DB_TLS_NOT_ACTIVE', 'DB_TLS_PEER_NOT_VERIFIED'].includes(error.code));
    assert.equal(connection.released, 1); assert.equal(fixture.calls.length, 0, 'Required TLS must not fall back to capability probes');
    assert.equal(runtime.publicReadiness().database.tls_verified, false);
    assert.equal(runtime.publicReadiness().database.state, 'FAILED');
  }
  runtime.resetRuntimeState(); fixture = service();
  await assert.rejects(() => fixture.api.verifyDatabaseConnection({ databaseConfigSummary: cfg.summary, async getConnection() { throw Object.assign(new Error('fixture handshake rejection'), { code: 'HANDSHAKE_SSL_ERROR' }); } }), { code: 'HANDSHAKE_SSL_ERROR' });
  assert.equal(runtime.publicReadiness().database.state, 'FAILED');
  assert.equal(runtime.publicReadiness().database.tls_certificate_verification, false);
  console.log('Database transport state tests passed: actual-session TLS/peer/identity evidence, isolated probes, fail-closed handshakes, explicit public allowlist and protected diagnostics. Fixtures only; production TLS is not claimed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
