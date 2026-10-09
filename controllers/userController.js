const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { ensureUserLifecycleSchema } = require('../services/userLifecycleService');
const { ensureCoreAuditSchema } = require('../services/coreAuditSchema');
const { logAudit } = require('../services/auditService');
const { ensureSecuritySchema } = require('../services/securitySchema');
const { revokeUserSessions, logSecurityEvent } = require('../services/sessionService');
const { issueToken, revokeUserActionTokens } = require('../services/authActionTokenService');
const { queueSecurityLink } = require('../services/securityEmailService');
const { HIGH_RISK_PERMISSIONS, PERMISSIONS, ROLE_TEMPLATES } = require('../config/permissionCatalog');
const { activePermissionProjection, canonicalPermission, hasPermission } = require('../services/authorizationService');
const { assertNoSegregationConflicts } = require('../services/segregationPolicyService');
const {
  ACCOUNT_STATES, permissionDifference, revokeEveryCredential, transitionAccount
} = require('../services/userSecurityService');

const PRIVILEGED_MFA_ROLES = new Set(['super_admin', 'admin', 'finance_admin', 'accountant', 'hr']);

const ALLOWED_ROLES = Object.keys(ROLE_TEMPLATES);

function parsePermissions(value) {
  return activePermissionProjection(value);
}

function rawPermissions(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function requestedPermissions(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !canonicalPermission(item).length)) {
    throw Object.assign(new Error('Permission list contains unavailable permissions.'), { statusCode: 400, code: 'PERMISSION_UNAVAILABLE' });
  }
  return parsePermissions(value);
}

function preserveArchivedPermissions(previous, active) {
  return [...rawPermissions(previous).filter((item) => !canonicalPermission(item).length), ...active];
}

function existingRoleOrAssignable(role, previous) {
  return ALLOWED_ROLES.includes(role) || role === normalizeRole(previous);
}

