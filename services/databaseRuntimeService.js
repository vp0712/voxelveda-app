const mysql = require('mysql2/promise');
const pool = require('../config/db');
const { buildDatabaseConfig } = require('../config/databaseConfig');
const { CONTROL_STATES, setControl, setDatabase } = require('./runtimeState');

function sslCipher(rows) {
  const entry = Array.isArray(rows) ? rows.find((row) => String(row.Variable_name || row.variable_name || '').toLowerCase() === 'ssl_cipher') : null;
  return String(entry?.Value || entry?.value || '').trim();
}

async function probeDatabaseTlsCapability() {
  let connection;
  try {
    const probeConfig = buildDatabaseConfig({ ...process.env, DB_TLS_REQUIRED: 'true' });
    connection = await mysql.createConnection({ ...probeConfig.options, connectTimeout: Math.min(Number(probeConfig.options.connectTimeout || 10000), 8000) });
    await connection.ping();
    const [statusRows] = await connection.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
    const cipher = sslCipher(statusRows);
    return { capable: Boolean(cipher), cipher: cipher || null, certificate_verification: Boolean(probeConfig.summary.tls_certificate_verification), error_code: null };
  } catch (error) {
    return { capable: false, cipher: null, certificate_verification: true, error_code: String(error?.code || 'DB_TLS_PROBE_FAILED').slice(0, 80) };
  } finally {
    if (connection) await connection.end().catch(() => {});
  }
}

async function verifyDatabaseConnection(db = pool) {
  const summary = db.databaseConfigSummary || {};
  setDatabase({ state: CONTROL_STATES.INITIALIZING, connected: false, tls_requested: Boolean(summary.tls_requested), tls_active: false, tls_certificate_verification: Boolean(summary.tls_certificate_verification) });
  setControl('database_tls', CONTROL_STATES.INITIALIZING, summary.tls_requested ? 'TLS requested; verifying active connection' : 'TLS not requested; checking provider capability safely');

  const connection = await db.getConnection();
  try {
    await connection.ping();
    const [statusRows] = await connection.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
    const cipher = sslCipher(statusRows);
    const tlsActive = Boolean(cipher);
    if (summary.tls_requested && !tlsActive) {
      const error = new Error('Database TLS was requested but the active connection is not encrypted');
      error.code = 'DB_TLS_NOT_ACTIVE';
      throw error;
    }

    let capability = { capable: tlsActive, cipher: cipher || null, certificate_verification: Boolean(summary.tls_certificate_verification), error_code: null };
    if (!tlsActive) capability = await probeDatabaseTlsCapability();

    setDatabase({
      state: CONTROL_STATES.OPERATIONAL,
      connected: true,
      tls_requested: Boolean(summary.tls_requested),
      tls_active: tlsActive,
      tls_capable: capability.capable,
      tls_cipher: cipher || capability.cipher || null,
      tls_certificate_verification: tlsActive ? Boolean(summary.tls_certificate_verification) : capability.certificate_verification
    });

    if (tlsActive) {
      setControl('database_tls', CONTROL_STATES.EXTERNALLY_VERIFIED, `Active database transport is encrypted${cipher ? ` with ${cipher}` : ''}; certificate verification ${summary.tls_certificate_verification ? 'enabled' : 'disabled'}`);
    } else if (capability.capable) {
      setControl('database_tls', CONTROL_STATES.DEGRADED, `Provider accepted a TLS probe${capability.cipher ? ` using ${capability.cipher}` : ''}, but the application pool is not enforcing TLS yet`);
    } else {
      setControl('database_tls', CONTROL_STATES.NOT_CONFIGURED, `Active connection is unencrypted and TLS capability probe did not succeed (${capability.error_code || 'unknown'})`);
    }

    console.log(`Database transport evidence: active=${tlsActive ? 'yes' : 'no'} capable=${capability.capable ? 'yes' : 'no'} certificate_verification=${(tlsActive ? summary.tls_certificate_verification : capability.certificate_verification) ? 'yes' : 'no'} cipher=${cipher || capability.cipher || 'none'}`);
    return { connected: true, tls_requested: Boolean(summary.tls_requested), tls_active: tlsActive, tls_capable: capability.capable, tls_cipher: cipher || capability.cipher || null };
  } catch (error) {
    setDatabase({ state: CONTROL_STATES.FAILED, connected: false, tls_active: false });
    setControl('database_tls', CONTROL_STATES.FAILED, String(error.code || 'DATABASE_CONNECTION_FAILED'));
    throw error;
  } finally {
    connection.release();
  }
}

