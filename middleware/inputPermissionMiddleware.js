const pool = require('../config/db');

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

async function ensureAccessAttemptTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS access_attempts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      user_name VARCHAR(255) NULL,
      user_email VARCHAR(255) NULL,
      section VARCHAR(120) NOT NULL,
      action VARCHAR(120) NOT NULL,
      method VARCHAR(20) NOT NULL,
      path VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_access_attempts_created_at (created_at),
      INDEX idx_access_attempts_user_id (user_id)
    )
  `);
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

    const role = String(req.user?.role || '').trim().toLowerCase();
    if (['admin', 'super_admin'].includes(role)) return next();

    const permissions = parsePermissions(req.user?.permissions);
    const requiredPermissions = resolveRequired(required, req);
    const allowed = requiredPermissions.some((permission) => permissions.includes(permission));

    if (allowed) return next();

    await logAttempt(req, requiredPermissions);

    return res.status(403).json({
      accessDenied: true,
      message: "You don't have access to input or change data in this section. Please contact admin.",
      required_permissions: requiredPermissions
    });
  };
};
