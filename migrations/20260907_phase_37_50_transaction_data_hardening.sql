-- Phases 37-50: additive transaction, document and browser-policy hardening.
-- This migration does not modify or delete existing business records.

ALTER TABLE payment_approval_requests ADD COLUMN IF NOT EXISTS risk_score INT NOT NULL DEFAULT 0 AFTER risk_reasons;
ALTER TABLE payment_approval_requests ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20) NOT NULL DEFAULT 'LOW' AFTER risk_score;
ALTER TABLE payment_approval_requests ADD COLUMN IF NOT EXISTS risk_snapshot JSON NULL AFTER risk_level;
ALTER TABLE payment_approval_requests ADD COLUMN IF NOT EXISTS bank_detail_id BIGINT NULL AFTER risk_snapshot;
ALTER TABLE payment_approval_requests ADD COLUMN IF NOT EXISTS expires_at DATETIME NULL AFTER initiated_at;

ALTER TABLE secure_documents ADD COLUMN IF NOT EXISTS content_sha256 CHAR(64) NULL AFTER size_bytes;
ALTER TABLE secure_documents ADD COLUMN IF NOT EXISTS access_policy VARCHAR(40) NOT NULL DEFAULT 'MODULE_OR_OWNER' AFTER classification;

CREATE TABLE IF NOT EXISTS document_download_grants (
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
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS security_policy_violations (
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
) ENGINE=InnoDB;
