const pool = require('../config/db');
const { ensureSecuritySchema } = require('./securitySchema');
const { ensureSecurityGovernanceSchema } = require('./securityGovernanceSchema');
const crypto = require('crypto');

const ACCOUNT_STATES = Object.freeze([
  'INVITED', 'ACTIVE', 'PASSWORD_RESET_REQUIRED', 'MFA_SETUP_REQUIRED',
  'LOCKED', 'SUSPENDED', 'DISABLED', 'TERMINATED'
]);

const DISALLOWED_LOGIN_STATES = new Set(['LOCKED', 'SUSPENDED', 'DISABLED', 'TERMINATED']);

function normalizeAccountState(value) {
  return String(value || '').trim().toUpperCase();
}

function permissionDifference(before = [], after = []) {
  const oldSet = new Set(before);
  const newSet = new Set(after);
  return {
    added: [...newSet].filter((permission) => !oldSet.has(permission)).sort(),
    removed: [...oldSet].filter((permission) => !newSet.has(permission)).sort()
  };
}

async function revokeEveryCredential(connection, userId, reason) {
  const safeReason = String(reason || 'SECURITY_ADMIN_ACTION').slice(0, 100);
  await connection.query(
    'UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, NOW()), revoke_reason = COALESCE(revoke_reason, ?) WHERE user_id = ?',
    [safeReason, userId]
  );
  await connection.query(
    'UPDATE auth_action_tokens SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = ? AND used_at IS NULL',
    [userId]
  );
  await connection.query(
    'UPDATE user_api_tokens SET revoked_at = COALESCE(revoked_at, NOW()), revoked_reason = COALESCE(revoked_reason, ?) WHERE user_id = ?',
    [safeReason, userId]
  );
  await connection.query(
    'UPDATE trusted_devices SET revoked_at = COALESCE(revoked_at, NOW()), revoke_reason = COALESCE(revoke_reason, ?) WHERE user_id = ?',
    [safeReason, userId]
  );
}

const OWNERSHIP_TARGETS = Object.freeze([
  { table: 'secure_documents', column: 'owner_user_id', active: 'deleted_at IS NULL' },
  { table: 'service_accounts', column: 'owner_user_id', active: "status='ACTIVE'" },
  { table: 'security_risk_exceptions', column: 'owner_id', active: "status IN ('PENDING_APPROVAL','APPROVED')" },
  { table: 'tasks', column: 'assigned_to', active: 'IFNULL(deleted,0)=0' },
  { table: 'assets', column: 'assigned_to', active: '1=1' }
]);

async function tableExists(connection, table) {
  const [[row]] = await connection.query(
    'SELECT COUNT(*) count FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?', [table]
  );
  return Number(row.count) > 0;
}

async function transferOwnedRecords(connection, sourceUserId, destinationUserId, actorId, reason) {
  const counts = {};
  for (const target of OWNERSHIP_TARGETS) {
    if (!await tableExists(connection, target.table)) continue;
    const [[row]] = await connection.query(
      `SELECT COUNT(*) count FROM ${target.table} WHERE ${target.column}=? AND ${target.active}`, [sourceUserId]
    );
    counts[target.table] = Number(row.count || 0);
  }
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (total && !destinationUserId) {
    const error = Object.assign(new Error('Active record ownership must be transferred before termination'), {
      statusCode: 409, code: 'OWNERSHIP_TRANSFER_REQUIRED', ownershipCounts: counts
    });
    throw error;
  }
  if (!destinationUserId) return counts;
  const [[destination]] = await connection.query(
    `SELECT id FROM users WHERE id=? AND active=1 AND deleted_at IS NULL
     AND account_status NOT IN ('LOCKED','SUSPENDED','DISABLED','TERMINATED') LIMIT 1`, [destinationUserId]
  );
  if (!destination || Number(destinationUserId) === Number(sourceUserId)) {
    throw Object.assign(new Error('Ownership destination must be a different active user'), { statusCode: 400 });
  }
  for (const target of OWNERSHIP_TARGETS) {
    if (!(target.table in counts) || !counts[target.table]) continue;
    await connection.query(
      `UPDATE ${target.table} SET ${target.column}=? WHERE ${target.column}=? AND ${target.active}`,
      [destinationUserId, sourceUserId]
    );
  }
  await connection.query(
    `INSERT INTO ownership_transfer_events
     (id,source_user_id,destination_user_id,transfer_reason,transferred_counts_json,transferred_by)
     VALUES (?,?,?,?,?,?)`,
    [crypto.randomUUID(), sourceUserId, destinationUserId, String(reason).slice(0, 500), JSON.stringify(counts), actorId]
  );
  return counts;
}

