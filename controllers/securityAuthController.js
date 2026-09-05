const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { validatePassword } = require('../services/passwordPolicy');
const { issueToken, consumeToken } = require('../services/authActionTokenService');
const { queueSecurityLink } = require('../services/securityEmailService');
const { revokeUserSessions, listUserSessions, revokeSessionById, logSecurityEvent } = require('../services/sessionService');
const { ensureSecuritySchema } = require('../services/securitySchema');

exports.requestPasswordReset = async (req, res) => {
  const response = { message: 'If the account exists, a password reset link will be sent.' };
  try {
    await ensureSecuritySchema();
    const identity = String(req.body.email || '').trim().toLowerCase();
    if (!identity || identity.length > 254) return res.json(response);
    const [[user]] = await pool.query(
      `SELECT id, name, email, active, account_status FROM users
       WHERE (LOWER(email) = ? OR LOWER(username) = ?) AND deleted_at IS NULL LIMIT 1`,
      [identity, identity]
    );
    if (user && Number(user.active) === 1 && !['SUSPENDED', 'DISABLED', 'TERMINATED'].includes(String(user.account_status || '').toUpperCase())) {
      const token = await issueToken({ userId: user.id, type: 'PASSWORD_RESET', minutes: 30 });
      queueSecurityLink({ user, token, type: 'PASSWORD_RESET' })
        .catch((error) => console.error('Password reset email delivery failed:', error.message));
      await logSecurityEvent({ targetUserId: user.id, eventType: 'PASSWORD_RESET_REQUESTED', req });
    }
  } catch (error) {
    console.error('requestPasswordReset error:', error.message);
  }
  return res.json(response);
};

async function setPasswordFromToken(req, res, type) {
  const token = String(req.body.token || '');
  const password = String(req.body.password || '');
  if (!token || !password) return res.status(400).json({ message: 'Token and password are required' });
  if (token.length > 200 || password.length > 256) return res.status(400).json({ message: 'Invalid request' });
  let connection;
  try {
    await ensureSecuritySchema();
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const action = await consumeToken(token, type, connection);
    if (!action) { await connection.rollback(); return res.status(400).json({ message: 'This link is invalid or has expired' }); }
    const [[user]] = await connection.query('SELECT id, name, username, email FROM users WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [action.user_id]);
    if (!user) { await connection.rollback(); return res.status(400).json({ message: 'This link is invalid or has expired' }); }
    const check = validatePassword(password, user);
    if (!check.valid) { await connection.rollback(); return res.status(400).json({ message: check.errors[0] }); }
    const passwordHash = await bcrypt.hash(password, 12);
    await connection.query(
      `UPDATE users SET password = ?, active = 1, account_status = 'ACTIVE', password_reset_required = 0, security_compromised_at = NULL,
       failed_login_count = 0, locked_until = NULL, last_password_change_at = NOW(), session_version = session_version + 1 WHERE id = ?`,
      [passwordHash, user.id]
    );
    await connection.commit();
    await revokeUserSessions(user.id, type);
    await logSecurityEvent({ targetUserId: user.id, eventType: type === 'INVITE' ? 'INVITATION_ACCEPTED' : 'PASSWORD_RESET', req });
    return res.json({ message: 'Password updated. You can now sign in.' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('setPasswordFromToken error:', error.message);
    return res.status(500).json({ message: 'Unable to update password' });
  } finally { connection?.release(); }
}

exports.completePasswordReset = (req, res) => setPasswordFromToken(req, res, 'PASSWORD_RESET');
exports.acceptInvitation = (req, res) => setPasswordFromToken(req, res, 'INVITE');

exports.changePassword = async (req, res) => {
  try {
    const currentPassword = String(req.body.current_password || '');
    const newPassword = String(req.body.new_password || '');
    if (!currentPassword || !newPassword || currentPassword.length > 256 || newPassword.length > 256) {
      return res.status(400).json({ message: 'Current and new passwords are required' });
    }
    const [[user]] = await pool.query('SELECT id, name, username, email, password FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1', [req.user.id]);
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) return res.status(400).json({ message: 'Current password is incorrect' });
    const check = validatePassword(newPassword, user);
    if (!check.valid) return res.status(400).json({ message: check.errors[0] });
    if (await bcrypt.compare(newPassword, user.password)) return res.status(400).json({ message: 'New password must be different' });
    await pool.query(`UPDATE users SET password = ?, password_reset_required = 0, account_status = 'ACTIVE',
      last_password_change_at = NOW(), session_version = session_version + 1 WHERE id = ?`, [await bcrypt.hash(newPassword, 12), user.id]);
    await revokeUserSessions(user.id, 'PASSWORD_CHANGED');
    await logSecurityEvent({ actorId: user.id, targetUserId: user.id, eventType: 'PASSWORD_CHANGED', req });
    return res.json({ message: 'Password changed. Please sign in again.' });
  } catch (error) { return res.status(500).json({ message: 'Unable to change password' }); }
};

exports.getSessions = async (req, res) => {
  try {
    const sessions = await listUserSessions(req.user.id);
    return res.json({ sessions: sessions.map((session) => ({ ...session, current: session.id === req.session?.id })) });
  } catch { return res.status(500).json({ message: 'Unable to load sessions' }); }
};

exports.revokeOwnSession = async (req, res) => {
  try {
    const sessionId = String(req.params.id || '');
    if (!sessionId) return res.status(400).json({ message: 'Session ID is required' });
    const revoked = await revokeSessionById(req.user.id, sessionId);
    if (!revoked) return res.status(404).json({ message: 'Session not found' });
    await logSecurityEvent({ actorId: req.user.id, targetUserId: req.user.id, eventType: 'SESSION_REVOKED', sessionId, req });
    return res.json({ message: 'Session signed out' });
  } catch { return res.status(500).json({ message: 'Unable to revoke session' }); }
};

exports.revokeOtherSessions = async (req, res) => {
  try {
    await ensureSecuritySchema();
    await pool.query(`UPDATE auth_sessions SET revoked_at = NOW(), revoke_reason = 'USER_REVOKED_OTHERS'
      WHERE user_id = ? AND id <> ? AND revoked_at IS NULL`, [req.user.id, req.session.id]);
    await logSecurityEvent({ actorId: req.user.id, targetUserId: req.user.id, eventType: 'OTHER_SESSIONS_REVOKED', req });
    return res.json({ message: 'All other sessions signed out' });
  } catch { return res.status(500).json({ message: 'Unable to revoke sessions' }); }
};
