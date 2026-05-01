const pool = require('../config/db');
const bcrypt = require('bcryptjs');

exports.createUser = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: 'Name, email, password and role are required' });
    }

    const allowedRoles = ['admin', 'sales', 'production', 'viewer', 'staff'];

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [email]
    );

    if (existing.length) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [name, email, hashedPassword, role]
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
      'SELECT id, name, email, role FROM users ORDER BY id DESC'
    );

    res.json({ users: rows });
  } catch (error) {
    console.error('getUsers error:', error);
    res.status(500).json({
      message: 'Failed to load users',
      error: error.message
    });
  }
};