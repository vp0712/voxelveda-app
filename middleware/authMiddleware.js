const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { ensureUserLifecycleSchema } = require('../services/userLifecycleService');

module.exports = async (req, res, next) => {
  let decoded;
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided' });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: 'JWT_SECRET is missing' });
    }

    const token = authHeader.split(' ')[1];
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }

  try {
    await ensureUserLifecycleSchema();
    const [rows] = await pool.query(
      `SELECT id, name, username, email, role, permissions, active
       FROM users
       WHERE id = ? AND active = 1 AND deleted_at IS NULL
       LIMIT 1`,
      [decoded.id]
    );

    if (!rows.length) {
      return res.status(401).json({ message: 'Account is no longer active. Please contact admin.' });
    }

    const user = rows[0];
    let permissions = [];
    try {
      permissions = Array.isArray(user.permissions) ? user.permissions : JSON.parse(user.permissions || '[]');
    } catch {
      permissions = [];
    }

    req.user = {
      ...decoded,
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      role: String(user.role || 'staff').trim().toLowerCase(),
      permissions
    };
    next();
  } catch (error) {
    console.error('AUTH ACCOUNT CHECK ERROR:', error.message);
    return res.status(500).json({ message: 'Unable to verify account status' });
  }
};
