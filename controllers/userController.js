const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { ensureUserLifecycleSchema } = require('../services/userLifecycleService');
const { ensureWorkforceSchema } = require('../services/workforceSchema');
const { logAudit } = require('../services/auditService');
const { ensureSecuritySchema } = require('../services/securitySchema');
const { revokeUserSessions, logSecurityEvent } = require('../services/sessionService');
const { issueToken, revokeUserActionTokens } = require('../services/authActionTokenService');
const { queueSecurityLink } = require('../services/securityEmailService');

const ALLOWED_ROLES = [
  'admin', 'super_admin', 'finance_admin', 'finance_user', 'accountant',
  'manager', 'sales', 'production', 'viewer', 'view_only', 'staff'
];

const ALL_PERMISSIONS = [
  'dashboard',
  'rfqs',
  'rfqs_input',
  'invoices',
  'invoices_input',
  'customers',
  'customers_input',
  'tasks',
  'tasks_input',
  'roster',
  'roster_input',
  'attendance',
  'attendance_input',
  'attendance_qr_bypass',
  'staff',
  'settings',
  'stock',
  'stock_in',
  'stock_in_input',
  'stock_out',
  'stock_out_input',
  'raw_material',
  'raw_material_input',
  'packaging',
  'packaging_input',
  'meetings',
  'meetings_input',
  'suppliers',
  'suppliers_input',
  'expenses',
  'expenses_input',
  'compliance',
  'compliance_input',
  'competitors',
  'competitors_input',
  'finance',
  'finance_input',
  'finance_setup',
  'finance_post_transaction',
  'finance_create_journal',
  'finance_lock_period',
  'finance_reconcile',
  'finance_export',
  'finance_view_payroll',
  'finance_void'
];

function parsePermissions(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((item) => ALL_PERMISSIONS.includes(item));

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => ALL_PERMISSIONS.includes(item)) : [];
  } catch {
    return [];
  }
}

