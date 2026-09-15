const pool = require('../config/db');
const {
  CONTROL_STATES,
  setControl,
  setDatabase
} = require('./runtimeState');

function sslCipher(rows) {
  const entry = Array.isArray(rows) ? rows.find((row) => String(row.Variable_name || row.variable_name || '').toLowerCase() === 'ssl_cipher') : null;
  return String(entry?.Value || entry?.value || '').trim();
}

async function verifyDatabaseConnection(db = pool) {
  const summary = db.databaseConfigSummary || {};
  setDatabase({
    state: CONTROL_STATES.INITIALIZING,
    connected: false,
    tls_requested: Boolean(summary.tls_requested),
    tls_active: false
  });
  setControl('database_tls', CONTROL_STATES.INITIALIZING, summary.tls_requested ? 'TLS requested; verifying active connection' : 'TLS not requested');

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

    setDatabase({
      state: CONTROL_STATES.OPERATIONAL,
      connected: true,
      tls_requested: Boolean(summary.tls_requested),
      tls_active: tlsActive
    });
    setControl(
      'database_tls',
      tlsActive ? CONTROL_STATES.EXTERNALLY_VERIFIED : CONTROL_STATES.NOT_CONFIGURED,
      tlsActive ? 'Active database connection reports a TLS cipher' : 'Active database connection is not using TLS'
    );
    return { connected: true, tls_requested: Boolean(summary.tls_requested), tls_active: tlsActive };
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
  const hasSchemaScopedGrant = database
    ? grants.some((grant) => new RegExp(`ON\\s+\`?${escapedDatabase}\`?\\.\\*`, 'i').test(grant))
    : false;
  const verified = Boolean(currentUser && database && !rootIdentity && !hasGrantOption && !unsafeGlobalGrant && hasSchemaScopedGrant);
  return {
    verified,
    user_name: userName || null,
    database: database || null,
    root_identity: rootIdentity,
    has_grant_option: hasGrantOption,
    unsafe_global_grant: unsafeGlobalGrant,
    has_schema_scoped_grant: hasSchemaScopedGrant
  };
}

async function refreshDatabaseAttestation(db = pool) {
  try {
    const runtime = await verifyRuntimeDatabaseIdentity(db);
    let providerAttested = false;
    try {
      const [[row]] = await db.query(
        `SELECT COUNT(*) AS verified
         FROM database_security_attestations
         WHERE status = 'VERIFIED'
           AND least_privilege_verified = 1
           AND expires_at > NOW()`
      );
      providerAttested = Number(row?.verified || 0) > 0;
    } catch {}

    const verified = runtime.verified || providerAttested;
    setDatabase({ least_privilege_attested: verified });
    setControl(
      'database_least_privilege',
      verified ? (providerAttested ? CONTROL_STATES.EXTERNALLY_VERIFIED : CONTROL_STATES.OPERATIONAL) : CONTROL_STATES.DEGRADED,
      providerAttested
        ? 'Current provider-backed database identity attestation is verified'
        : runtime.verified
          ? `Runtime MySQL identity ${runtime.user_name} is non-root, schema-scoped and has no global privileges or GRANT OPTION`
          : 'Runtime database identity is not verified as least privilege'
    );
    return verified;
  } catch (error) {
    setDatabase({ least_privilege_attested: false });
    setControl('database_least_privilege', CONTROL_STATES.DEGRADED, 'Database identity could not be verified');
    return false;
  }
}

module.exports = {
  grantIsUnsafeGlobal,
  refreshDatabaseAttestation,
  sslCipher,
  verifyDatabaseConnection,
  verifyRuntimeDatabaseIdentity
};
