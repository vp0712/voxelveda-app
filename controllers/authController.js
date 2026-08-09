const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { getRequestToken, setSessionCookie, clearSessionCookie } = require('../utils/session');
const { revoke } = require('../utils/tokenRevocation');
const { ensureUserLifecycleSchema } = require('../services/userLifecycleService');

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

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function publicUsernameFromEmail(email) {
  const base = String(email || '')
    .split('@')[0]
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '_')
    .slice(0, 42) || 'customer';
  return `${base}_${String(Date.now()).slice(-5)}`;
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
    { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
  );
}

exports.login = async (req, res) => {
  try {
    await ensureUserLifecycleSchema();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }

    const [rows] = await pool.query(
      `SELECT id, name, username, email, password, role, permissions, active
       FROM users
       WHERE (LOWER(email) = ? OR LOWER(username) = ?)
         AND deleted_at IS NULL
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

    setSessionCookie(req, res, token);

    res.json({
      message: 'Login successful',
      token,
      user: cleanUser
    });
  } catch (err) {
    console.error('LOGIN ERROR:', err);
    res.status(500).json({
      message: 'Login failed'
    });
  }
};

exports.register = async (req, res) => {
  try {
    await ensureUserLifecycleSchema();
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const role = normalizeRole(req.body.role || 'staff');
    const username = String(req.body.username || email.split('@')[0] || '').trim().toLowerCase();
    const permissions = parsePermissions(req.body.permissions);

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Valid email address is required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
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
      message: 'Registration failed'
    });
  }
};

exports.me = async (req, res) => {
  try {
    await ensureUserLifecycleSchema();
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const [rows] = await pool.query(
      'SELECT id, name, username, email, role, permissions, active FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
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
      message: 'Failed to load user'
    });
  }
};

exports.customerRegister = async (req, res) => {
  try {
    await ensureUserLifecycleSchema();
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const confirmPrivacy = Boolean(req.body.confirm_privacy);

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Valid email address is required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    if (!confirmPrivacy) {
      return res.status(400).json({ message: 'Please accept the privacy policy before creating an account' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1',
      [email]
    );

    if (existing.length) {
      return res.status(409).json({ message: 'An account already exists for this email. Please login or contact admin.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const username = publicUsernameFromEmail(email);
    const role = 'viewer';
    const permissions = [];

    await pool.query(
      `INSERT INTO users (name, username, email, password, role, permissions, active, password_reset_required)
       VALUES (?, ?, ?, ?, ?, ?, 1, 0)`,
      [name, username, email, hashedPassword, role, JSON.stringify(permissions)]
    );

    res.json({
      message: 'Customer account created successfully. You can login now. Admin can add extra access if needed.'
    });
  } catch (err) {
    console.error('CUSTOMER REGISTER ERROR:', err);
    res.status(500).json({
      message: 'Customer account registration failed'
    });
  }
};

exports.logout = async (req, res) => {
  const token = getRequestToken(req);
  if (token) revoke(token);
  clearSessionCookie(req, res);
  return res.json({ message: 'Logout successful' });
};

exports.refreshSessionCookie = async (req, res) => {
  const token = getRequestToken(req);
  if (!token) return res.status(401).json({ message: 'Authorization token missing' });
  setSessionCookie(req, res, token);
  return res.json({ message: 'Session refreshed' });
};
