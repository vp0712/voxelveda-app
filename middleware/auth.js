const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { getRequestToken } = require('../utils/session');
const { ensureUserLifecycleSchema } = require('../services/userLifecycleService');
const { ensureSecuritySchema } = require('../services/securitySchema');
const { validateSession } = require('../services/sessionService');
const { requiresMfa } = require('../services/mfaService');

function parsePermissions(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

module.exports = async (req, res, next) => {
  try {
    const token = getRequestToken(req);

    if (!token) {
      return res.status(401).json({
        message: 'Authorization token missing'
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        message: 'JWT_SECRET missing in server .env'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    await ensureUserLifecycleSchema();
    await ensureSecuritySchema();
    const session = await validateSession(token, decoded);
    if (!session) return res.status(401).json({ message: 'Session has ended. Please sign in again.' });

    const [[freshUser]] = await pool.query(
      `SELECT id, email, username, role, permissions, active, account_status, session_version, mfa_enabled
       FROM users
       WHERE id = ? AND deleted_at IS NULL
       LIMIT 1`,
      [decoded.id]
    );

    const blocked = ['LOCKED', 'SUSPENDED', 'DISABLED', 'TERMINATED'];
    if (!freshUser || Number(freshUser.active) === 0 || blocked.includes(String(freshUser.account_status).toUpperCase()) || Number(freshUser.session_version) !== Number(session.session_version)) {
      return res.status(401).json({
        message: 'Account disabled or no longer available'
      });
    }

    req.user = {
      id: decoded.id,
      email: freshUser.email || decoded.email,
      username: freshUser.username || decoded.username,
      role: String(freshUser.role || decoded.role || 'staff').trim().toLowerCase(),
      permissions: parsePermissions(freshUser.permissions)
    };
    req.session = {
      id: session.id,
      assuranceLevel: Number(session.assurance_level || 1),
      stepUpVerifiedAt: session.step_up_verified_at || null,
      stepUpMethod: session.step_up_method || null
    };

    const mfaRequired = requiresMfa(req.user.role) || Number(freshUser.mfa_enabled) === 1;
    if (mfaRequired && req.session.assuranceLevel < 2) {
      const setupRequired = Number(freshUser.mfa_enabled) !== 1;
      const setupPaths = ['/api/auth/mfa/status', '/api/auth/mfa/enroll/start', '/api/auth/mfa/enroll/confirm'];
      if (!(setupRequired && setupPaths.includes(req.originalUrl.split('?')[0]))) {
        return res.status(403).json({ message: 'Multi-factor authentication is required', code: 'MFA_REQUIRED', setup_required: setupRequired });
      }
    }

    next();
  } catch (err) {
    return res.status(401).json({
      message: 'Invalid or expired token'
    });
  }
};
