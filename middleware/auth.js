const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { getRequestToken } = require('../utils/session');
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

module.exports = async (req, res, next) => {
  try {
    const token = getRequestToken(req);

    if (!token) {
      return res.status(401).json({
        message: 'Authorization token missing'
      });
    }

    if (isRevoked(token)) {
      return res.status(401).json({ message: 'Session has ended. Please sign in again.' });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        message: 'JWT_SECRET missing in server .env'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const [[freshUser]] = await pool.query(
      'SELECT id, email, username, role, permissions, active FROM users WHERE id = ? LIMIT 1',
      [decoded.id]
    );

    if (!freshUser || Number(freshUser.active) === 0) {
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

    next();
  } catch (err) {
    return res.status(401).json({
      message: 'Invalid or expired token'
    });
  }
};
