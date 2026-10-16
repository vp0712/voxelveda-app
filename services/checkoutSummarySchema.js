'use strict';
const pool = require('../config/db');
let pending;
const statements = [
  `CREATE TABLE IF NOT EXISTS attendance_work_categories (
    id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(120) NOT NULL,
    site_id VARCHAR(120) NULL, role_scope VARCHAR(80) NULL, active TINYINT NOT NULL DEFAULT 1,
    name_key CHAR(64) NOT NULL, revision INT NOT NULL DEFAULT 1, created_by INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_attendance_category_name(name_key), INDEX idx_attendance_category_scope(active,site_id,role_scope)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS attendance_category_requests (
    user_id INT NOT NULL, request_id CHAR(36) NOT NULL, payload_sha256 CHAR(64) NOT NULL,
    response_json LONGTEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id,request_id)
  ) ENGINE=InnoDB`
];
function ensureCheckoutSummarySchema() {
  if (!pending) pending = (async () => {
    for (const sql of statements) await pool.query(sql);
    for (const [name,type] of Object.entries({checkout_category_id:'INT NULL',checkout_task_title:'VARCHAR(180) NULL'})) {
      try { await pool.query(`ALTER TABLE staff_attendance ADD COLUMN ${name} ${type}`); }
      catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
    }
  })().catch(error => { pending = null; throw error; });
  return pending;
}
module.exports = {ensureCheckoutSummarySchema, statements};
