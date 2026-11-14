const { LEGACY_PERMISSION_MAP, PERMISSIONS, ROLE_TEMPLATES, TIMESHEET_PERMISSION_ALIASES } = require('../config/permissionCatalog');

const timesheetEquivalents = new Map(Object.entries(TIMESHEET_PERMISSION_ALIASES).flatMap(([previous, current]) => [
  [previous, Object.freeze([current, previous])],
  [current, Object.freeze([current, previous])]
]));

function parsePermissions(value) {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function canonicalPermission(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const upper = raw.toUpperCase();
  if (PERMISSIONS.includes(upper)) return timesheetEquivalents.get(upper) || [upper];
  const legacyKey = raw.toLowerCase();
  return Object.hasOwn(LEGACY_PERMISSION_MAP, legacyKey) ? LEGACY_PERMISSION_MAP[legacyKey] : [];
}

function activePermissionProjection(value) {
  return [...new Set(parsePermissions(value).flatMap(canonicalPermission))];
}

function effectivePermissions(user) {
  const role = String(user?.role || '').trim().toLowerCase();
  const grants = new Set((ROLE_TEMPLATES[role] || []).flatMap(canonicalPermission));
  for (const value of parsePermissions(user?.permissions)) for (const permission of canonicalPermission(value)) grants.add(permission);
  for (const value of parsePermissions(user?.temporary_permissions)) for (const permission of canonicalPermission(value)) grants.add(permission);
  for (const value of parsePermissions(user?.break_glass_permissions)) for (const permission of canonicalPermission(value)) grants.add(permission);
  const boundary = parsePermissions(user?.permission_boundary);
  if (!boundary.length) return grants;
  const allowed = new Set(boundary.flatMap(canonicalPermission));
  return new Set([...grants].filter((permission) => allowed.has(permission)));
}

function hasPermission(user, permission) {
  return canonicalPermission(permission).some((required) => effectivePermissions(user).has(required));
}

function hasAnyPermission(user, permissions) {
  return (Array.isArray(permissions) ? permissions : [permissions]).some((permission) => hasPermission(user, permission));
}

async function isManagerOf(actorId, targetUserId, connection = null) {
  if (!actorId || !targetUserId || Number(actorId) === Number(targetUserId)) return false;
  const db = connection || require('../config/db');
  const [[row]] = await db.query('SELECT id FROM users WHERE id = ? AND manager_id = ? AND active = 1 AND deleted_at IS NULL LIMIT 1', [targetUserId, actorId]);
  return Boolean(row);
}

async function canAccessUserRecord(user, targetUserId, options = {}) {
  if (Number(user?.id) === Number(targetUserId) && options.own && hasPermission(user, options.own)) return true;
  if (options.all && hasPermission(user, options.all)) return true;
  if (options.team && hasPermission(user, options.team) && await isManagerOf(user?.id, targetUserId, options.connection || null)) return true;
  return false;
}

// Employee read access and ordinary clock permissions never authorize an edit.
// Resolve team membership on the same transaction connection used by the write.
async function canEditTimesheetRecord(user, targetUserId, connection = null) {
  const actorId = Number(user?.id), staffId = Number(targetUserId);
  if (!Number.isSafeInteger(actorId) || actorId < 1 || !Number.isSafeInteger(staffId) || staffId < 1 || actorId === staffId) return false;
  return canAccessUserRecord(user, staffId, {
    team: 'EDIT_TEAM_TIMESHEET', all: 'EDIT_ALL_TIMESHEETS', connection
  });
}

module.exports = { activePermissionProjection, canAccessUserRecord, canEditTimesheetRecord, canonicalPermission, effectivePermissions, hasAnyPermission, hasPermission, isManagerOf, parsePermissions };
