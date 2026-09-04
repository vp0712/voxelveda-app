const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const { validatePassword } = require('../services/passwordPolicy');

async function seedAdmin() {
  try {
    await pool.query(`ALTER TABLE users MODIFY password VARCHAR(255) NOT NULL`);
    await pool.query(`ALTER TABLE users ADD COLUMN name VARCHAR(100) NULL`).catch(() => {});
    await pool.query(`ALTER TABLE users ADD COLUMN username VARCHAR(120) NULL`).catch(() => {});
    await pool.query(`ALTER TABLE users ADD COLUMN role VARCHAR(50) NOT NULL DEFAULT 'admin'`).catch(() => {});
    await pool.query(`ALTER TABLE users ADD COLUMN permissions LONGTEXT NULL`).catch(() => {});
    await pool.query(`ALTER TABLE users ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1`).catch(() => {});
    await pool.query(`ALTER TABLE users ADD COLUMN password_reset_required TINYINT(1) NOT NULL DEFAULT 0`).catch(() => {});
    await pool.query(`ALTER TABLE users ADD COLUMN last_password_reset_at DATETIME NULL`).catch(() => {});
    await pool.query(`ALTER TABLE users ADD COLUMN deleted_at DATETIME NULL`).catch(() => {});
    await pool.query(`ALTER TABLE users ADD COLUMN deleted_by INT NULL`).catch(() => {});
    await pool.query(`ALTER TABLE users ADD COLUMN deletion_reason VARCHAR(255) NULL`).catch(() => {});

    if (process.env.NODE_ENV === 'production') throw new Error('Admin bootstrap is prohibited in production');
    const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const adminPassword = String(process.env.ADMIN_PASSWORD || '');
    if (!adminEmail || !adminPassword) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required for explicit bootstrap');
    const passwordCheck = validatePassword(adminPassword, { email: adminEmail, username: 'admin', name: 'Admin' });
    if (!passwordCheck.valid) throw new Error(passwordCheck.errors[0]);

    const [existing] = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1',
      [adminEmail]
    );

    if (existing.length) {
      console.log('Admin user already exists; seed skipped');
      return;
    }

    const hash = await bcrypt.hash(adminPassword, 10);

    await pool.query(`
      INSERT INTO users (name, username, email, password, role, permissions, active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `, ['Admin', 'admin', adminEmail, hash, 'admin', JSON.stringify(['dashboard', 'rfqs', 'invoices', 'tasks', 'attendance', 'staff', 'settings', 'stock'])]);

    console.log('✅ Admin user seeded successfully');
  } catch (err) {
    console.error('❌ Admin seed failed:', err.message);
  }
}

module.exports = seedAdmin;
