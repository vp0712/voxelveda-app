const crypto = require('crypto');
const pool = require('../config/db');
const { ensureSecuritySchema } = require('./securitySchema');

const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

async function issueToken({ userId, type, minutes, createdBy = null }) {
  await ensureSecuritySchema();
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const id = crypto.randomUUID();
  await pool.query(
    'UPDATE auth_action_tokens SET revoked_at = NOW() WHERE user_id = ? AND token_type = ? AND used_at IS NULL AND revoked_at IS NULL',
    [userId, type]
  );
  await pool.query(
    `INSERT INTO auth_action_tokens (id, user_id, token_type, token_hash, expires_at, created_by)
     VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), ?)`,
    [id, userId, type, hash(rawToken), Math.max(5, Number(minutes || 30)), createdBy]
  );
  return rawToken;
}

async function consumeToken(rawToken, type, connection = pool) {
  await ensureSecuritySchema();
  const [[row]] = await connection.query(
    `SELECT id, user_id FROM auth_action_tokens
     WHERE token_hash = ? AND token_type = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
     LIMIT 1 FOR UPDATE`,
    [hash(rawToken), type]
  );
  if (!row) return null;
  await connection.query('UPDATE auth_action_tokens SET used_at = NOW() WHERE id = ?', [row.id]);
  return row;
}

async function revokeUserActionTokens(userId) {
  await ensureSecuritySchema();
  await pool.query('UPDATE auth_action_tokens SET revoked_at = NOW() WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL', [userId]);
}

module.exports = { issueToken, consumeToken, revokeUserActionTokens };
