const path = require('path');
const pool = require('../config/db');
const {
  RESUME_TYPE, getRequestToken, getSessionCredential, hasSessionCookie, safeReturnTo,
  signInReturnTo, setAccessCookie, clearSessionCookie
} = require('../utils/session');
const { ensureUserLifecycleSchema } = require('../services/userLifecycleService');
const { ensureSecuritySchema } = require('../services/securitySchema');
const { validateSession } = require('../services/sessionService');
const { requiresMfa } = require('../services/mfaService');
const { hasPermission } = require('../services/authorizationService');

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

function redirectToLogin(req, res) {
  clearSessionCookie(req, res);
  const returnTo = safeReturnTo(req.originalUrl, '/');
  const expired=(hasSessionCookie(req) || getRequestToken(req))?'&message='+encodeURIComponent('Your session has ended. Please log in again.'):'';
  return res.redirect(302, `/login?returnTo=${encodeURIComponent(returnTo)}${expired}`);
}

function pageAuth({ adminOnly = false, allowMfaSetup = false, signInEntry = false } = {}) {
  return async (req, res, next) => {
    const rejectSession = () => {
      if (!signInEntry) return redirectToLogin(req, res);
      if (hasSessionCookie(req)) clearSessionCookie(req, res);
      return next();
    };
    try {
      if (signInEntry) {
        res.set('Cache-Control', 'private, no-store');
        if (req.query?.message) return next();
      }
      if (!hasSessionCookie(req) && !getRequestToken(req)) return rejectSession();
      if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is missing');

      const credential = getSessionCredential(req, process.env.JWT_SECRET);
      if (!credential) return rejectSession();
      const { decoded } = credential;
      await ensureUserLifecycleSchema();
      await ensureSecuritySchema();
      const session = await validateSession(credential.token, decoded);
      if (!session) return rejectSession();
      const [[user]] = await pool.query(
        `SELECT id, email, username, role, permissions, active, account_status, session_version, mfa_enabled
         FROM users
         WHERE id = ? AND deleted_at IS NULL
         LIMIT 1`,
        [decoded.id]
      );
      const blocked = ['LOCKED', 'SUSPENDED', 'DISABLED', 'TERMINATED'];
      if (!user || Number(user.active) === 0 || blocked.includes(String(user.account_status).toUpperCase()) || Number(user.session_version) !== Number(session.session_version)) return rejectSession();

      const role = String(user.role || decoded.role || 'staff').trim().toLowerCase();
      if (!allowMfaSetup && (requiresMfa(role) || Number(user.mfa_enabled) === 1) && Number(session.assurance_level || 1) < 2) {
        if (signInEntry) return next();
        const returnTo=encodeURIComponent(safeReturnTo(req.originalUrl,'/'));
        if (Number(user.mfa_enabled) !== 1) return res.redirect(302, '/security?mfa_setup=required&returnTo='+returnTo);
        return res.redirect(302, '/login?returnTo='+returnTo+'&message=Multi-factor%20verification%20is%20required');
      }
      const permissions = parsePermissions(user.permissions);
      const authorizationUser = { ...user, role, permissions };
      const canAdminister = hasPermission(authorizationUser, 'MANAGE_USERS');

      if (credential.type === RESUME_TYPE) setAccessCookie(req, res, credential, process.env.JWT_SECRET);
      if (signInEntry) return res.redirect(302, signInReturnTo(req.query?.returnTo));

      if ((adminOnly && !canAdminister)) {
        res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
        return res.status(403).sendFile(path.join(__dirname, '..', 'public', '403.html'));
      }

      req.user = {
        id: decoded.id,
        email: user.email || decoded.email,
        username: user.username || decoded.username,
        role,
        permissions
      };
      req.session=session;
      return next();
    } catch (error) {
      console.error('PAGE AUTH SERVICE UNAVAILABLE:', error?.code || error?.name || 'UNKNOWN');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Retry-After', '5');
      return res.status(503).type('text').send('Sign-in is temporarily unavailable. Check your connection and reload this page to retry.');
    }
  };
}

module.exports = pageAuth;
