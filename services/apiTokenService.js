const crypto = require('crypto');
const pool = require('../config/db');
const { ensureOperationalTrustSchema } = require('./operationalTrustSchema');
const { effectivePermissions } = require('./authorizationService');

const TOKEN_PREFIX = 'vv_pat_';

function hashToken(token) { return crypto.createHash('sha256').update(String(token)).digest('hex'); }
function isApiToken(value) { return String(value || '').startsWith(TOKEN_PREFIX); }

async function createApiToken({ user, name, scopes, expiresAt, createdBy }) {
  await ensureOperationalTrustSchema();
  const allowed = effectivePermissions(user);
  const requested = [...new Set((Array.isArray(scopes) ? scopes : []).map((scope) => String(scope).trim().toUpperCase()))];
  if (!requested.length || requested.some((scope) => !allowed.has(scope))) {
    throw Object.assign(new Error('Token scopes must be a non-empty subset of the target user permissions'), { statusCode: 400 });
  }
  const expiry = new Date(expiresAt);
  if (!Number.isFinite(expiry.getTime()) || expiry <= new Date() || expiry > new Date(Date.now() + 366 * 86400000)) {
    throw Object.assign(new Error('API token expiry must be within the next 366 days'), { statusCode: 400 });
  }
  const id = crypto.randomUUID();
  const token = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
  const prefix = token.slice(0, 18);
  await pool.query(
    `INSERT INTO user_api_tokens
     (id, user_id, token_name, token_hash, token_prefix, scopes_json, expires_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, user.id, String(name || '').trim().slice(0, 120), hashToken(token), prefix, JSON.stringify(requested), expiry, createdBy]
  );
  return { id, token, token_prefix: prefix, scopes: requested, expires_at: expiry.toISOString() };
}

async function authenticateApiToken(token, req) {
  if (!isApiToken(token)) return null;
  await ensureOperationalTrustSchema();
  const tokenHash = hashToken(token);
  const [[row]] = await pool.query(
    `SELECT t.id AS token_id, t.user_id, t.scopes_json, u.email, u.username, u.role, u.permissions,
            u.active, u.account_status, u.deleted_at
     FROM user_api_tokens t JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ? AND t.revoked_at IS NULL AND t.expires_at > NOW() LIMIT 1`,
    [tokenHash]
  );
  if (!row || Number(row.active) !== 1 || row.deleted_at || ['LOCKED', 'SUSPENDED', 'DISABLED', 'TERMINATED'].includes(String(row.account_status).toUpperCase())) return null;
  const scopes = Array.isArray(row.scopes_json) ? row.scopes_json : JSON.parse(row.scopes_json || '[]');
  await pool.query(
    'UPDATE user_api_tokens SET last_used_at = NOW(), last_used_ip = ?, last_used_user_agent = ? WHERE id = ?',
    [String(req.ip || '').slice(0, 64), String(req.get?.('user-agent') || '').slice(0, 255), row.token_id]
  );
  return {
    tokenId: row.token_id,
    user: { id: row.user_id, email: row.email, username: row.username, role: String(row.role || 'staff').toLowerCase(), permissions: row.permissions, permission_boundary: scopes }
  };
}

module.exports = { authenticateApiToken, createApiToken, hashToken, isApiToken };