function normalizeRole(role) {
  return String(role || 'staff').trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function isSuperAdmin(req) {
  return normalizeRole(req.user?.role) === 'super_admin';
}

const RETIRED_EMPLOYMENT_FIELDS = new Set([
  'employee_number', 'department', 'manager_id', 'access_scope', 'employee_id',
  'employment_type', 'job_title', 'salary', 'hourly_rate', 'payroll', 'hire_date'
]);
function rejectRetiredEmploymentFields(body) {
  if (Object.keys(body || {}).some((key) => RETIRED_EMPLOYMENT_FIELDS.has(key))) {
    throw Object.assign(new Error('Employment fields are no longer available.'), { statusCode: 400, code: 'FIELD_UNAVAILABLE' });
  }
}
const ACCOUNT_DTO_FIELDS = [
  'id', 'user_uuid', 'name', 'username', 'email', 'role', 'active', 'account_status',
  'mfa_enabled', 'last_mfa_update_at', 'last_login_at', 'password_reset_required',
  'last_password_reset_at', 'created_at', 'last_password_change_at', 'last_security_review_at',
  'security_compromised_at', 'active_session_count'
];
function accountDto(row) {
  const dto = {};
  for (const key of ACCOUNT_DTO_FIELDS) if (Object.hasOwn(row, key)) dto[key] = row[key];
  dto.active = Number(row.active) !== 0;
  dto.permissions = parsePermissions(row.permissions);
  return dto;
}

function containsHighRiskPermission(permissions) {
  return permissions.some((permission) => canonicalPermission(permission).some((grant) => HIGH_RISK_PERMISSIONS.has(grant)));
}

function samePermissions(left, right) {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

async function assertRoleAuthority(req, targetUserId, requestedRole) {
  if (requestedRole === 'super_admin' && !isSuperAdmin(req)) return 'Only a super administrator can grant that role';
  if (Number(req.user.id) === Number(targetUserId) && requestedRole && requestedRole !== req.user.role) {
    return 'You cannot change your own role';
  }
  if (targetUserId) {
    const [[target]] = await pool.query('SELECT role FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1', [targetUserId]);
    if (normalizeRole(target?.role) === 'super_admin' && !isSuperAdmin(req)) return 'Only a super administrator can manage that account';
  }
  return null;
}

exports.createUser = async (req, res) => {
  try {
    rejectRetiredEmploymentFields(req.body);
    await ensureUserLifecycleSchema();
    await ensureSecuritySchema();
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const role = normalizeRole(req.body.role || 'staff');
    const username = String(req.body.username || email.split('@')[0] || '').trim().toLowerCase();
    const permissions = requestedPermissions(req.body.permissions);

    if (!name || !username || !email || !role) {
      return res.status(400).json({ message: 'Name, username, email and role are required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Valid email address is required' });
    }

    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }
    const authorityError = await assertRoleAuthority(req, null, role);
    if (authorityError) return res.status(403).json({ message: authorityError });
    if ((role !== 'staff' || permissions.length) && !hasPermission(req.user, 'MANAGE_ROLES')) {
      return res.status(403).json({ message: 'Role-management permission is required to assign roles or permission grants' });
    }
    if (!isSuperAdmin(req) && containsHighRiskPermission(permissions)) return res.status(403).json({ message: 'Only a super administrator can grant high-risk permissions' });
    try { await assertNoSegregationConflicts(role, permissions); } catch (error) { return res.status(error.statusCode || 500).json({ message: error.message, conflicts: error.conflicts || [] }); }

    const [existing] = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = ? OR LOWER(username) = ? LIMIT 1',
      [email, username]
    );

    if (existing.length) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const disabledPassword = await bcrypt.hash(crypto.randomBytes(48).toString('base64url'), 12);

    const [result] = await pool.query(
      `INSERT INTO users
       (name, username, email, password, role, permissions, active, password_reset_required)
       VALUES (?, ?, ?, ?, ?, ?, 0, 1)`,
      [name, username, email, disabledPassword, role, JSON.stringify(permissions)]
    );

    await pool.query(
      "UPDATE users SET account_status = 'INVITED', user_uuid = COALESCE(user_uuid, UUID()) WHERE id = ?",
      [result.insertId]
    );
    const inviteToken = await issueToken({ userId: result.insertId, type: 'INVITE', minutes: 1440, createdBy: req.user.id });
    let invitationDelivered = true;
    try {
      await queueSecurityLink({ user: { id: result.insertId, name, email }, token: inviteToken, type: 'INVITE', createdBy: req.user.id });
    } catch (deliveryError) {
      invitationDelivered = false;
      console.error('Invitation delivery failed:', deliveryError.message);
    }
    await logSecurityEvent({ actorId: req.user.id, targetUserId: result.insertId, eventType: 'USER_INVITED', req });

    res.status(invitationDelivered ? 200 : 202).json({
      message: invitationDelivered ? 'Secure invitation sent' : 'User created, but email delivery failed. Use Resend Invitation after checking SMTP.',
      invitation_delivered: invitationDelivered,
      user_id: result.insertId
    });
  } catch (error) {
    console.error('createUser error:', error);
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : 'Failed to create user',
      code: error.code,
      request_id: req.requestId || null
    });
  }
};

exports.getUsers = async (req, res) => {
  try {
    await ensureUserLifecycleSchema();
    await ensureSecuritySchema();
    const [rows] = await pool.query(
      `SELECT
        id,
        user_uuid,
        name,
        username,
        email,
        role,
        permissions,
        active,
        account_status,
        mfa_enabled,
        last_mfa_update_at,
        last_login_at,
        password_reset_required,
        last_password_reset_at
        ,created_at
        ,last_password_change_at
        ,last_security_review_at
        ,security_compromised_at
        ,(SELECT COUNT(*) FROM auth_sessions s WHERE s.user_id = users.id AND s.revoked_at IS NULL AND s.expires_at > NOW()) AS active_session_count
      FROM users
      WHERE deleted_at IS NULL
      ORDER BY id ASC`
    );

    res.json({
      users: rows.map(accountDto)
    });
  } catch (error) {
    console.error('getUsers error:', error);
    res.status(500).json({
      message: 'Failed to load users',
      request_id: req.requestId || null
    });
  }
};

