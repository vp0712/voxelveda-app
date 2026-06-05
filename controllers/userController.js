const pool = require('../config/db');
const bcrypt = require('bcryptjs');

const ALL_PERMISSIONS = [
  'dashboard',
  'rfqs',
  'rfqs_input',
  'invoices',
  'customers',
  'customers_input',
  'tasks',
  'tasks_input',
  'attendance',
  'attendance_input',
  'staff',
  'settings',
  'stock',
  'stock_in',
  'stock_in_input',
  'stock_out',
  'stock_out_input',
  'raw_material',
  'raw_material_input',
  'packaging',
  'packaging_input',
  'meetings',
  'meetings_input',
  'suppliers',
  'suppliers_input',
  'expenses',
  'expenses_input',
  'compliance',
  'compliance_input',
  'competitors',
  'competitors_input'
];

function parsePermissions(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((item) => ALL_PERMISSIONS.includes(item));

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => ALL_PERMISSIONS.includes(item)) : [];
  } catch {
    return [];
  }
}

function normalizeRole(role) {
  return String(role || 'staff').trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

exports.createUser = async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const role = normalizeRole(req.body.role || 'staff');
    const username = String(req.body.username || email.split('@')[0] || '').trim().toLowerCase();
    const permissions = parsePermissions(req.body.permissions);

    if (!name || !username || !email || !password || !role) {
      return res.status(400).json({ message: 'Name, username, email, password and role are required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Valid email address is required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const allowedRoles = ['admin', 'sales', 'production', 'viewer', 'staff'];

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = ? OR LOWER(username) = ? LIMIT 1',
      [email, username]
    );

    if (existing.length) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      `INSERT INTO users
       (name, username, email, password, role, permissions, active, password_reset_required)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
      [name, username, email, hashedPassword, role, JSON.stringify(permissions)]
    );

    res.json({
      message: 'Staff user created successfully',
      user_id: result.insertId
    });
  } catch (error) {
    console.error('createUser error:', error);
    res.status(500).json({
      message: 'Failed to create user',
      error: error.message
    });
  }
};

exports.getUsers = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
        id,
        name,
        username,
        email,
        role,
        permissions,
        active,
        password_reset_required,
        last_password_reset_at
      FROM users
      ORDER BY id DESC`
    );

    res.json({
      users: rows.map((row) => ({
        ...row,
        active: Number(row.active) !== 0,
        permissions: parsePermissions(row.permissions)
      }))
    });
  } catch (error) {
    console.error('getUsers error:', error);
    res.status(500).json({
      message: 'Failed to load users',
      error: error.message
    });
  }
};

exports.updateUserAccess = async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const role = normalizeRole(req.body.role || 'staff');
    const active = req.body.active === undefined ? true : Boolean(req.body.active);
    const permissions = parsePermissions(req.body.permissions);

    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    if (Number(req.user.id) === userId && active === false) {
      return res.status(400).json({ message: 'You cannot disable your own account' });
    }

    const allowedRoles = ['admin', 'sales', 'production', 'viewer', 'staff'];

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const [result] = await pool.query(
      `UPDATE users
       SET role = ?, permissions = ?, active = ?
       WHERE id = ?`,
      [role, JSON.stringify(permissions), active ? 1 : 0, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: 'User access updated successfully' });
  } catch (error) {
    console.error('updateUserAccess error:', error);
    res.status(500).json({
      message: 'Failed to update access',
      error: error.message
    });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const name = String(req.body.name || '').trim();
    const username = String(req.body.username || '').trim().toLowerCase();
    const email = String(req.body.email || '').trim().toLowerCase();
    const role = normalizeRole(req.body.role || 'staff');
    const active = req.body.active === undefined ? true : Boolean(req.body.active);
    const permissions = parsePermissions(req.body.permissions);

    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    if (!name || !username || !email || !role) {
      return res.status(400).json({ message: 'Name, username, email and role are required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Valid email address is required' });
    }

    if (Number(req.user.id) === userId && active === false) {
      return res.status(400).json({ message: 'You cannot disable your own account' });
    }

    const allowedRoles = ['admin', 'sales', 'production', 'viewer', 'staff'];

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM users WHERE (LOWER(email) = ? OR LOWER(username) = ?) AND id <> ? LIMIT 1',
      [email, username, userId]
    );

    if (existing.length) {
      return res.status(400).json({ message: 'Email or username is already used by another staff member' });
    }

    const [result] = await pool.query(
      `UPDATE users
       SET name = ?,
           username = ?,
           email = ?,
           role = ?,
           permissions = ?,
           active = ?
       WHERE id = ?`,
      [name, username, email, role, JSON.stringify(permissions), active ? 1 : 0, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: 'Staff details updated successfully' });
  } catch (error) {
    console.error('updateUser error:', error);
    res.status(500).json({
      message: 'Failed to update staff details',
      error: error.message
    });
  }
};

exports.resetUserPassword = async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const newPassword = String(req.body.password || '').trim();

    if (!userId || !newPassword) {
      return res.status(400).json({ message: 'User ID and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const [result] = await pool.query(
      `UPDATE users
       SET password = ?,
           password_reset_required = 1,
           last_password_reset_at = NOW()
       WHERE id = ?`,
      [hashedPassword, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      message: 'Password reset successfully. Share the new temporary password with the staff member.'
    });
  } catch (error) {
    console.error('resetUserPassword error:', error);
    res.status(500).json({
      message: 'Failed to reset password',
      error: error.message
    });
  }
};
