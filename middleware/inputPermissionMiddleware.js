const pool = require('../config/db');
const { assertOriginalRegisterSchema } = require('../services/originalRegisterSchema');
const { hasAnyPermission } = require('../services/authorizationService');

function ensureAccessAttemptTable() {
  return assertOriginalRegisterSchema('access_attempts', pool);
}

function resolveRequired(required, req) {
  const value = typeof required === 'function' ? required(req) : required;
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

async function logAttempt(req, requiredPermissions) {
  try {
    await ensureAccessAttemptTable();
    await pool.query(
      `
      INSERT INTO access_attempts
      (user_id, user_name, user_email, section, action, method, path)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        req.user?.id || null,
        req.user?.username || req.user?.name || null,
        req.user?.email || null,
        requiredPermissions.join(', '),
        'input_denied',
        req.method,
        req.originalUrl
      ]
    );
  } catch (error) {
    console.error('access attempt log failed:', error.message);
  }
}

module.exports = function requireInputPermission(required) {
  return async (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(String(req.method).toUpperCase())) {
      return next();
    }

    const requiredPermissions = resolveRequired(required, req);
    const allowed = hasAnyPermission(req.user, requiredPermissions);

    if (allowed) return next();

    await logAttempt(req, requiredPermissions);

    return res.status(403).json({
      accessDenied: true,
      message: "You don't have access to change this data. Please contact an administrator.",
      code: 'PERMISSION_DENIED'
    });
  };
};
