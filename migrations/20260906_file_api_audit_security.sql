CREATE TABLE IF NOT EXISTS secure_documents (
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
) ENGINE=InnoDB;

ALTER TABLE supplier_files ADD COLUMN IF NOT EXISTS classification VARCHAR(20) NOT NULL DEFAULT 'CONFIDENTIAL';
ALTER TABLE supplier_files ADD COLUMN IF NOT EXISTS scan_status VARCHAR(20) NOT NULL DEFAULT 'UNAVAILABLE';
ALTER TABLE supplier_files ADD COLUMN IF NOT EXISTS size_bytes BIGINT NULL;
ALTER TABLE expense_files ADD COLUMN IF NOT EXISTS classification VARCHAR(20) NOT NULL DEFAULT 'RESTRICTED';
ALTER TABLE expense_files ADD COLUMN IF NOT EXISTS scan_status VARCHAR(20) NOT NULL DEFAULT 'UNAVAILABLE';
ALTER TABLE expense_files ADD COLUMN IF NOT EXISTS size_bytes BIGINT NULL;
ALTER TABLE compliance_files ADD COLUMN IF NOT EXISTS classification VARCHAR(20) NOT NULL DEFAULT 'CONFIDENTIAL';
ALTER TABLE compliance_files ADD COLUMN IF NOT EXISTS scan_status VARCHAR(20) NOT NULL DEFAULT 'UNAVAILABLE';
ALTER TABLE compliance_files ADD COLUMN IF NOT EXISTS size_bytes BIGINT NULL;
UPDATE expense_files SET classification = 'RESTRICTED';

CREATE TABLE IF NOT EXISTS security_issue_acknowledgements (
  issue_key VARCHAR(160) PRIMARY KEY,
  acknowledged_by INT NOT NULL,
  reason VARCHAR(500) NOT NULL,
  acknowledged_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