async function transitionAccount({ actorId, targetUserId, state, reason, req, compromised = false, transferToUserId = null }) {
  await ensureSecuritySchema();
  await ensureSecurityGovernanceSchema();
  const nextState = normalizeAccountState(state);
  if (!ACCOUNT_STATES.includes(nextState)) throw Object.assign(new Error('Invalid account state'), { statusCode: 400 });
  if (!String(reason || '').trim()) throw Object.assign(new Error('A reason is required'), { statusCode: 400 });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[before]] = await connection.query(
      'SELECT id, role, account_status, active, session_version, password_reset_required, security_compromised_at FROM users WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
      [targetUserId]
    );
    if (!before) throw Object.assign(new Error('User not found'), { statusCode: 404 });
    if (nextState === 'ACTIVE' && before.security_compromised_at && Number(before.password_reset_required) === 1) {
      throw Object.assign(new Error('Complete the controlled password-reset recovery before restoring this compromised account'), { statusCode: 409 });
    }

    const ownershipTransfers = nextState === 'TERMINATED'
      ? await transferOwnedRecords(connection, targetUserId, Number(transferToUserId || 0) || null, actorId, reason)
      : {};
    const active = nextState === 'ACTIVE' || nextState === 'PASSWORD_RESET_REQUIRED' || nextState === 'MFA_SETUP_REQUIRED';
    await connection.query(
      `UPDATE users SET account_status = ?, active = ?, session_version = session_version + 1,
       password_reset_required = CASE WHEN ? THEN 1 ELSE password_reset_required END,
       security_compromised_at = CASE WHEN ? THEN NOW() ELSE security_compromised_at END,
       terminated_at = CASE WHEN ? THEN NOW() ELSE terminated_at END,
       terminated_by = CASE WHEN ? THEN ? ELSE terminated_by END
       WHERE id = ?`,
      [nextState, active ? 1 : 0, compromised || nextState === 'PASSWORD_RESET_REQUIRED', compromised,
        nextState === 'TERMINATED', nextState === 'TERMINATED', actorId, targetUserId]
    );
    if (!active || compromised || nextState === 'PASSWORD_RESET_REQUIRED') {
      await revokeEveryCredential(connection, targetUserId, compromised ? 'ACCOUNT_COMPROMISED' : `ACCOUNT_${nextState}`);
    }
    if (compromised) {
      await connection.query('DELETE FROM user_mfa_totp WHERE user_id = ?', [targetUserId]);
      await connection.query('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [targetUserId]);
      await connection.query('UPDATE users SET mfa_enabled = 0, last_mfa_update_at = NOW() WHERE id = ?', [targetUserId]);
    }
    await connection.query(
      `INSERT INTO user_security_actions
       (actor_id, target_user_id, action_type, previous_state, new_state, reason, request_id, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [actorId, targetUserId, compromised ? 'MARK_COMPROMISED' : 'ACCOUNT_STATE_CHANGED', before.account_status,
        nextState, String(reason).trim().slice(0, 500), req?.requestId || null, req?.ip || null,
        String(req?.get?.('user-agent') || '').slice(0, 255)]
    );
    await connection.commit();
    return { before, state: nextState, active, ownershipTransfers };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  ACCOUNT_STATES, DISALLOWED_LOGIN_STATES, normalizeAccountState,
  permissionDifference, revokeEveryCredential, transitionAccount, transferOwnedRecords
};