function grantIsUnsafeGlobal(grant) {
  const text = String(grant || '').trim();
  const match = text.match(/^GRANT\s+(.+?)\s+ON\s+\*\.\*\s+TO\s+/i);
  if (!match) return false;
  return String(match[1]).trim().toUpperCase() !== 'USAGE';
}

async function verifyRuntimeDatabaseIdentity(db = pool) {
  const [[identity]] = await db.query('SELECT CURRENT_USER() AS runtime_user, DATABASE() AS runtime_database');
  const currentUser = String(identity?.runtime_user || '').trim();
  const userName = currentUser.split('@')[0].replace(/^'|'$/g, '').toLowerCase();
  const database = String(identity?.runtime_database || '').trim();
  const [grantRows] = await db.query('SHOW GRANTS');
  const grants = grantRows.map((row) => String(Object.values(row)[0] || ''));
  const rootIdentity = userName === 'root' || userName === 'admin' || userName === 'mysql.sys';
  const hasGrantOption = grants.some((grant) => /WITH\s+GRANT\s+OPTION/i.test(grant));
  const unsafeGlobalGrant = grants.some(grantIsUnsafeGlobal);
  const escapedDatabase = database.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasSchemaScopedGrant = database ? grants.some((grant) => new RegExp(`ON\\s+\`?${escapedDatabase}\`?\\.\\*`, 'i').test(grant)) : false;
  const verified = Boolean(currentUser && database && !rootIdentity && !hasGrantOption && !unsafeGlobalGrant && hasSchemaScopedGrant);
  return { verified, user_name: userName || null, database: database || null, root_identity: rootIdentity, has_grant_option: hasGrantOption, unsafe_global_grant: unsafeGlobalGrant, has_schema_scoped_grant: hasSchemaScopedGrant };
}

async function refreshDatabaseAttestation(db = pool) {
  try {
    const runtime = await verifyRuntimeDatabaseIdentity(db);
    let providerAttested = false;
    try {
      const [[row]] = await db.query(`SELECT COUNT(*) AS verified FROM database_security_attestations WHERE status = 'VERIFIED' AND least_privilege_verified = 1 AND expires_at > NOW()`);
      providerAttested = Number(row?.verified || 0) > 0;
    } catch {}

    const verified = runtime.verified || providerAttested;
    setDatabase({
      least_privilege_attested: verified,
      least_privilege_source: providerAttested ? 'PROVIDER_ATTESTATION' : runtime.verified ? 'RUNTIME_GRANTS' : 'UNVERIFIED',
      runtime_user: runtime.user_name,
      runtime_database: runtime.database,
      root_identity: runtime.root_identity,
      has_grant_option: runtime.has_grant_option,
      unsafe_global_grant: runtime.unsafe_global_grant,
      has_schema_scoped_grant: runtime.has_schema_scoped_grant
    });
    setControl('database_least_privilege', verified ? (providerAttested ? CONTROL_STATES.EXTERNALLY_VERIFIED : CONTROL_STATES.OPERATIONAL) : CONTROL_STATES.DEGRADED,
      providerAttested ? 'Current provider-backed database identity attestation is verified' : runtime.verified ? `Runtime MySQL identity ${runtime.user_name} is non-root, schema-scoped and has no global privileges or GRANT OPTION` : 'Runtime database identity is not verified as least privilege');
    console.log(`Database privilege evidence: verified=${verified ? 'yes' : 'no'} source=${providerAttested ? 'provider_attestation' : runtime.verified ? 'runtime_grants' : 'unverified'} user=${runtime.user_name || 'unknown'} root=${runtime.root_identity ? 'yes' : 'no'} grant_option=${runtime.has_grant_option ? 'yes' : 'no'} unsafe_global=${runtime.unsafe_global_grant ? 'yes' : 'no'} schema_scoped=${runtime.has_schema_scoped_grant ? 'yes' : 'no'}`);
    return verified;
  } catch (error) {
    setDatabase({ least_privilege_attested: false, least_privilege_source: 'ERROR' });
    setControl('database_least_privilege', CONTROL_STATES.DEGRADED, 'Database identity could not be verified');
    console.warn(`Database privilege evidence unavailable: ${String(error?.code || 'DB_PRIVILEGE_VERIFICATION_FAILED')}`);
    return false;
  }
}

module.exports = { grantIsUnsafeGlobal, probeDatabaseTlsCapability, refreshDatabaseAttestation, sslCipher, verifyDatabaseConnection, verifyRuntimeDatabaseIdentity };
