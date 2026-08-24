const path = require('path');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { getRequestToken, safeReturnTo } = require('../utils/session');
const { isRevoked } = require('../utils/tokenRevocation');
const { ensureUserLifecycleSchema } = require('../services/userLifecycleService');

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

function pageAuth({ adminOnly = false, workspaceOnly = false } = {}) {
  return async (req, res, next) => {
    try {
      const token = getRequestToken(req);
      if (!token || isRevoked(token) || !process.env.JWT_SECRET) return redirectToLogin(req, res);

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      await ensureUserLifecycleSchema();
      const [[user]] = await pool.query(
        `SELECT id, email, username, role, permissions, active
         FROM users
         WHERE id = ? AND deleted_at IS NULL
         LIMIT 1`,
        [decoded.id]
      );
      if (!user || Number(user.active) === 0) return redirectToLogin(req, res);

      const role = String(user.role || decoded.role || 'staff').trim().toLowerCase();
      const permissions = parsePermissions(user.permissions);
      const isSystemAdmin = ['admin', 'super_admin'].includes(role);
      const isFinanceRole = ['finance_admin', 'finance_user', 'accountant'].includes(role);
      const canUseOperationsWorkspace = isSystemAdmin
        || isFinanceRole
        || permissions.includes('finance')
        || permissions.includes('tasks');

      if ((adminOnly && !isSystemAdmin) || (workspaceOnly && !canUseOperationsWorkspace)) {
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
