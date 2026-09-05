const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { verifyAuthenticatedTotp } = require('../services/mfaService');
const { logSecurityEvent, markSessionStepUp } = require('../services/sessionService');
const { isStepUpFresh, stepUpExpiry, stepUpTtlMinutes } = require('../services/stepUpService');

exports.status = (req, res) => res.json({
  verified: isStepUpFresh(req.session),
  assurance_level: isStepUpFresh(req.session) ? 3 : Math.min(Number(req.session?.assuranceLevel || 1), 2),
  expires_at: isStepUpFresh(req.session) ? stepUpExpiry(req.session) : null,
  verification_valid_minutes: stepUpTtlMinutes()
});

exports.verify = async (req, res) => {
  try {
    const password = String(req.body.password || '');
    const code = String(req.body.code || '').replace(/\s/g, '');
    if (!password || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ message: 'Password and a six-digit authenticator code are required.' });
    }

    const [[user]] = await pool.query(
      `SELECT id, password, mfa_enabled, active, account_status
       FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [req.user.id]
    );
    const unavailable = !user || Number(user.active) === 0
      || ['LOCKED', 'SUSPENDED', 'DISABLED', 'TERMINATED'].includes(String(user.account_status || '').toUpperCase());
    if (unavailable) return res.status(401).json({ message: 'Security verification could not be completed.' });
    if (Number(user.mfa_enabled) !== 1) {
      return res.status(409).json({
        message: 'Authenticator MFA must be configured before this action can continue.',
        code: 'MFA_SETUP_REQUIRED'
      });
    }

    const passwordValid = await bcrypt.compare(password, user.password);
    const totpValid = passwordValid ? await verifyAuthenticatedTotp(user.id, code) : false;
    if (!passwordValid || !totpValid) {
      await logSecurityEvent({
        actorId: user.id, targetUserId: user.id, sessionId: req.session.id,
        eventType: 'STEP_UP_FAILED', result: 'DENIED', req
      });
      return res.status(400).json({ message: 'Security verification failed. Check your password and use a new authenticator code.' });
    }

    const updated = await markSessionStepUp(user.id, req.session.id, 'PASSWORD_TOTP');
    if (!updated) return res.status(401).json({ message: 'Your session is no longer active.' });
    await logSecurityEvent({
      actorId: user.id, targetUserId: user.id, sessionId: req.session.id,
      eventType: 'STEP_UP_VERIFIED', req, metadata: { method: 'PASSWORD_TOTP' }
    });
    const verifiedAt = new Date();
    return res.json({
      message: 'Security verification complete.',
      assurance_level: 3,
      expires_at: new Date(verifiedAt.getTime() + stepUpTtlMinutes() * 60 * 1000).toISOString()
    });
  } catch (error) {
    console.error('Step-up verification error:', error.message);
    return res.status(500).json({ message: 'Security verification could not be completed.' });
  }
};
