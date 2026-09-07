-- Voxel Veda security Phases 14-25. Additive and idempotent where MySQL permits.
ALTER TABLE user_api_tokens ADD COLUMN IF NOT EXISTS token_prefix VARCHAR(24) NULL;
ALTER TABLE user_api_tokens ADD COLUMN IF NOT EXISTS created_by INT NULL;
ALTER TABLE user_api_tokens ADD COLUMN IF NOT EXISTS last_used_ip VARCHAR(64) NULL;
ALTER TABLE user_api_tokens ADD COLUMN IF NOT EXISTS last_used_user_agent VARCHAR(255) NULL;

CREATE TABLE IF NOT EXISTS webhook_sources (
  id CHAR(36) PRIMARY KEY, source_key VARCHAR(80) NOT NULL UNIQUE, display_name VARCHAR(120) NOT NULL,
  allowed_events_json JSON NOT NULL, active TINYINT(1) NOT NULL DEFAULT 1, created_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS webhook_receipts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, source_key VARCHAR(80) NOT NULL, event_id VARCHAR(120) NOT NULL,
  event_type VARCHAR(100) NOT NULL, payload_sha256 CHAR(64) NOT NULL, signature_key_version VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACCEPTED', received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_webhook_event (source_key, event_id), INDEX idx_webhook_receipt_time (received_at, status)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS data_retention_policies (
  id CHAR(36) PRIMARY KEY, data_category VARCHAR(80) NOT NULL UNIQUE, retention_days INT NOT NULL,
  action VARCHAR(20) NOT NULL DEFAULT 'ARCHIVE', legal_basis VARCHAR(500) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1, updated_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS retention_holds (
  id CHAR(36) PRIMARY KEY, scope_type VARCHAR(40) NOT NULL, scope_id VARCHAR(120) NOT NULL,
  reason VARCHAR(500) NOT NULL, active TINYINT(1) NOT NULL DEFAULT 1, created_by INT NOT NULL,
  released_by INT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, released_at DATETIME NULL,
  INDEX idx_retention_hold_scope (scope_type, scope_id, active)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS retention_runs (
  id CHAR(36) PRIMARY KEY, policy_id CHAR(36) NOT NULL, mode VARCHAR(20) NOT NULL,
  eligible_records INT NOT NULL DEFAULT 0, archived_records INT NOT NULL DEFAULT 0,
  requested_by INT NOT NULL, approved_by INT NULL, reason VARCHAR(500) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PREVIEWED', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  executed_at DATETIME NULL, INDEX idx_retention_run_status (status, created_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS sensitive_export_requests (
  id CHAR(36) PRIMARY KEY, export_type VARCHAR(60) NOT NULL, parameters_json JSON NOT NULL,
  requested_by INT NOT NULL, approved_by INT NULL, reason VARCHAR(500) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING_APPROVAL', content_sha256 CHAR(64) NULL,
  expires_at DATETIME NOT NULL, approved_at DATETIME NULL, consumed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_export_request_status (status, expires_at), INDEX idx_export_request_actor (requested_by, created_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS security_secret_inventory (
  secret_name VARCHAR(100) PRIMARY KEY, purpose VARCHAR(300) NOT NULL, owner_role VARCHAR(60) NOT NULL,
  key_version VARCHAR(30) NOT NULL DEFAULT 'v1', rotated_at DATETIME NULL, rotate_after_days INT NOT NULL DEFAULT 180,
  last_verified_at DATETIME NULL, status VARCHAR(30) NOT NULL DEFAULT 'REVIEW_REQUIRED', updated_by INT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS backup_attestations (
  id CHAR(36) PRIMARY KEY, provider VARCHAR(100) NOT NULL, backup_reference VARCHAR(180) NOT NULL,
  backup_completed_at DATETIME NOT NULL, restore_tested_at DATETIME NULL, evidence_sha256 CHAR(64) NOT NULL,
  status VARCHAR(30) NOT NULL, attested_by INT NOT NULL, notes VARCHAR(1000) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_backup_attestation_time (backup_completed_at, status)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS malware_scan_jobs (
  id CHAR(36) PRIMARY KEY, document_id CHAR(36) NOT NULL, provider VARCHAR(60) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING_SCAN', provider_reference VARCHAR(180) NULL,
  result_sha256 CHAR(64) NULL, requested_by INT NULL, requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL, UNIQUE KEY uq_scan_document_active (document_id, status),
  INDEX idx_scan_job_status (status, requested_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS security_alert_rules (
  id CHAR(36) PRIMARY KEY, rule_key VARCHAR(100) NOT NULL UNIQUE, display_name VARCHAR(160) NOT NULL,
  severity VARCHAR(20) NOT NULL, event_types_json JSON NOT NULL, threshold_count INT NOT NULL DEFAULT 1,
  window_minutes INT NOT NULL DEFAULT 15, active TINYINT(1) NOT NULL DEFAULT 1,
  updated_by INT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS security_evidence_snapshots (
  id CHAR(36) PRIMARY KEY, evidence_type VARCHAR(80) NOT NULL, period_start DATETIME NOT NULL,
  period_end DATETIME NOT NULL, summary_json JSON NOT NULL, content_sha256 CHAR(64) NOT NULL,
  generated_by INT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_security_evidence_period (evidence_type, period_end)
) ENGINE=InnoDB;
