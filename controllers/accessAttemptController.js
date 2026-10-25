const pool = require('../config/db');
const { assertOriginalRegisterSchema } = require('../services/originalRegisterSchema');

function ensureAccessAttemptTable() {
  return assertOriginalRegisterSchema('access_attempts', pool);
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
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Failed to load access attempts', code: error.code });
  }
};
