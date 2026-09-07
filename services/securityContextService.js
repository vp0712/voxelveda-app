const crypto = require('crypto');
const pool = require('../config/db');
const { ensureSecurityGovernanceSchema } = require('./securityGovernanceSchema');

const hashToken = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const IMPERSONATION_HEADER = 'x-impersonation-context';
const BLOCKED_IMPERSONATION_PREFIXES = [
  '/api/high-risk-finance', '/api/finance', '/api/security', '/api/users',
  '/api/settings', '/api/email', '/api/integrations'
];

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

async function loadBreakGlassPermissions(userId) {
  await ensureSecurityGovernanceSchema();
  const [rows] = await pool.query(
    `SELECT id,permissions_json,expires_at FROM break_glass_requests
     WHERE beneficiary_user_id=? AND status='ACTIVE' AND activated_at IS NOT NULL AND expires_at>NOW()
     ORDER BY expires_at ASC`, [userId]
  );
  return {
    requestIds: rows.map((row) => row.id),
    permissions: [...new Set(rows.flatMap((row) => parseJsonArray(row.permissions_json)))],
    expiresAt: rows.length ? rows[0].expires_at : null
  };
}

async function resolveImpersonation(req, actorUser, session) {
  const token = String(req.headers[IMPERSONATION_HEADER] || '').trim();
  if (!token) return null;
  if (!session?.id || req.authType === 'api_token') {
    throw Object.assign(new Error('Impersonation requires an interactive authenticated session'), { statusCode: 403, code: 'IMPERSONATION_SESSION_REQUIRED' });
  }
  if (!['GET', 'HEAD'].includes(req.method)) {
    throw Object.assign(new Error('Impersonation is strictly read-only'), { statusCode: 403, code: 'IMPERSONATION_READ_ONLY' });
  }
  const originalPath = String(req.originalUrl || req.path || '').split('?')[0];
  if (BLOCKED_IMPERSONATION_PREFIXES.some((prefix) => originalPath === prefix || originalPath.startsWith(`${prefix}/`))) {
    throw Object.assign(new Error('This resource is unavailable during impersonation'), { statusCode: 403, code: 'IMPERSONATION_RESOURCE_RESTRICTED' });
  }
  await ensureSecurityGovernanceSchema();
  const [[context]] = await pool.query(
    `SELECT ic.id,ic.actor_user_id,ic.target_user_id,ic.expires_at,
            u.email,u.username,u.role,u.permissions,u.active,u.account_status,u.mfa_enabled
     FROM impersonation_contexts ic JOIN users u ON u.id=ic.target_user_id
     WHERE ic.context_token_hash=? AND ic.actor_user_id=? AND ic.actor_session_id=?
       AND ic.status='ACTIVE' AND ic.ended_at IS NULL AND ic.expires_at>NOW()
       AND u.active=1 AND u.deleted_at IS NULL LIMIT 1`,
    [hashToken(token), actorUser.id, session.id]
  );
  if (!context || String(context.role).toLowerCase() === 'super_admin') {
    throw Object.assign(new Error('Impersonation context is invalid or expired'), { statusCode: 403, code: 'IMPERSONATION_INVALID' });
  }
  return context;
}

module.exports = {
  BLOCKED_IMPERSONATION_PREFIXES,
  IMPERSONATION_HEADER,
  hashToken,
  loadBreakGlassPermissions,
  parseJsonArray,
  resolveImpersonation
};
