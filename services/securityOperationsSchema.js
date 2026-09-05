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
    classification VARCHAR(20) NOT NULL DEFAULT 'CONFIDENTIAL',
    scan_status VARCHAR(20) NOT NULL DEFAULT 'UNAVAILABLE',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME NULL,
    INDEX idx_secure_document_record (module, record_type, record_id, deleted_at),
    INDEX idx_secure_document_uploader (uploaded_by, created_at)
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
}

async function ensureSecurityOperationsSchema() {
  if (!schemaPromise) schemaPromise = createSecurityOperationsSchema().catch((error) => { schemaPromise = null; throw error; });
  return schemaPromise;
}

module.exports = { ensureSecurityOperationsSchema };
