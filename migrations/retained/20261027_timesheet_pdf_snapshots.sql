-- Immutable, private PDF snapshots shared by weekly app downloads and email.
-- No recipient is required to preview/download one's authorised worked week.
CREATE TABLE IF NOT EXISTS timesheet_pdf_snapshots (
  source_key CHAR(64) NOT NULL PRIMARY KEY,
  user_id INT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  version_no INT NOT NULL,
  layout_version VARCHAR(40) NOT NULL,
  snapshot_json LONGTEXT NOT NULL,
  document_json LONGTEXT NOT NULL,
  pdf_object_key VARCHAR(300) NULL,
  pdf_sha256 CHAR(64) NULL,
  pdf_filename VARCHAR(180) NULL,
  pdf_pages INT NULL,
  pdf_bytes_count INT NULL,
  generation_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  last_error_code VARCHAR(100) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_timesheet_pdf_staff_period (user_id, period_start, period_end)
) ENGINE=InnoDB;
