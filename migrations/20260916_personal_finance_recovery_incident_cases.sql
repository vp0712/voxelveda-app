CREATE TABLE IF NOT EXISTS personal_finance_recovery_incident_cases (
  id CHAR(36) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  restore_run_id CHAR(36) NOT NULL,
  case_key CHAR(64) NOT NULL,
  source_level VARCHAR(24) NOT NULL,
  source_signal_type VARCHAR(64) NOT NULL,
  title VARCHAR(220) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  remediation_decision VARCHAR(64) NULL,
  resolution_verification_status VARCHAR(32) NULL,
  closure_reason VARCHAR(500) NULL,
  linked_certificate_id CHAR(36) NULL,
  opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  closed_at DATETIME NULL,
  UNIQUE KEY uq_pf_recovery_case_owner_key (user_id, case_key),
  INDEX idx_pf_recovery_case_owner_status (user_id, status, updated_at),
  INDEX idx_pf_recovery_case_owner_run (user_id, restore_run_id),
  CONSTRAINT fk_pf_recovery_case_run FOREIGN KEY (restore_run_id) REFERENCES personal_finance_restore_runs(id),
  CONSTRAINT fk_pf_recovery_case_certificate FOREIGN KEY (linked_certificate_id) REFERENCES personal_finance_recovery_certificates(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS personal_finance_recovery_incident_case_events (
  id CHAR(36) PRIMARY KEY,
  case_id CHAR(36) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  event_type VARCHAR(48) NOT NULL,
  note VARCHAR(1200) NULL,
  evidence_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pf_recovery_case_event_owner_case (user_id, case_id, created_at),
  CONSTRAINT fk_pf_recovery_case_event_case FOREIGN KEY (case_id) REFERENCES personal_finance_recovery_incident_cases(id) ON DELETE CASCADE
) ENGINE=InnoDB;
