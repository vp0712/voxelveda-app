-- Additive immutable snapshots for explicit, permission-scoped report email.
-- No business records, historical documents or queued deliveries are changed.
CREATE TABLE IF NOT EXISTS manual_report_snapshots (
  id CHAR(36) PRIMARY KEY,
  created_by INT NOT NULL,
  source_type VARCHAR(40) NOT NULL,
  descriptor_json TEXT NOT NULL,
  document_json LONGTEXT NOT NULL,
  authority_sha256 CHAR(64) NOT NULL,
  source_sha256 CHAR(64) NOT NULL,
  pdf_storage_key VARCHAR(700) NOT NULL,
  pdf_sha256 CHAR(64) NOT NULL,
  pdf_pages INT NOT NULL,
  filename VARCHAR(190) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_manual_report_owner (created_by,created_at),
  INDEX idx_manual_report_authority (created_by,authority_sha256)
) ENGINE=InnoDB;
