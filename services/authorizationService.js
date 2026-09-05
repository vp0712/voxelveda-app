const pool = require('../config/db');
const { LEGACY_PERMISSION_MAP, PERMISSIONS, ROLE_TEMPLATES } = require('../config/permissionCatalog');

function parsePermissions(value) {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function canonicalPermission(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const upper = raw.toUpperCase();
  if (PERMISSIONS.includes(upper)) return [upper];
  return LEGACY_PERMISSION_MAP[raw.toLowerCase()] || [];
}

function effectivePermissions(user) {
  const role = String(user?.role || '').trim().toLowerCase();
  const grants = new Set(ROLE_TEMPLATES[role] || []);
  for (const value of parsePermissions(user?.permissions)) for (const permission of canonicalPermission(value)) grants.add(permission);
  return grants;
}

function hasPermission(user, permission) {
  return canonicalPermission(permission).some((required) => effectivePermissions(user).has(required));
}

function hasAnyPermission(user, permissions) {
  return (Array.isArray(permissions) ? permissions : [permissions]).some((permission) => hasPermission(user, permission));
}

async function isManagerOf(actorId, targetUserId, connection = pool) {
  if (!actorId || !targetUserId || Number(actorId) === Number(targetUserId)) return false;
  const [[row]] = await connection.query('SELECT id FROM users WHERE id = ? AND manager_id = ? AND active = 1 AND deleted_at IS NULL LIMIT 1', [targetUserId, actorId]);
  return Boolean(row);
}

async function canAccessUserRecord(user, targetUserId, options = {}) {
  if (Number(user?.id) === Number(targetUserId) && options.own && hasPermission(user, options.own)) return true;
  if (options.all && hasPermission(user, options.all)) return true;
  if (options.team && hasPermission(user, options.team) && await isManagerOf(user?.id, targetUserId, options.connection || pool)) return true;
  return false;
}

module.exports = { canAccessUserRecord, canonicalPermission, effectivePermissions, hasAnyPermission, hasPermission, isManagerOf, parsePermissions };
