const pool = require('../config/db');

exports.clockIn = async (req, res) => {
  try {
    const userId = req.user.id;

    const [open] = await pool.query(
      'SELECT * FROM staff_attendance WHERE user_id = ? AND clock_out IS NULL LIMIT 1',
      [userId]
    );

    if (open.length) {
      return res.status(400).json({ message: 'Already clocked in' });
    }

    await pool.query(
      'INSERT INTO staff_attendance (user_id, clock_in) VALUES (?, NOW())',
      [userId]
    );

    res.json({ message: 'Clocked in successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Clock in failed', error: err.message });
  }
};

exports.clockOut = async (req, res) => {
  try {
    const userId = req.user.id;

    const [rows] = await pool.query(
      'SELECT * FROM staff_attendance WHERE user_id = ? AND clock_out IS NULL LIMIT 1',
      [userId]
    );

    if (!rows.length) {
      return res.status(400).json({ message: 'No active clock-in found' });
    }

    const attendanceId = rows[0].id;

    await pool.query(
      `UPDATE staff_attendance 
       SET clock_out = NOW(),
           total_minutes = TIMESTAMPDIFF(MINUTE, clock_in, NOW())
       WHERE id = ?`,
      [attendanceId]
    );

    res.json({ message: 'Clocked out successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Clock out failed', error: err.message });
  }
};

exports.myAttendance = async (req, res) => {
  try {
    const userId = req.user.id;

    const [rows] = await pool.query(
      `SELECT id, clock_in, clock_out, total_minutes, notes, created_at
       FROM staff_attendance
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json({ attendance: rows });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load attendance', error: err.message });
  }
};

exports.allAttendance = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin only' });
    }

    const [rows] = await pool.query(
      `SELECT 
        a.id,
        a.user_id,
        u.name,
        u.email,
        u.role,
        a.clock_in,
        a.clock_out,
        a.total_minutes,
        a.created_at
       FROM staff_attendance a
       LEFT JOIN users u ON a.user_id = u.id
       ORDER BY a.created_at DESC`
    );

    res.json({ attendance: rows });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load attendance', error: err.message });
  }
};