const path = require('path');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { getRequestToken, safeReturnTo } = require('../utils/session');
const { isRevoked } = require('../utils/tokenRevocation');

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

function pageAuth({ adminOnly = false } = {}) {
  return async (req, res, next) => {
    try {
      const token = getRequestToken(req);
      if (!token || isRevoked(token) || !process.env.JWT_SECRET) return redirectToLogin(req, res);

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const [[user]] = await pool.query(
        'SELECT id, email, username, role, permissions, active FROM users WHERE id = ? LIMIT 1',
        [decoded.id]
      );
      if (!user || Number(user.active) === 0) return redirectToLogin(req, res);

      const role = String(user.role || decoded.role || 'staff').trim().toLowerCase();
      if (adminOnly && role !== 'admin') {
        res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
        return res.status(403).sendFile(path.join(__dirname, '..', 'public', '403.html'));
      }

      req.user = {
        id: decoded.id,
        email: user.email || decoded.email,
        username: user.username || decoded.username,
        role,
        permissions: parsePermissions(user.permissions)
      };
      return next();
    } catch {
      return redirectToLogin(req, res);
    }
  };
}

module.exports = pageAuth;
