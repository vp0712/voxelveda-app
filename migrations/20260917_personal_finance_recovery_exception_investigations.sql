CREATE TABLE IF NOT EXISTS personal_finance_recovery_evidence_investigations (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  discrepancy_key VARCHAR(255) NOT NULL,
  source_type VARCHAR(64) NOT NULL,
  source_id VARCHAR(191) NOT NULL,
  affected_ref_id VARCHAR(191) NULL,
  discrepancy_code VARCHAR(120) NOT NULL,
  severity ENUM('CRITICAL','HIGH','MEDIUM','LOW') NOT NULL,
  status ENUM('OPEN','INVESTIGATING','RESOLUTION_PENDING','VERIFIED','CLOSED') NOT NULL DEFAULT 'OPEN',
  owner_label VARCHAR(120) NULL,
  observed_details_json JSON NULL,
  investigation_notes_json JSON NULL,
  preservation_refs_json JSON NULL,
  resolution_note VARCHAR(1000) NULL,
  verification_status ENUM('NOT_CHECKED','STILL_PRESENT','CLEARED','UNVERIFIABLE') NOT NULL DEFAULT 'NOT_CHECKED',
  verification_details_json JSON NULL,
  verified_at DATETIME NULL,
  closed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_pf_recovery_evidence_inv_owner_status (user_id, status),
  KEY idx_pf_recovery_evidence_inv_owner_severity (user_id, severity, status),
  KEY idx_pf_recovery_evidence_inv_owner_source (user_id, source_type, source_id)
);

CREATE TABLE IF NOT EXISTS personal_finance_recovery_evidence_investigation_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  investigation_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  event_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pf_recovery_evidence_inv_events_owner_case (user_id, investigation_id, id)
);
