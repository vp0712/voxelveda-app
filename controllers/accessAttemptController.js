const pool = require('../config/db');

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

exports.getAccessAttempts = async (req, res) => {
  try {
    await ensureAccessAttemptTable();
    const [rows] = await pool.query(`
      SELECT *
      FROM access_attempts
      ORDER BY id DESC
      LIMIT 50
    `);

    res.json({ attempts: rows });
  } catch (error) {
    console.error('getAccessAttempts error:', error);
    res.status(500).json({ message: 'Failed to load access attempts', error: error.message });
  }
};