exports.getPermissionCatalog = (req, res) => {
  res.json({
    permissions: PERMISSIONS,
    high_risk_permissions: [...HIGH_RISK_PERMISSIONS],
    role_templates: ROLE_TEMPLATES
  });
};

exports.previewPermissionDifference = async (req, res) => {
  try {
    rejectRetiredEmploymentFields(req.body);
    const userId = Number(req.params.id);
    const role = normalizeRole(req.body.role);
    const overrides = requestedPermissions(req.body.permissions);
    if (!userId) return res.status(400).json({ message: 'Valid user and role are required' });
    const [[target]] = await pool.query('SELECT role, permissions FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1', [userId]);
    if (!target) return res.status(404).json({ message: 'User not found' });
    if (!existingRoleOrAssignable(role, target.role)) return res.status(400).json({ message: 'This role is not available for assignment.' });
    const authorityError = await assertRoleAuthority(req, userId, role);
    if (authorityError) return res.status(403).json({ message: authorityError });
    const previous = [...new Set([...(ROLE_TEMPLATES[normalizeRole(target.role)] || []), ...parsePermissions(target.permissions)])];
    const proposed = [...new Set([...(ROLE_TEMPLATES[role] || []), ...overrides])];
    return res.json({ current_role: normalizeRole(target.role), proposed_role: role, ...permissionDifference(previous, proposed), high_risk_added: permissionDifference(previous, proposed).added.filter((item) => HIGH_RISK_PERMISSIONS.has(item)) });
  } catch (error) {
    console.error('previewPermissionDifference error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Unable to preview access change', code: error.code });
  }
};

