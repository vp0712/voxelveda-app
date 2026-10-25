'use strict';
// This test uses a dedicated local TLS-only disposable MySQL service. It must
// never inherit production credentials or a Railway database URL.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildDatabaseConfig } = require('../config/databaseConfig');
if (process.env.TLS_DB_TEST !== 'true' || process.env.NODE_ENV !== 'test' || process.env.DATABASE_URL) throw new Error('TLS regression requires an explicitly disposable local configuration.');
const config = buildDatabaseConfig(process.env);
if (config.options.host !== 'mysql-tls.test' || config.options.database !== 'voxelveda_tls_test' || config.options.user !== 'tls_test' || config.options.port !== 43307) throw new Error('Refusing a database outside the dedicated TLS fixture.');
if (!config.options.ssl?.rejectUnauthorized || !config.options.ssl?.verifyIdentity || !config.options.ssl?.ca) throw new Error('TLS regression requires the fixture CA and strict identity verification.');
const mysql = require('mysql2/promise');
const pool = require('../config/db');
const { verifyDatabaseConnection } = require('../services/databaseRuntimeService');
const runtime = require('../services/runtimeState');

async function rejected(options, expected, description) {
  let connection, rejection;
  try { connection = await mysql.createConnection(options); await connection.ping(); }
  catch (error) { rejection = error; }
  finally { if (connection) await connection.end(); }
  assert(rejection, description + ' must reject before any application query');
  assert.match([rejection.code, rejection.message, rejection.cause?.code, rejection.cause?.message].join(' '), expected, description + ' must fail for the expected trust/transport reason');
  return true;
}
async function main() {
  try {
    runtime.resetRuntimeState();
    const active = await verifyDatabaseConnection(pool);
    assert.equal(active.tls_active, true); assert.equal(active.tls_verified, true);
    assert.equal(active.tls_certificate_verification, true); assert.equal(active.tls_identity_verification, true);
    assert(active.tls_cipher); assert.equal(active.tls_probe, null);
    const wrongCa = buildDatabaseConfig({ ...process.env, DB_TLS_CA_FILE: process.env.TLS_TEST_WRONG_CA_FILE, DB_TLS_CA_BASE64: '' });
    const wrongCARejected = await rejected(wrongCa.options, /CERT|certificate|self.signed|issuer|unable.to.verify/i, 'Untrusted fixture CA');
    const wrongHostnameRejected = await rejected({ ...config.options, host: 'wrong-mysql-tls.test' }, /ALTNAME|Hostname|altnames|does not match/i, 'Incorrect certificate hostname');
    const plaintextRejected = await rejected({ ...config.options, ssl: undefined }, /ER_SECURE_TRANSPORT_REQUIRED|secure transport/i, 'Plaintext connection');
    const proof = {
      fixture_only: true, real_mysql_session: true, production_tls_verified: false,
      tls_active: active.tls_active, tls_cipher: active.tls_cipher,
      certificate_verified: active.tls_certificate_verification,
      server_identity_verified: active.tls_identity_verification,
      wrong_ca_rejected: wrongCARejected, wrong_hostname_rejected: wrongHostnameRejected,
      plaintext_rejected: plaintextRejected,
      public_database_keys: Object.keys(runtime.publicReadiness().database).sort()
    };
    const output = process.env.TLS_PROOF_DIR;
    if (output) { fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'database-tls-proof.json'), JSON.stringify(proof, null, 2) + '\n'); }
    console.log(JSON.stringify(proof));
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
