const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

function normalizeRole(role) {
  return String(role || 'staff').trim().toLowerCase();
}

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

function createToken(user) {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is missing in .env');
  }

  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      username: user.username,
      role: normalizeRole(user.role),
      permissions: parsePermissions(user.permissions)
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

exports.login = async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }

    const [rows] = await pool.query(
      `SELECT id, name, username, email, password, role, permissions, active
       FROM users
       WHERE LOWER(email) = ? OR LOWER(username) = ?
       LIMIT 1`,
      [email, email]
    );

    if (!rows.length) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = rows[0];

    if (Number(user.active) === 0) {
      return res.status(403).json({ message: 'Account disabled. Contact admin.' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const cleanUser = {
      id: user.id,
      name: user.name || 'User',
      username: user.username || user.email,
      email: user.email,
      role: normalizeRole(user.role),
      permissions: parsePermissions(user.permissions)
    };

    const token = createToken(cleanUser);

    res.json({
      message: 'Login successful',
      token,
      user: cleanUser
    });
  } catch (err) {
    console.error('LOGIN ERROR:', err);
    res.status(500).json({
      message: 'Login failed',
      error: err.message
    });
  }
};

exports.register = async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const role = normalizeRole(req.body.role || 'staff');
    const username = String(req.body.username || email.split('@')[0] || '').trim().toLowerCase();
    const permissions = parsePermissions(req.body.permissions);

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password required' });
    }

    const allowedRoles = ['admin', 'staff', 'sales', 'production', 'viewer'];

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1',
      [email]
    );

    if (existing.length) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO users (name, username, email, password, role, permissions, active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [name, username, email, hashedPassword, role, JSON.stringify(permissions)]
    );

    res.json({ message: 'User registered successfully' });
  } catch (err) {
    console.error('REGISTER ERROR:', err);
    res.status(500).json({
      message: 'Registration failed',
      error: err.message
    });
  }
};

exports.me = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const [rows] = await pool.query(
      'SELECT id, name, username, email, role, permissions, active FROM users WHERE id = ? LIMIT 1',
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = rows[0];

    res.json({
      user: {
        id: user.id,
        name: user.name || 'User',
        username: user.username || user.email,
        email: user.email,
        role: normalizeRole(user.role),
        permissions: parsePermissions(user.permissions),
        active: Number(user.active) !== 0
      }
    });
  } catch (err) {
    console.error('ME ERROR:', err);
    res.status(500).json({
      message: 'Failed to load user',
      error: err.message
    });
  }
};
