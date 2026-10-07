-- Immutable report contents are retained independently of optional PDF artifacts.
CREATE TABLE IF NOT EXISTS finance_report_snapshots (
  report_uid VARCHAR(80) PRIMARY KEY,
  created_by INT NOT NULL,
  report_type VARCHAR(40) NOT NULL,
  workspace_scope VARCHAR(20) NOT NULL,
  metadata_json JSON NOT NULL,
  filters_json JSON NOT NULL,
  accounts_json JSON NOT NULL,
  summary_json JSON NOT NULL,
  snapshot_sha256 CHAR(64) NOT NULL,
  snapshot_bytes BIGINT NOT NULL,
  snapshot_chunks INT NOT NULL,
  pdf_status VARCHAR(20) NOT NULL DEFAULT 'NOT_GENERATED',
  pdf_metadata_json JSON NULL,
  email_outcome_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NULL,
  revoked_at DATETIME NULL,
  INDEX idx_finance_report_snapshot_owner (created_by, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS finance_report_snapshot_chunks (
  report_uid VARCHAR(80) NOT NULL,
  artifact_kind VARCHAR(12) NOT NULL,
  chunk_index INT NOT NULL,
  content MEDIUMBLOB NOT NULL,
  PRIMARY KEY (report_uid, artifact_kind, chunk_index),
  CONSTRAINT fk_finance_report_snapshot_chunk FOREIGN KEY (report_uid)
    REFERENCES finance_report_snapshots(report_uid) ON DELETE RESTRICT
) ENGINE=InnoDB;
