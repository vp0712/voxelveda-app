const path = require('path');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { getRequestToken, safeReturnTo } = require('../utils/session');
const { ensureUserLifecycleSchema } = require('../services/userLifecycleService');
const { ensureSecuritySchema } = require('../services/securitySchema');
const { validateSession } = require('../services/sessionService');
const { requiresMfa } = require('../services/mfaService');
const { hasAnyPermission, hasPermission } = require('../services/authorizationService');

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
  const returnTo = safeReturnTo(req.originalUrl, '/');
  return res.redirect(302, `/login?returnTo=${encodeURIComponent(returnTo)}`);
}

function pageAuth({ adminOnly = false, workspaceOnly = false, allowMfaSetup = false } = {}) {
  return async (req, res, next) => {
    try {
      const token = getRequestToken(req);
      if (!token || !process.env.JWT_SECRET) return redirectToLogin(req, res);

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      await ensureUserLifecycleSchema();
      await ensureSecuritySchema();
      const session = await validateSession(token, decoded);
      if (!session) return redirectToLogin(req, res);
      const [[user]] = await pool.query(
        `SELECT id, email, username, role, permissions, active, account_status, session_version, mfa_enabled
         FROM users
         WHERE id = ? AND deleted_at IS NULL
         LIMIT 1`,
        [decoded.id]
      );
      const blocked = ['LOCKED', 'SUSPENDED', 'DISABLED', 'TERMINATED'];
      if (!user || Number(user.active) === 0 || blocked.includes(String(user.account_status).toUpperCase()) || Number(user.session_version) !== Number(session.session_version)) return redirectToLogin(req, res);

      const role = String(user.role || decoded.role || 'staff').trim().toLowerCase();
      if (!allowMfaSetup && (requiresMfa(role) || Number(user.mfa_enabled) === 1) && Number(session.assurance_level || 1) < 2) {
        if (Number(user.mfa_enabled) !== 1) return res.redirect(302, '/security?mfa_setup=required');
        return res.redirect(302, '/login?message=Multi-factor%20verification%20is%20required');
      }
      const permissions = parsePermissions(user.permissions);
      const authorizationUser = { ...user, role, permissions };
      const canAdminister = hasPermission(authorizationUser, 'MANAGE_USERS');
      const canUseOperationsWorkspace = hasAnyPermission(authorizationUser, [
        'VIEW_FINANCE', 'MANAGE_JOBS', 'MANAGE_TEAM_JOBS', 'VIEW_CUSTOMERS',
        'VIEW_INVENTORY', 'VIEW_SUPPLIERS', 'VIEW_RFQS'
      ]);

      if ((adminOnly && !canAdminister) || (workspaceOnly && !canUseOperationsWorkspace)) {
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
      return next();
    } catch {
      return redirectToLogin(req, res);
    }
  };
}

module.exports = pageAuth;
