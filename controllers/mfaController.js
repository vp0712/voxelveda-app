const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const pool = require('../config/db');
const { createAuthenticatedSession } = require('../services/authSessionService');
const { logSecurityEvent, revokeUserSessions } = require('../services/sessionService');
const {
  beginAuthenticatedSetup, beginChallengeSetup, completeAuthenticatedSetup, completeChallengeSetup,
  disableMfa, regenerateRecoveryCodes, requiresMfa, verifyLoginChallenge
} = require('../services/mfaService');

function otpauth(secret, email) {
  const issuer = 'Voxel Veda';
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${email}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

async function loadUser(userId) {
  const [[user]] = await pool.query(`SELECT id, name, username, email, password, role, permissions,
    session_version, mfa_enabled, last_mfa_update_at FROM users WHERE id = ? AND active = 1 AND deleted_at IS NULL LIMIT 1`, [userId]);
  return user || null;
}

async function setupResponse(secret, email) {
  const uri = otpauth(secret, email);
  return { qr_code: await QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 2, width: 280 }), manual_key: secret, issuer: 'Voxel Veda', account: email };
}

exports.beginChallengeSetup = async (req, res) => {
  try {
    const setup = await beginChallengeSetup(String(req.body.challenge_token || ''));
    if (!setup) return res.status(400).json({ message: 'The MFA setup session is invalid or expired' });
    return res.json(await setupResponse(setup.secret, setup.email));
  } catch (error) { console.error('MFA challenge setup error:', error.message); return res.status(500).json({ message: 'Unable to begin MFA setup' }); }
};

exports.confirmChallengeSetup = async (req, res) => {
  try {
    const result = await completeChallengeSetup(String(req.body.challenge_token || ''), req.body.code);
    if (!result || result.invalid) {
      await logSecurityEvent({ eventType: 'MFA_FAILED', result: 'DENIED', req });
      return res.status(400).json({ message: 'Invalid or expired verification code' });
    }
    const user = await loadUser(result.userId);
    await revokeUserSessions(user.id, 'MFA_ENABLED');
    const session = await createAuthenticatedSession({ user, req, res, assuranceLevel: 2 });
    await pool.query('UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?', [user.id]);
    await logSecurityEvent({ actorId: user.id, targetUserId: user.id, sessionId: session.sessionId, eventType: 'MFA_ENABLED', req });
    return res.json({ message: 'MFA enabled and login completed.', user: session.user, recovery_codes: result.recoveryCodes });
  } catch (error) { console.error('MFA setup confirmation error:', error.message); return res.status(500).json({ message: 'Unable to confirm MFA setup' }); }
};

exports.verifyLogin = async (req, res) => {
  try {
    const result = await verifyLoginChallenge(String(req.body.challenge_token || ''), req.body.code);
    if (!result || result.invalid) {
      await logSecurityEvent({ eventType: 'MFA_FAILED', result: 'DENIED', req });
      return res.status(400).json({ message: 'Invalid or expired verification code' });
    }
    const user = await loadUser(result.userId);
    if (!user) return res.status(401).json({ message: 'Authentication could not be completed' });
    const session = await createAuthenticatedSession({ user, req, res, assuranceLevel: 2 });
    await pool.query('UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?', [user.id]);
    await logSecurityEvent({ actorId: user.id, targetUserId: user.id, sessionId: session.sessionId, eventType: result.usedRecoveryCode ? 'MFA_RECOVERY_CODE_USED' : 'MFA_VERIFIED', req });
    return res.json({ message: 'Login successful', user: session.user, recovery_code_used: result.usedRecoveryCode });
  } catch (error) { console.error('MFA verification error:', error.message); return res.status(500).json({ message: 'Unable to verify MFA' }); }
};

exports.status = async (req, res) => {
  try {
    const user = await loadUser(req.user.id);
    const [[codes]] = await pool.query('SELECT COUNT(*) AS remaining FROM mfa_recovery_codes WHERE user_id = ? AND used_at IS NULL', [req.user.id]);
    return res.json({ enabled: Number(user.mfa_enabled) === 1, required: requiresMfa(user.role), recovery_codes_remaining: Number(codes.remaining || 0), last_updated: user.last_mfa_update_at, assurance_level: req.session.assuranceLevel });
  } catch { return res.status(500).json({ message: 'Unable to load MFA status' }); }
};

exports.beginEnrollment = async (req, res) => {
  try {
    const user = await loadUser(req.user.id);
    if (!user || !(await bcrypt.compare(String(req.body.current_password || ''), user.password))) return res.status(400).json({ message: 'Current password is incorrect' });
    const secret = await beginAuthenticatedSetup(user.id);
    await logSecurityEvent({ actorId: user.id, targetUserId: user.id, eventType: 'MFA_ENROLLMENT_STARTED', req });
    return res.json(await setupResponse(secret, user.email));
  } catch (error) { console.error('MFA enrollment error:', error.message); return res.status(500).json({ message: 'Unable to begin MFA enrollment' }); }
};

exports.confirmEnrollment = async (req, res) => {
  try {
    const codes = await completeAuthenticatedSetup(req.user.id, req.body.code);
    if (!codes) return res.status(400).json({ message: 'Invalid verification code' });
    await revokeUserSessions(req.user.id, 'MFA_ENABLED');
    await logSecurityEvent({ actorId: req.user.id, targetUserId: req.user.id, eventType: 'MFA_ENABLED', req });
    return res.json({ message: 'MFA enabled. Sign in again using your authenticator.', recovery_codes: codes });
  } catch { return res.status(500).json({ message: 'Unable to enable MFA' }); }
};

exports.regenerateRecoveryCodes = async (req, res) => {
  try {
    const user = await loadUser(req.user.id);
    if (!user || !(await bcrypt.compare(String(req.body.current_password || ''), user.password))) return res.status(400).json({ message: 'Security verification failed' });
    const codes = await regenerateRecoveryCodes(user.id, req.body.code);
    if (!codes) return res.status(400).json({ message: 'Security verification failed' });
    await logSecurityEvent({ actorId: user.id, targetUserId: user.id, eventType: 'RECOVERY_CODES_REGENERATED', req });
    return res.json({ message: 'New recovery codes generated. Previous codes are invalid.', recovery_codes: codes });
  } catch { return res.status(500).json({ message: 'Unable to regenerate recovery codes' }); }
};

exports.disable = async (req, res) => {
  try {
    const user = await loadUser(req.user.id);
    if (requiresMfa(user?.role)) return res.status(403).json({ message: 'MFA is mandatory for this role and cannot be disabled' });
    if (!user || !(await bcrypt.compare(String(req.body.current_password || ''), user.password))) return res.status(400).json({ message: 'Security verification failed' });
    if (!(await disableMfa(user.id, req.body.code))) return res.status(400).json({ message: 'Security verification failed' });
    await revokeUserSessions(user.id, 'MFA_DISABLED');
    await logSecurityEvent({ actorId: user.id, targetUserId: user.id, eventType: 'MFA_DISABLED', req });
    return res.json({ message: 'MFA disabled. All sessions have been signed out.' });
  } catch { return res.status(500).json({ message: 'Unable to disable MFA' }); }
};
