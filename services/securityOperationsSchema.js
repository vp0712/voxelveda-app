const pool = require('../config/db');

let schemaPromise;

async function tolerateDuplicate(sql) {
  try { await pool.query(sql); } catch (error) {
    if (!['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_TABLE_EXISTS_ERROR'].includes(error?.code)) throw error;
  }
}

async function createSecurityOperationsSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS secure_documents (
    id CHAR(36) PRIMARY KEY,
    module VARCHAR(40) NOT NULL,
    record_type VARCHAR(60) NOT NULL,
    record_id VARCHAR(80) NOT NULL,
    owner_user_id INT NULL,
    uploaded_by INT NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    stored_name VARCHAR(255) NOT NULL,
    storage_path TEXT NOT NULL,
    mime_type VARCHAR(120) NOT NULL,
    size_bytes BIGINT NOT NULL,
    content_sha256 CHAR(64) NULL,
    classification VARCHAR(20) NOT NULL DEFAULT 'CONFIDENTIAL',
    access_policy VARCHAR(40) NOT NULL DEFAULT 'MODULE_OR_OWNER',
    scan_status VARCHAR(20) NOT NULL DEFAULT 'UNAVAILABLE',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME NULL,
    INDEX idx_secure_document_record (module, record_type, record_id, deleted_at),
    INDEX idx_secure_document_uploader (uploaded_by, created_at)
  ) ENGINE=InnoDB`);

  await tolerateDuplicate('ALTER TABLE secure_documents ADD COLUMN content_sha256 CHAR(64) NULL AFTER size_bytes');
  await tolerateDuplicate("ALTER TABLE secure_documents ADD COLUMN access_policy VARCHAR(40) NOT NULL DEFAULT 'MODULE_OR_OWNER' AFTER classification");
  await pool.query(`CREATE TABLE IF NOT EXISTS document_download_grants (
    id CHAR(36) PRIMARY KEY,
    document_id CHAR(36) NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    bound_user_id INT NOT NULL,
    created_by INT NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_document_grant_lookup (token_hash, expires_at, used_at),
    INDEX idx_document_grant_document (document_id, created_at)
  ) ENGINE=InnoDB`);

  await pool.query(`CREATE TABLE IF NOT EXISTS security_policy_violations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    request_id VARCHAR(80) NULL,
    document_origin VARCHAR(255) NULL,
    blocked_origin VARCHAR(255) NULL,
    violated_directive VARCHAR(120) NOT NULL,
    effective_directive VARCHAR(120) NULL,
    disposition VARCHAR(20) NULL,
    source_file VARCHAR(255) NULL,
    line_number INT NULL,
    user_agent VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_policy_violation_time (created_at, violated_directive)
  ) ENGINE=InnoDB`);

  for (const table of ['supplier_files', 'expense_files', 'compliance_files']) {
    const [[exists]] = await pool.query(
      'SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
      [table]
    );
    if (!Number(exists.count)) continue;
    await tolerateDuplicate(`ALTER TABLE ${table} ADD COLUMN classification VARCHAR(20) NOT NULL DEFAULT 'CONFIDENTIAL'`);
    await tolerateDuplicate(`ALTER TABLE ${table} ADD COLUMN scan_status VARCHAR(20) NOT NULL DEFAULT 'UNAVAILABLE'`);
    await tolerateDuplicate(`ALTER TABLE ${table} ADD COLUMN size_bytes BIGINT NULL`);
  }
  await pool.query("UPDATE expense_files SET classification = 'RESTRICTED' WHERE classification IS NULL OR classification = 'CONFIDENTIAL'").catch(() => {});

  await pool.query(`CREATE TABLE IF NOT EXISTS security_issue_acknowledgements (
    issue_key VARCHAR(160) PRIMARY KEY,
    acknowledged_by INT NOT NULL,
    reason VARCHAR(500) NOT NULL,
    acknowledged_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);

  await pool.query(`CREATE TABLE IF NOT EXISTS security_incidents (
    id CHAR(36) PRIMARY KEY,
    title VARCHAR(180) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
    scope VARCHAR(40) NOT NULL DEFAULT 'ACCOUNT',
    summary VARCHAR(2000) NOT NULL,
    opened_by INT NOT NULL,
    incident_commander_id INT NULL,
    opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    contained_at DATETIME NULL,
    resolved_at DATETIME NULL,
    closed_at DATETIME NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_security_incident_status (status, severity, opened_at),
    INDEX idx_security_incident_commander (incident_commander_id, status)
  ) ENGINE=InnoDB`);

  await pool.query(`CREATE TABLE IF NOT EXISTS security_incident_actions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    incident_id CHAR(36) NOT NULL,
    action_type VARCHAR(80) NOT NULL,
    actor_id INT NOT NULL,
    target_user_id INT NULL,
    reason VARCHAR(1000) NOT NULL,
    result VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
    request_id VARCHAR(80) NULL,
    ip_address VARCHAR(64) NULL,
    user_agent VARCHAR(255) NULL,
    metadata_json JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_incident_action_incident (incident_id, created_at),
    INDEX idx_incident_action_actor (actor_id, created_at)
  ) ENGINE=InnoDB`);

  await pool.query(`CREATE TABLE IF NOT EXISTS security_report_snapshots (
    id CHAR(36) PRIMARY KEY,
    period_start DATETIME NOT NULL,
    period_end DATETIME NOT NULL,
    generated_by INT NOT NULL,
    summary_json JSON NOT NULL,
    content_sha256 CHAR(64) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_security_report_period (period_end, created_at)
  ) ENGINE=InnoDB`);
}

async function ensureSecurityOperationsSchema() {
  if (!schemaPromise) schemaPromise = createSecurityOperationsSchema().catch((error) => { schemaPromise = null; throw error; });
  return schemaPromise;
}

module.exports = { ensureSecurityOperationsSchema };