function normalizeRole(role) {
  return String(role || 'staff').trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function isSuperAdmin(req) {
  return String(req.user?.role || '').toLowerCase() === 'super_admin';
}

async function assertRoleAuthority(req, targetUserId, requestedRole) {
  if (requestedRole === 'super_admin' && !isSuperAdmin(req)) return 'Only a super administrator can grant that role';
  if (Number(req.user.id) === Number(targetUserId) && requestedRole && requestedRole !== req.user.role) {
    return 'You cannot change your own role';
  }
  if (targetUserId) {
    const [[target]] = await pool.query('SELECT role FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1', [targetUserId]);
    if (target?.role === 'super_admin' && !isSuperAdmin(req)) return 'Only a super administrator can manage that account';
  }
  return null;
}

exports.createUser = async (req, res) => {
  try {
    await ensureUserLifecycleSchema();
    await ensureSecuritySchema();
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const role = normalizeRole(req.body.role || 'staff');
    const username = String(req.body.username || email.split('@')[0] || '').trim().toLowerCase();
    const permissions = parsePermissions(req.body.permissions);

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

    await pool.query("UPDATE users SET account_status = 'INVITED' WHERE id = ?", [result.insertId]);
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
    res.status(500).json({
      message: 'Failed to create user',
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
      FROM users
      WHERE deleted_at IS NULL
      ORDER BY id ASC`
    );

    res.json({
      users: rows.map((row) => ({
        ...row,
        active: Number(row.active) !== 0,
        permissions: parsePermissions(row.permissions)
      }))
    });
  } catch (error) {
    console.error('getUsers error:', error);
    res.status(500).json({
      message: 'Failed to load users',
      request_id: req.requestId || null
    });
  }
};

exports.updateUserAccess = async (req, res) => {
  try {
    await ensureUserLifecycleSchema();
    await ensureSecuritySchema();
    const userId = Number(req.params.id);
    const role = normalizeRole(req.body.role || 'staff');
    const active = req.body.active === undefined ? true : Boolean(req.body.active);
    const permissions = parsePermissions(req.body.permissions);
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }
    const authorityError = await assertRoleAuthority(req, userId, role);
    if (authorityError) return res.status(403).json({ message: authorityError });

    if (Number(req.user.id) === userId && active === false) {
      return res.status(400).json({ message: 'You cannot disable your own account' });
    }

    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const [result] = await pool.query(
      `UPDATE users
       SET role = ?, permissions = ?, active = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [role, JSON.stringify(permissions), active ? 1 : 0, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    await revokeUserSessions(userId, 'ACCESS_CHANGED');
    if (!active) await revokeUserActionTokens(userId);
    await pool.query("UPDATE users SET session_version = session_version + 1, account_status = CASE WHEN account_status = 'INVITED' AND ? = 1 THEN 'INVITED' ELSE ? END WHERE id = ?", [active ? 1 : 0, active ? 'ACTIVE' : 'DISABLED', userId]);
    await logSecurityEvent({ actorId: req.user.id, targetUserId: userId, eventType: 'ROLE_OR_PERMISSION_CHANGED', req });

    res.json({ message: 'User access updated successfully' });
  } catch (error) {
    console.error('updateUserAccess error:', error);
    res.status(500).json({
      message: 'Failed to update access',
      request_id: req.requestId || null
    });
  }
};

exports.updateUser = async (req, res) => {
  try {
    await ensureUserLifecycleSchema();
    await ensureSecuritySchema();
    const userId = Number(req.params.id);
    const name = String(req.body.name || '').trim();
    const username = String(req.body.username || '').trim().toLowerCase();
    const email = String(req.body.email || '').trim().toLowerCase();
    const role = normalizeRole(req.body.role || 'staff');
    const active = req.body.active === undefined ? true : Boolean(req.body.active);
    const permissions = parsePermissions(req.body.permissions);
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }
    const authorityError = await assertRoleAuthority(req, userId, role);
    if (authorityError) return res.status(403).json({ message: authorityError });

    if (!name || !username || !email || !role) {
      return res.status(400).json({ message: 'Name, username, email and role are required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Valid email address is required' });
    }

    if (Number(req.user.id) === userId && active === false) {
      return res.status(400).json({ message: 'You cannot disable your own account' });
    }

    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM users WHERE (LOWER(email) = ? OR LOWER(username) = ?) AND id <> ? LIMIT 1',
      [email, username, userId]
    );

    if (existing.length) {
      return res.status(400).json({ message: 'Email or username is already used by another staff member' });
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
      [name, username, email, role, JSON.stringify(permissions), active ? 1 : 0, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    await revokeUserSessions(userId, 'ACCOUNT_CHANGED');
    if (!active) await revokeUserActionTokens(userId);
    await pool.query("UPDATE users SET session_version = session_version + 1, account_status = CASE WHEN account_status = 'INVITED' AND ? = 1 THEN 'INVITED' ELSE ? END WHERE id = ?", [active ? 1 : 0, active ? 'ACTIVE' : 'DISABLED', userId]);

    res.json({ message: 'Staff details updated successfully' });
  } catch (error) {
    console.error('updateUser error:', error);
    res.status(500).json({
      message: 'Failed to update staff details',
      request_id: req.requestId || null
    });
  }
};

exports.resetUserPassword = async (req, res) => {
  try {
    await ensureUserLifecycleSchema();
    await ensureSecuritySchema();
    const userId = Number(req.params.id);
    if (!userId) return res.status(400).json({ message: 'User ID is required' });

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
    await logSecurityEvent({ actorId: req.user.id, targetUserId: userId, eventType: 'PASSWORD_RESET', req });

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
    await logSecurityEvent({ actorId: req.user.id, targetUserId: userId, eventType: 'INVITATION_REISSUED', req });
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
    await ensureWorkforceSchema();
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
      module: 'staff',
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
