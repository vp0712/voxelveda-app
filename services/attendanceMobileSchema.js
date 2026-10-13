'use strict';
const pool = require('../config/db');
let schemaPromise;
async function additive(sql) {
  try { await pool.query(sql); } catch (error) { if (!['ER_DUP_FIELDNAME','ER_DUP_KEYNAME'].includes(error.code)) throw error; }
}
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS attendance_action_receipts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, request_id CHAR(36) NOT NULL,
    action VARCHAR(40) NOT NULL, attendance_id INT NULL, payload_sha256 CHAR(64) NOT NULL,
    response_json LONGTEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_attendance_action_request(user_id,request_id), INDEX idx_attendance_receipt_session(attendance_id,created_at)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS attendance_break_intervals (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, attendance_id INT NOT NULL, user_id INT NOT NULL,
    started_at DATETIME NOT NULL, ended_at DATETIME NULL,
    start_request_id CHAR(36) NOT NULL, end_request_id CHAR(36) NULL,
    superseded_at DATETIME NULL, superseded_by INT NULL, superseded_attendance_revision INT NULL, superseded_by_correction_id BIGINT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_attendance_break_start(user_id,start_request_id), INDEX idx_attendance_break_session(attendance_id,started_at)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS attendance_correction_requests (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, attendance_id INT NULL,
    request_id CHAR(36) NOT NULL, payload_sha256 CHAR(64) NOT NULL,
    attendance_revision INT NULL, revision INT NOT NULL DEFAULT 1, status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    reason VARCHAR(1000) NOT NULL, proposed_json LONGTEXT NOT NULL, before_json LONGTEXT NOT NULL,
    decision_reason VARCHAR(1000) NULL, decided_by INT NULL, decided_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_attendance_correction_request(user_id,request_id), INDEX idx_attendance_correction_owner(user_id,status,created_at)
  ) ENGINE=InnoDB`
];
function ensureAttendanceMobileSchema() {
  if (!schemaPromise) schemaPromise = (async () => {
    for (const [name,type] of Object.entries({revision:'INT NOT NULL DEFAULT 1',checkout_task_id:'INT NULL',checkout_category:'VARCHAR(120) NULL',break_tracking_base_minutes:'INT NULL'})) await additive(`ALTER TABLE staff_attendance ADD COLUMN ${name} ${type}`);
    for (const sql of STATEMENTS) await pool.query(sql);
    for(const [name,type] of Object.entries({superseded_at:'DATETIME NULL',superseded_by:'INT NULL',superseded_attendance_revision:'INT NULL',superseded_by_correction_id:'BIGINT NULL'})) await additive(`ALTER TABLE attendance_break_intervals ADD COLUMN ${name} ${type}`);
    // Widen nullability only: retain all original IDs, values and history.
    await pool.query('ALTER TABLE attendance_correction_requests MODIFY COLUMN attendance_id INT NULL');
    await pool.query('ALTER TABLE attendance_correction_requests MODIFY COLUMN attendance_revision INT NULL');
  })().catch(error => { schemaPromise = null; throw error; });
  return schemaPromise;
}
module.exports = {ensureAttendanceMobileSchema,STATEMENTS};
