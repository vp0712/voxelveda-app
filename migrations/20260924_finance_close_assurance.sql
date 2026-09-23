CREATE TABLE IF NOT EXISTS finance_period_close_runs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  close_uid CHAR(36) NOT NULL,
  accounting_period_id INT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
  certified_snapshot_id BIGINT NULL,
  certified_fingerprint CHAR(64) NULL,
  certification_note VARCHAR(1000) NULL,
  certified_by INT NULL,
  certified_at DATETIME NULL,
  reopened_by INT NULL,
  reopened_at DATETIME NULL,
  reopen_reason VARCHAR(1000) NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_finance_period_close_uid (close_uid),
  UNIQUE KEY uniq_finance_period_close_period (accounting_period_id),
  INDEX idx_finance_period_close_status (status,updated_at)
);

CREATE TABLE IF NOT EXISTS finance_period_close_snapshots (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  snapshot_uid CHAR(36) NOT NULL,
  accounting_period_id INT NOT NULL,
  close_run_id BIGINT NOT NULL,
  readiness_status VARCHAR(32) NOT NULL,
  blocker_count INT NOT NULL DEFAULT 0,
  warning_count INT NOT NULL DEFAULT 0,
  evidence_json LONGTEXT NOT NULL,
  evidence_hash CHAR(64) NOT NULL,
  captured_by INT NULL,
  captured_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_finance_close_snapshot_uid (snapshot_uid),
  INDEX idx_finance_close_snapshot_period (accounting_period_id,captured_at),
  INDEX idx_finance_close_snapshot_run (close_run_id,captured_at)
);
