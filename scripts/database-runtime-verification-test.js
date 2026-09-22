'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  grantIsUnsafeGlobal,
  isCertificateTrustError,
  verifyRuntimeDatabaseIdentity
} = require('../services/databaseRuntimeService');

async function run() {
  assert.strictEqual(grantIsUnsafeGlobal("GRANT USAGE ON *.* TO `voxelveda_app`@`%`"), false);
  assert.strictEqual(grantIsUnsafeGlobal("GRANT SELECT ON *.* TO `voxelveda_app`@`%`"), true);
  assert.strictEqual(grantIsUnsafeGlobal("GRANT SELECT, INSERT ON `railway`.* TO `voxelveda_app`@`%`"), false);

  assert.strictEqual(isCertificateTrustError({ code: 'SELF_SIGNED_CERT_IN_CHAIN' }), true);
  assert.strictEqual(isCertificateTrustError({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' }), true);
  assert.strictEqual(isCertificateTrustError({ code: 'ECONNREFUSED' }), false);

  const safeDb = {
    async query(sql) {
      if (sql.startsWith('SELECT CURRENT_USER()')) return [[{ runtime_user: 'voxelveda_app@%', runtime_database: 'railway' }]];
      if (sql === 'SHOW GRANTS') return [[
        { Grants_for_voxelveda_app: 'GRANT USAGE ON *.* TO `voxelveda_app`@`%`' },
        { Grants_for_voxelveda_app: 'GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, ALTER, REFERENCES, CREATE VIEW, SHOW VIEW, TRIGGER, EXECUTE ON `railway`.* TO `voxelveda_app`@`%`' }
      ]];
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };

  const safe = await verifyRuntimeDatabaseIdentity(safeDb);
  assert.strictEqual(safe.verified, true);
  assert.strictEqual(safe.root_identity, false);
  assert.strictEqual(safe.unsafe_global_grant, false);
  assert.strictEqual(safe.has_grant_option, false);
  assert.strictEqual(safe.has_schema_scoped_grant, true);

  const rootDb = {
    async query(sql) {
      if (sql.startsWith('SELECT CURRENT_USER()')) return [[{ runtime_user: 'root@%', runtime_database: 'railway' }]];
      if (sql === 'SHOW GRANTS') return [[{ Grants_for_root: 'GRANT ALL PRIVILEGES ON *.* TO `root`@`%` WITH GRANT OPTION' }]];
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };

  const unsafe = await verifyRuntimeDatabaseIdentity(rootDb);
  assert.strictEqual(unsafe.verified, false);
  assert.strictEqual(unsafe.root_identity, true);
  assert.strictEqual(unsafe.unsafe_global_grant, true);
  assert.strictEqual(unsafe.has_grant_option, true);

  const service = fs.readFileSync(path.join(__dirname, '..', 'services', 'databaseRuntimeService.js'), 'utf8');
  const state = fs.readFileSync(path.join(__dirname, '..', 'services', 'runtimeState.js'), 'utf8');
  const readiness = fs.readFileSync(path.join(__dirname, '..', 'public', 'production-readiness-assurance-center.js'), 'utf8');
  assert.match(service, /probeDatabaseTlsCapability/);
  assert.match(service, /probeTlsOnce/);
  assert.match(service, /DB_TLS_REJECT_UNAUTHORIZED/);
  assert.match(service, /ENCRYPTION_ONLY/);
  assert.match(service, /strict_certificate_trust_error/);
  assert(service.indexOf("const encryptionOnly = await probeTlsOnce(false)") > service.indexOf('const strict = await probeTlsOnce(true)'), 'TLS capability diagnostics must try an isolated encryption-only probe after strict verification fails');
  assert.match(service, /SHOW SESSION STATUS LIKE 'Ssl_cipher'/);
  assert.match(service, /DB_TLS_REQUIRED: 'true'/);
  assert.match(service, /connection\.end\(\)/);
  assert.match(service, /Database transport evidence:/);
  assert.match(service, /Database privilege evidence:/);
  assert.match(state, /tls_capable/);
  assert.match(state, /least_privilege_source/);
  assert.match(readiness, /Database connection evidence/);
  assert.match(readiness, /TLS capable/);
  assert.match(readiness, /Runtime user/);

  console.log('Database runtime verification regression test passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
