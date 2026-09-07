-- Phases 51-70: additive identity governance, audit integrity and delegated-access controls.
-- No business record is deleted and no production secret value is stored by this migration.

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS request_id VARCHAR(80) NULL;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS session_id CHAR(36) NULL;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS result VARCHAR(20) NOT NULL DEFAULT 'SUCCESS';
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS metadata_json JSON NULL;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS previous_integrity_hash CHAR(64) NULL;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS integrity_hash CHAR(64) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terminated_at DATETIME NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terminated_by INT NULL;

CREATE TABLE IF NOT EXISTS break_glass_requests (
  id CHAR(36) PRIMARY KEY, beneficiary_user_id INT NOT NULL, permissions_json JSON NOT NULL,
  incident_reference VARCHAR(120) NOT NULL, reason VARCHAR(1000) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING_APPROVAL', requested_by INT NOT NULL,
  approved_by INT NULL, requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at DATETIME NULL, activated_at DATETIME NULL, expires_at DATETIME NOT NULL,
  revoked_by INT NULL, revoked_at DATETIME NULL, revoke_reason VARCHAR(500) NULL,
  INDEX idx_break_glass_active (beneficiary_user_id,status,expires_at),
  INDEX idx_break_glass_review (status,requested_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS impersonation_contexts (
  id CHAR(36) PRIMARY KEY, context_token_hash CHAR(64) NOT NULL UNIQUE,
  actor_user_id INT NOT NULL, actor_session_id CHAR(36) NOT NULL, target_user_id INT NOT NULL,
  reason VARCHAR(700) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL,
  ended_at DATETIME NULL, ended_by INT NULL,
  INDEX idx_impersonation_actor (actor_user_id,actor_session_id,status,expires_at),
  INDEX idx_impersonation_target (target_user_id,status,expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS database_security_attestations (
  id CHAR(36) PRIMARY KEY, database_identity VARCHAR(160) NOT NULL,
  privilege_scope VARCHAR(500) NOT NULL, tls_in_use TINYINT(1) NOT NULL,
  least_privilege_verified TINYINT(1) NOT NULL, provider_evidence_reference VARCHAR(500) NOT NULL,
  status VARCHAR(30) NOT NULL, attested_by INT NOT NULL, reviewed_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_db_attestation_status (status,expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sensitive_data_registry (
  id CHAR(36) PRIMARY KEY, record_type VARCHAR(100) NOT NULL, field_name VARCHAR(120) NOT NULL,
  classification VARCHAR(20) NOT NULL, protection_method VARCHAR(80) NOT NULL,
  key_name VARCHAR(100) NULL, status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  reviewed_by INT NULL, reviewed_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sensitive_data_field (record_type,field_name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ownership_transfer_events (
  id CHAR(36) PRIMARY KEY, source_user_id INT NOT NULL, destination_user_id INT NOT NULL,
  transfer_reason VARCHAR(500) NOT NULL, transferred_counts_json JSON NOT NULL,
  transferred_by INT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ownership_transfer_source (source_user_id,created_at)
) ENGINE=InnoDB;

INSERT IGNORE INTO sensitive_data_registry
  (id,record_type,field_name,classification,protection_method,key_name) VALUES
  (UUID(),'sensitive_bank_details','account_name_ciphertext','RESTRICTED','AES-256-GCM','FINANCE_ENCRYPTION_KEY'),
  (UUID(),'sensitive_bank_details','bsb_ciphertext','RESTRICTED','AES-256-GCM','FINANCE_ENCRYPTION_KEY'),
  (UUID(),'sensitive_bank_details','account_number_ciphertext','RESTRICTED','AES-256-GCM','FINANCE_ENCRYPTION_KEY'),
  (UUID(),'user_mfa_totp','secret_ciphertext','RESTRICTED','AES-256-GCM','MFA_ENCRYPTION_KEY'),
  (UUID(),'auth_sessions','token_hash','RESTRICTED','SHA-256 HASH',NULL),
  (UUID(),'mfa_recovery_codes','code_hash','RESTRICTED','SHA-256 HASH',NULL),
  (UUID(),'user_api_tokens','token_hash','RESTRICTED','SHA-256 HASH',NULL),
  (UUID(),'document_download_grants','token_hash','RESTRICTED','SHA-256 HASH',NULL);
