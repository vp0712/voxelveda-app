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

async function refreshDatabaseAttestation(db = pool) {
  try {
    const [[row]] = await db.query(
      `SELECT COUNT(*) AS verified
       FROM database_security_attestations
       WHERE status = 'VERIFIED'
         AND least_privilege_verified = 1
         AND expires_at > NOW()`
    );
    const attested = Number(row?.verified || 0) > 0;
    setDatabase({ least_privilege_attested: attested });
    setControl(
      'database_least_privilege',
      attested ? CONTROL_STATES.EXTERNALLY_VERIFIED : CONTROL_STATES.DEGRADED,
      attested ? 'Current provider-backed database identity attestation is verified' : 'No current least-privilege database identity attestation'
    );
    return attested;
  } catch (error) {
    setDatabase({ least_privilege_attested: false });
    setControl('database_least_privilege', CONTROL_STATES.DEGRADED, 'Database identity attestation could not be verified');
    return false;
  }
}

module.exports = { refreshDatabaseAttestation, sslCipher, verifyDatabaseConnection };
