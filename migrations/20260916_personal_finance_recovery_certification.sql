CREATE TABLE IF NOT EXISTS personal_finance_recovery_certificates (
  id CHAR(36) PRIMARY KEY,
  restore_run_id CHAR(36) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  verification_status VARCHAR(32) NOT NULL,
  package_sha256 CHAR(64) NOT NULL,
  previous_certificate_sha256 CHAR(64) NULL,
  certificate_sha256 CHAR(64) NOT NULL,
  evidence_json JSON NOT NULL,
  generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pf_recovery_cert_sequence (restore_run_id, user_id, sequence_no),
  UNIQUE KEY uq_pf_recovery_cert_hash (certificate_sha256),
  INDEX idx_pf_recovery_cert_owner_run (user_id, restore_run_id, generated_at),
  CONSTRAINT fk_pf_recovery_cert_run FOREIGN KEY (restore_run_id) REFERENCES personal_finance_restore_runs(id)
) ENGINE=InnoDB;
