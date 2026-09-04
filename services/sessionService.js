const crypto = require('crypto');
const pool = require('../config/db');
const { ensureSecuritySchema } = require('./securitySchema');

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

async function createSession({ id, token, userId, sessionVersion, assuranceLevel = 1, expiresAt, req }) {
  await ensureSecuritySchema();
  await pool.query(
    `INSERT INTO auth_sessions
     (id, user_id, token_hash, assurance_level, session_version, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, hashToken(token), assuranceLevel, sessionVersion, req.ip || null, String(req.get('user-agent') || '').slice(0, 255), expiresAt]
  );
}

async function validateSession(token, decoded) {
  if (!decoded?.jti) return null;
  await ensureSecuritySchema();
  const [[session]] = await pool.query(
    `SELECT id, user_id, assurance_level, session_version, expires_at
     FROM auth_sessions
     WHERE id = ? AND token_hash = ? AND revoked_at IS NULL AND expires_at > NOW() LIMIT 1`,
    [decoded.jti, hashToken(token)]
  );
  if (session) {
    await pool.query('UPDATE auth_sessions SET last_seen_at = NOW() WHERE id = ? AND last_seen_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)', [session.id]);
  }
  return session || null;
}

async function revokeSession(token, reason = 'LOGOUT') {
  if (!token) return;
  await ensureSecuritySchema();
  await pool.query(
    'UPDATE auth_sessions SET revoked_at = NOW(), revoke_reason = ? WHERE token_hash = ? AND revoked_at IS NULL',
    [reason, hashToken(token)]
  );
}

async function revokeUserSessions(userId, reason) {
  await ensureSecuritySchema();
  await pool.query(
    'UPDATE auth_sessions SET revoked_at = NOW(), revoke_reason = ? WHERE user_id = ? AND revoked_at IS NULL',
    [String(reason || 'SECURITY_CHANGE').slice(0, 100), userId]
  );
}

async function listUserSessions(userId) {
  await ensureSecuritySchema();
  const [rows] = await pool.query(
    `SELECT id, assurance_level, ip_address, user_agent, created_at, last_seen_at, expires_at
     FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > NOW()
     ORDER BY last_seen_at DESC`, [userId]
  );
  return rows;
}

async function revokeSessionById(userId, sessionId, reason = 'USER_REVOKED') {
  await ensureSecuritySchema();
  const [result] = await pool.query(
    `UPDATE auth_sessions SET revoked_at = NOW(), revoke_reason = ?
     WHERE id = ? AND user_id = ? AND revoked_at IS NULL`, [reason, sessionId, userId]
  );
  return result.affectedRows > 0;
}

async function logSecurityEvent(entry) {
  await ensureSecuritySchema();
  await pool.query(
    `INSERT INTO security_events
     (actor_id, target_user_id, event_type, result, request_id, session_id, ip_address, user_agent, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [entry.actorId || null, entry.targetUserId || null, entry.eventType, entry.result || 'SUCCESS',
      entry.req?.requestId || entry.req?.headers?.['x-request-id'] || null, entry.sessionId || null,
      entry.req?.ip || null, String(entry.req?.get?.('user-agent') || '').slice(0, 255),
      entry.metadata ? JSON.stringify(entry.metadata) : null]
  );
}

module.exports = { createSession, validateSession, revokeSession, revokeUserSessions, listUserSessions, revokeSessionById, logSecurityEvent };