exports.updateUserAccess = async (req, res) => {
  try {
    rejectRetiredEmploymentFields(req.body);
    await ensureUserLifecycleSchema();
    await ensureSecuritySchema();
    const userId = Number(req.params.id);
    if (typeof req.body.role !== 'string' || typeof req.body.active !== 'boolean' || !Array.isArray(req.body.permissions)) {
      return res.status(400).json({ message: 'Role, account status and permission list are required' });
    }
    const role = normalizeRole(req.body.role || 'staff');
    const active = Boolean(req.body.active);
    const permissions = requestedPermissions(req.body.permissions);
    const reason = String(req.body.reason || '').trim().slice(0, 255);
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }
    if (!reason) return res.status(400).json({ message: 'A reason is required for access changes' });
    if (!hasPermission(req.user, 'MANAGE_ROLES')) {
      return res.status(403).json({ message: 'Role-management permission is required for access changes' });
    }
    const authorityError = await assertRoleAuthority(req, userId, role);
    if (authorityError) return res.status(403).json({ message: authorityError });
    if (Number(req.user.id) === userId) return res.status(403).json({ message: 'You cannot modify your own role or permissions' });
    if (req.body.permissions !== undefined && !isSuperAdmin(req) && containsHighRiskPermission(permissions)) return res.status(403).json({ message: 'Only a super administrator can grant high-risk permissions' });
    try { await assertNoSegregationConflicts(role, permissions); } catch (error) { return res.status(error.statusCode || 500).json({ message: error.message, conflicts: error.conflicts || [] }); }

    if (Number(req.user.id) === userId && active === false) {
      return res.status(400).json({ message: 'You cannot disable your own account' });
    }

    const [[before]] = await pool.query(
      'SELECT role, permissions, active, mfa_enabled, account_status FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [userId]
    );
    if (!before) return res.status(404).json({ message: 'User not found' });
    if (!existingRoleOrAssignable(role, before.role)) return res.status(400).json({ message: 'This role is not available for assignment.' });
    const storedRole = role === normalizeRole(before.role) ? before.role : role;
    const storedPermissions = preserveArchivedPermissions(before.permissions, permissions);
    const accessDifference = permissionDifference(
      [...new Set([...(ROLE_TEMPLATES[normalizeRole(before.role)] || []), ...parsePermissions(before.permissions)])],
      [...new Set([...(ROLE_TEMPLATES[role] || []), ...permissions])]
    );

    const [result] = await pool.query(
      `UPDATE users
       SET role = ?, permissions = ?, active = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [storedRole, JSON.stringify(storedPermissions), active ? 1 : 0, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    await revokeUserSessions(userId, 'ACCESS_CHANGED');
    if (!active) await revokeEveryCredential(pool, userId, 'ACCESS_DISABLED');
    const nextAccountStatus = !active
      ? 'DISABLED'
      : (before.account_status === 'INVITED' ? 'INVITED' : (PRIVILEGED_MFA_ROLES.has(role) && Number(before.mfa_enabled) !== 1 ? 'MFA_SETUP_REQUIRED' : 'ACTIVE'));
    await pool.query('UPDATE users SET session_version = session_version + 1, account_status = ? WHERE id = ?', [nextAccountStatus, userId]);
    await logSecurityEvent({ actorId: req.user.id, targetUserId: userId, eventType: 'ROLE_OR_PERMISSION_CHANGED', req });
    await logAudit(pool, {
      actorId: req.user.id,
      action: 'USER_ACCESS_CHANGED',
      module: 'security',
      recordType: 'user',
      recordId: userId,
      oldValue: { role: before.role, permissions: parsePermissions(before.permissions), active: Boolean(before.active) },
      newValue: { role, permissions, active, reason },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({ message: 'User access updated successfully', permission_difference: accessDifference });
  } catch (error) {
    console.error('updateUserAccess error:', error);
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : 'Failed to update access',
      code: error.code,
      request_id: req.requestId || null
    });
  }
};

exports.changeAccountState = async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const state = String(req.body.state || '').toUpperCase();
    const reason = String(req.body.reason || '').trim().slice(0, 500);
    if (!userId || !ACCOUNT_STATES.includes(state)) return res.status(400).json({ message: 'Valid user and account state are required' });
    if (Number(req.user.id) === userId) return res.status(403).json({ message: 'You cannot change your own account state' });
    const [[target]] = await pool.query('SELECT role FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1', [userId]);
    if (!target) return res.status(404).json({ message: 'User not found' });
    const authorityError = await assertRoleAuthority(req, userId, target.role);
    if (authorityError) return res.status(403).json({ message: authorityError });
    if (normalizeRole(target.role) === 'super_admin' && ['LOCKED', 'SUSPENDED', 'DISABLED', 'TERMINATED'].includes(state)) {
      const [[remaining]] = await pool.query("SELECT COUNT(*) AS total FROM users WHERE role = 'super_admin' AND active = 1 AND deleted_at IS NULL");
      if (Number(remaining.total || 0) <= 1) return res.status(409).json({ message: 'The last active super administrator cannot be disabled or terminated' });
    }
    if (state === 'TERMINATED' && !hasPermission(req.user, 'MANAGE_ROLES')) return res.status(403).json({ message: 'Role-management permission is required to terminate access' });
    const result = await transitionAccount({
      actorId: req.user.id, targetUserId: userId, state, reason, req,
      transferToUserId: Number(req.body.transfer_to_user_id || 0) || null
    });
    await logSecurityEvent({ actorId: req.user.id, targetUserId: userId, eventType: `USER_${state}`, req, metadata: { previous_state: result.before.account_status, reason } });
    return res.json({ message: `Account state changed to ${state}.`, state, sessions_revoked: state !== 'ACTIVE', ownership_transfers: result.ownershipTransfers });
  } catch (error) {
    console.error('changeAccountState error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Account state could not be changed', code: error.code, ownership_counts: error.ownershipCounts });
  }
};

exports.markAccountCompromised = async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const reason = String(req.body.reason || '').trim().slice(0, 500);
    if (!userId || !reason) return res.status(400).json({ message: 'User and incident reason are required' });
    if (Number(req.user.id) === userId) return res.status(403).json({ message: 'Use another authorised administrator for your own compromised account' });
    const [[target]] = await pool.query('SELECT role FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1', [userId]);
    if (!target) return res.status(404).json({ message: 'User not found' });
    const authorityError = await assertRoleAuthority(req, userId, target.role);
    if (authorityError) return res.status(403).json({ message: authorityError });
    await transitionAccount({ actorId: req.user.id, targetUserId: userId, state: 'LOCKED', reason, req, compromised: true });
    await logSecurityEvent({ actorId: req.user.id, targetUserId: userId, eventType: 'ACCOUNT_COMPROMISED', req, metadata: { reason } });
    return res.json({ message: 'Account locked. Sessions, action tokens, API tokens, trusted devices, MFA and recovery codes were revoked.' });
  } catch (error) {
    console.error('markAccountCompromised error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Compromised-account response failed' });
  }
};

exports.revokeInvitation = async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const reason = String(req.body.reason || '').trim().slice(0, 500);
    if (!userId || !reason) return res.status(400).json({ message: 'User and reason are required' });
    const [[user]] = await pool.query('SELECT role, account_status FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1', [userId]);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const authorityError = await assertRoleAuthority(req, userId, user.role);
    if (authorityError) return res.status(403).json({ message: authorityError });
    if (user.account_status !== 'INVITED') return res.status(409).json({ message: 'This account does not have a pending invitation' });
    await revokeUserActionTokens(userId);
    await transitionAccount({ actorId: req.user.id, targetUserId: userId, state: 'DISABLED', reason, req });
    await logSecurityEvent({ actorId: req.user.id, targetUserId: userId, eventType: 'INVITATION_REVOKED', req, metadata: { reason } });
    return res.json({ message: 'Invitation revoked and account disabled.' });
  } catch (error) {
    console.error('revokeInvitation error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Invitation could not be revoked' });
  }
};

exports.forceRevokeSessions = async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const reason = String(req.body.reason || '').trim().slice(0, 500);
    if (!userId || !reason) return res.status(400).json({ message: 'User and reason are required' });
    const [[target]] = await pool.query('SELECT role FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1', [userId]);
    if (!target) return res.status(404).json({ message: 'User not found' });
    const authorityError = await assertRoleAuthority(req, userId, target.role);
    if (authorityError) return res.status(403).json({ message: authorityError });
    await revokeUserSessions(userId, 'ADMIN_REVOKED');
    await pool.query('UPDATE users SET session_version = session_version + 1 WHERE id = ?', [userId]);
    await logSecurityEvent({ actorId: req.user.id, targetUserId: userId, eventType: 'SESSION_REVOKED', req, metadata: { reason } });
    return res.json({ message: 'All active sessions were revoked.' });
  } catch (error) {
    console.error('forceRevokeSessions error:', error.message);
    return res.status(500).json({ message: 'Sessions could not be revoked' });
  }
};

exports.completeAccessReview = async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const decision = String(req.body.decision || '').trim().toUpperCase();
    const reason = String(req.body.reason || '').trim().slice(0, 500);
    if (!userId || !['APPROVED', 'CHANGES_REQUIRED'].includes(decision) || !reason) return res.status(400).json({ message: 'Decision and review reason are required' });
    if (Number(req.user.id) === userId) return res.status(403).json({ message: 'Privileged users cannot approve their own access review' });
    const [[target]] = await pool.query('SELECT role, permissions FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1', [userId]);
    if (!target) return res.status(404).json({ message: 'User not found' });
    if (!['super_admin', 'admin', 'finance_admin', 'accountant', 'hr'].includes(normalizeRole(target.role))) return res.status(409).json({ message: 'Access reviews are reserved for privileged accounts' });
    const authorityError = await assertRoleAuthority(req, userId, target.role);
    if (authorityError) return res.status(403).json({ message: authorityError });
    await pool.query(
      'INSERT INTO privileged_access_reviews (user_id, reviewer_id, role_snapshot, permissions_snapshot, decision, reason) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, req.user.id, normalizeRole(target.role), JSON.stringify(parsePermissions(target.permissions)), decision, reason]
    );
    await pool.query('UPDATE users SET last_security_review_at = NOW() WHERE id = ?', [userId]);
    await logSecurityEvent({ actorId: req.user.id, targetUserId: userId, eventType: 'PRIVILEGED_ACCESS_REVIEWED', req, metadata: { decision, reason } });
    return res.json({ message: 'Privileged access review recorded.', decision });
  } catch (error) {
    console.error('completeAccessReview error:', error.message);
    return res.status(500).json({ message: 'Access review could not be recorded' });
  }
};

exports.updateUser = async (req, res) => {
  try {
    rejectRetiredEmploymentFields(req.body);
    await ensureUserLifecycleSchema();
    await ensureSecuritySchema();
    const userId = Number(req.params.id);
    const name = String(req.body.name || '').trim();
    const username = String(req.body.username || '').trim().toLowerCase();
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    const [[before]] = await pool.query(
      'SELECT name, username, email, role, permissions, active, mfa_enabled, account_status FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [userId]
    );
    if (!before) return res.status(404).json({ message: 'User not found' });

    const role = normalizeRole(req.body.role === undefined ? before.role : req.body.role);
    const active = req.body.active === undefined ? Boolean(before.active) : Boolean(req.body.active);
    const permissions = req.body.permissions === undefined ? parsePermissions(before.permissions) : requestedPermissions(req.body.permissions);
    const storedPermissionsJson = req.body.permissions === undefined
      ? (typeof before.permissions === 'string' ? before.permissions : JSON.stringify(rawPermissions(before.permissions)))
      : JSON.stringify(preserveArchivedPermissions(before.permissions, permissions));
    const storedRole = role === normalizeRole(before.role) ? before.role : role;
    const reason = String(req.body.reason || '').trim().slice(0, 255);
    const accessChanged = role !== normalizeRole(before.role)
      || active !== Boolean(before.active)
      || !samePermissions(permissions, parsePermissions(before.permissions));
    if (accessChanged && !reason) {
      return res.status(400).json({ message: 'A reason is required when role, permissions or account status changes' });
    }
    if (accessChanged && !hasPermission(req.user, 'MANAGE_ROLES')) {
      return res.status(403).json({ message: 'Role-management permission is required for access changes' });
    }
    const authorityError = await assertRoleAuthority(req, userId, role);
    if (authorityError) return res.status(403).json({ message: authorityError });
    if (Number(req.user.id) === userId && (
      req.body.role !== undefined || req.body.permissions !== undefined || req.body.active !== undefined
    )) {
      return res.status(403).json({ message: 'You cannot modify your own role, permissions or account status' });
    }
    if (req.body.permissions !== undefined && !isSuperAdmin(req) && containsHighRiskPermission(permissions)) return res.status(403).json({ message: 'Only a super administrator can grant high-risk permissions' });
    try { await assertNoSegregationConflicts(role, permissions); } catch (error) { return res.status(error.statusCode || 500).json({ message: error.message, conflicts: error.conflicts || [] }); }

    if (!name || !username || !email || !role) {
      return res.status(400).json({ message: 'Name, username, email and role are required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Valid email address is required' });
    }

    if (Number(req.user.id) === userId && active === false) {
      return res.status(400).json({ message: 'You cannot disable your own account' });
    }

    if (!existingRoleOrAssignable(role, before.role)) return res.status(400).json({ message: 'This role is not available for assignment.' });

    const [existing] = await pool.query(
      'SELECT id FROM users WHERE (LOWER(email) = ? OR LOWER(username) = ?) AND id <> ? LIMIT 1',
      [email, username, userId]
    );

    if (existing.length) {
      return res.status(400).json({ message: 'Email or username is already used by another account' });
    }

    const [result] = await pool.query(
      `UPDATE users
       SET name = ?,
           username = ?,
           email = ?,
           role = ?,
           permissions = ?,
           active = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [name, username, email, storedRole, storedPermissionsJson, active ? 1 : 0, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    await revokeUserSessions(userId, 'ACCOUNT_CHANGED');
    if (!active) await revokeEveryCredential(pool, userId, 'ACCESS_DISABLED');
    const nextAccountStatus = !active
      ? 'DISABLED'
      : (before.account_status === 'INVITED' ? 'INVITED' : (PRIVILEGED_MFA_ROLES.has(role) && Number(before.mfa_enabled) !== 1 ? 'MFA_SETUP_REQUIRED' : 'ACTIVE'));
    await pool.query('UPDATE users SET session_version = session_version + 1, account_status = ? WHERE id = ?', [nextAccountStatus, userId]);
    await logAudit(pool, {
      actorId: req.user.id,
      action: 'USER_RECORD_CHANGED',
      module: 'security',
      recordType: 'user',
      recordId: userId,
      oldValue: accountDto(before),
      newValue: { name, username, email, role, permissions, active, reason: reason || null },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({ message: 'Account details updated successfully' });
  } catch (error) {
    console.error('updateUser error:', error);
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : 'Failed to update account details',
      code: error.code,
      request_id: req.requestId || null
    });
  }
};

exports.resetUserPassword = async (req, res) => {
  try {
    await ensureUserLifecycleSchema();
    await ensureSecuritySchema();
    const userId = Number(req.params.id);
    const reason = String(req.body.reason || '').trim().slice(0, 500);
    if (!userId || reason.length < 10) return res.status(400).json({ message: 'User ID and a detailed reset reason are required' });

    const [[targetUser]] = await pool.query('SELECT id, name, username, email, role, account_status FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1', [userId]);
    if (!targetUser) return res.status(404).json({ message: 'User not found' });
    if (['SUSPENDED', 'DISABLED', 'TERMINATED'].includes(String(targetUser.account_status || '').toUpperCase())) {
      return res.status(409).json({ message: 'Enable and review this account before resetting its password' });
    }
    const authorityError = await assertRoleAuthority(req, userId, targetUser.role);
    if (authorityError) return res.status(403).json({ message: authorityError });
    const [result] = await pool.query(
      `UPDATE users
       SET password_reset_required = 1,
           last_password_reset_at = NOW(),
           session_version = session_version + 1,
           account_status = 'PASSWORD_RESET_REQUIRED'
       WHERE id = ? AND deleted_at IS NULL`,
      [userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    await revokeUserSessions(userId, 'PASSWORD_RESET');
    const resetToken = await issueToken({ userId, type: 'PASSWORD_RESET', minutes: 30, createdBy: req.user.id });
    await queueSecurityLink({ user: targetUser, token: resetToken, type: 'PASSWORD_RESET', createdBy: req.user.id });
    await logSecurityEvent({ actorId: req.user.id, targetUserId: userId, eventType: 'PASSWORD_RESET', req, metadata: { reason } });
    await logAudit(pool, {
      actorId: req.user.id, action: 'ADMIN_PASSWORD_RESET_REQUESTED', module: 'security', recordType: 'user', recordId: userId,
      newValue: { reason }, ipAddress: req.ip, userAgent: req.get('user-agent'), requestId: req.requestId,
      sessionId: req.session?.id, metadata: { delivery: 'single_use_link' }
    });

    res.json({
      message: 'Secure password-reset link queued. Existing sessions were revoked.'
    });
  } catch (error) {
    console.error('resetUserPassword error:', error);
    res.status(500).json({
      message: 'Failed to reset password',
      request_id: req.requestId || null
    });
  }
};

exports.resendUserInvitation = async (req, res) => {
  try {
    await ensureSecuritySchema();
    const userId = Number(req.params.id);
    const reason = String(req.body.reason || '').trim().slice(0, 500);
    if (!userId || reason.length < 10) return res.status(400).json({ message: 'User ID and a detailed reissue reason are required' });
    const [[user]] = await pool.query(
      `SELECT id, name, email, role, account_status FROM users
       WHERE id = ? AND deleted_at IS NULL LIMIT 1`, [userId]
    );
    if (!user) return res.status(404).json({ message: 'User not found' });
    const authorityError = await assertRoleAuthority(req, userId, user.role);
    if (authorityError) return res.status(403).json({ message: authorityError });
    if (user.account_status !== 'INVITED') return res.status(409).json({ message: 'Only invited accounts can receive a replacement invitation' });
    const token = await issueToken({ userId, type: 'INVITE', minutes: 1440, createdBy: req.user.id });
    await queueSecurityLink({ user, token, type: 'INVITE', createdBy: req.user.id });
    await logSecurityEvent({ actorId: req.user.id, targetUserId: userId, eventType: 'INVITATION_REISSUED', req, metadata: { reason } });
    await logAudit(pool, {
      actorId: req.user.id, action: 'INVITATION_REISSUED', module: 'security', recordType: 'user', recordId: userId,
      newValue: { reason }, ipAddress: req.ip, userAgent: req.get('user-agent'), requestId: req.requestId,
      sessionId: req.session?.id, metadata: { delivery: 'single_use_link' }
    });
    return res.json({ message: 'A new invitation was queued; the previous link is no longer valid.' });
  } catch (error) {
    console.error('resendUserInvitation error:', error.message);
    return res.status(500).json({ message: 'Unable to resend invitation' });
  }
};

exports.deleteUser = async (req, res) => {
  const userId = Number(req.params.id);
  const reason = String(req.body?.reason || 'Removed by administrator').trim().slice(0, 255);

  if (!userId) {
    return res.status(400).json({ message: 'User ID is required' });
  }

  if (Number(req.user.id) === userId) {
    return res.status(400).json({ message: 'You cannot delete your own account' });
  }

  let connection;
  try {
    await ensureUserLifecycleSchema();
    await ensureSecuritySchema();
    await ensureCoreAuditSchema();
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [[target]] = await connection.query(
      `SELECT id, role, active
       FROM users
       WHERE id = ? AND deleted_at IS NULL
       FOR UPDATE`,
      [userId]
    );

    if (!target) {
      await connection.rollback();
      return res.status(404).json({ message: 'User account not found' });
    }

    if (target.role === 'super_admin' && !isSuperAdmin(req)) {
      await connection.rollback();
      return res.status(403).json({ message: 'Only a super administrator can manage that account' });
    }

    if (String(target.role || '').toLowerCase() !== 'staff' && !hasPermission(req.user, 'MANAGE_ROLES')) {
      await connection.rollback();
      return res.status(403).json({ message: 'Role-management permission is required to terminate this account' });
    }

    if (String(target.role || '').toLowerCase() === 'admin') {
      const [[adminCount]] = await connection.query(
        `SELECT COUNT(*) AS total
         FROM users
         WHERE role = 'admin' AND active = 1 AND deleted_at IS NULL`
      );
      if (Number(adminCount.total || 0) <= 1) {
        await connection.rollback();
        return res.status(409).json({ message: 'The last active admin account cannot be deleted' });
      }
    }

    const deletionToken = `${userId}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
    const disabledPassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);

    await connection.query(
      `UPDATE users
       SET name = ?,
           username = ?,
           email = ?,
           password = ?,
           permissions = '[]',
           active = 0,
           password_reset_required = 0,
           deleted_at = NOW(),
           deleted_by = ?,
           deletion_reason = ?
       WHERE id = ?`,
      [
        `Deleted User #${userId}`,
        `deleted_${deletionToken}`,
        `deleted+${deletionToken}@removed.voxelveda.invalid`,
        disabledPassword,
        req.user.id,
        reason || 'Removed by administrator',
        userId
      ]
    );

    await logAudit(connection, {
      actorId: req.user.id,
      action: 'USER_ACCOUNT_DELETED',
      module: 'security',
      recordType: 'user',
      recordId: userId,
      oldValue: { active: Number(target.active) !== 0, role: target.role },
      newValue: { active: false, deleted: true },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    await connection.commit();
    await revokeUserSessions(userId, 'ACCOUNT_TERMINATED');
    await revokeUserActionTokens(userId);
    await logSecurityEvent({ actorId: req.user.id, targetUserId: userId, eventType: 'USER_TERMINATED', req });
    return res.json({
      message: 'User account deleted. Login access was removed and historical records were preserved.'
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('deleteUser error:', error);
    return res.status(500).json({ message: 'Failed to delete user account' });
  } finally {
    connection?.release();
  }
};
