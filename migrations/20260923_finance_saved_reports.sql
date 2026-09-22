CREATE TABLE IF NOT EXISTS finance_saved_reports (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  report_uid VARCHAR(64) NOT NULL,
  name VARCHAR(160) NOT NULL,
  report_type VARCHAR(40) NOT NULL DEFAULT 'TRANSACTION_REGISTER',
  definition_json JSON NOT NULL,
  created_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_run_at DATETIME NULL,
  UNIQUE KEY uniq_finance_saved_report_uid (report_uid),
  INDEX idx_finance_saved_reports_owner (created_by, updated_at)
);
