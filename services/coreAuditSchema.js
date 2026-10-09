const pool = require('../config/db');

let schemaPromise;

async function tolerateDuplicate(sql) {
  try {
    await pool.query(sql);
  } catch (error) {
    if (!['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_TABLE_EXISTS_ERROR'].includes(error?.code)) throw error;
  }
}

async function createCoreAuditSchema() {
  // Keep the existing audit tables and columns without initializing retired
  // timesheet, payroll or operational modules. No historical entries are rewritten.
  await pool.query(`CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    actor_id INT NULL,
    action VARCHAR(120) NOT NULL,
    module VARCHAR(80) NOT NULL,
    record_type VARCHAR(80) NULL,
    record_id VARCHAR(80) NULL,
    old_value LONGTEXT NULL,
    new_value LONGTEXT NULL,
    ip_address VARCHAR(80) NULL,
    user_agent TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_audit_module_record (module, record_id),
    INDEX idx_audit_actor_created (actor_id, created_at)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS activity_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    module VARCHAR(80) NOT NULL,
    record_id VARCHAR(80) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    message TEXT NULL,
    actor_id INT NULL,
    metadata_json LONGTEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_activity_record (module, record_id, created_at)
  )`);

  const additions = [
    'ALTER TABLE audit_logs ADD COLUMN actor_id INT NULL',
    'ALTER TABLE audit_logs ADD COLUMN module VARCHAR(80) NULL',
    'ALTER TABLE audit_logs ADD COLUMN record_type VARCHAR(80) NULL',
    'ALTER TABLE audit_logs ADD COLUMN record_id VARCHAR(80) NULL',
    'ALTER TABLE audit_logs ADD COLUMN old_value LONGTEXT NULL',
    'ALTER TABLE audit_logs ADD COLUMN new_value LONGTEXT NULL',
    'ALTER TABLE audit_logs ADD COLUMN ip_address VARCHAR(80) NULL',
    'ALTER TABLE audit_logs ADD COLUMN user_agent TEXT NULL',
    'ALTER TABLE audit_logs ADD INDEX idx_audit_record (module, record_id, created_at)',
    'ALTER TABLE audit_logs ADD COLUMN request_id VARCHAR(80) NULL',
    'ALTER TABLE audit_logs ADD COLUMN session_id CHAR(36) NULL',
    "ALTER TABLE audit_logs ADD COLUMN result VARCHAR(20) NOT NULL DEFAULT 'SUCCESS'",
    'ALTER TABLE audit_logs ADD COLUMN metadata_json JSON NULL',
    'ALTER TABLE audit_logs ADD COLUMN previous_integrity_hash CHAR(64) NULL',
    'ALTER TABLE audit_logs ADD COLUMN integrity_hash CHAR(64) NULL',
    'ALTER TABLE audit_logs ADD INDEX idx_audit_request (request_id, created_at)'
  ];
  for (const sql of additions) await tolerateDuplicate(sql);
}

async function ensureCoreAuditSchema() {
  if (!schemaPromise) schemaPromise = createCoreAuditSchema().catch((error) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}

module.exports = { ensureCoreAuditSchema };
