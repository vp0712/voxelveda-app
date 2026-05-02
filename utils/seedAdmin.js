const pool = require('../config/db');
const bcrypt = require('bcryptjs');

async function seedAdmin() {
  try {
    await pool.query(`ALTER TABLE users MODIFY password VARCHAR(255) NOT NULL`);
    await pool.query(`ALTER TABLE users ADD COLUMN name VARCHAR(100) NULL`).catch(() => {});
    await pool.query(`ALTER TABLE users ADD COLUMN role VARCHAR(50) NOT NULL DEFAULT 'admin'`).catch(() => {});

    const hash = await bcrypt.hash('123456', 10);

    await pool.query(`
      DELETE FROM users WHERE email = ?
    `, ['admin@test.com']);

    await pool.query(`
      INSERT INTO users (name, email, password, role)
      VALUES (?, ?, ?, ?)
    `, ['Admin', 'admin@test.com', hash, 'admin']);

    console.log('✅ Admin user seeded successfully');
  } catch (err) {
    console.error('❌ Admin seed failed:', err.message);
  }
}

module.exports = seedAdmin;