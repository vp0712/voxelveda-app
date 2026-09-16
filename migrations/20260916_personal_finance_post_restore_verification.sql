CREATE TABLE IF NOT EXISTS personal_finance_restore_verification_targets (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  restore_run_id CHAR(36) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  dataset_name VARCHAR(100) NOT NULL,
  restore_action ENUM('ADD','REPLACE') NOT NULL,
  expected_count INT NOT NULL DEFAULT 0,
  expected_records_json LONGTEXT NOT NULL,
  target_sha256 CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pf_restore_verification_run FOREIGN KEY (restore_run_id) REFERENCES personal_finance_restore_runs(id) ON DELETE CASCADE,
  UNIQUE KEY uq_pf_restore_verification_dataset (restore_run_id,dataset_name),
  INDEX idx_pf_restore_verification_user_run (user_id,restore_run_id)
) ENGINE=InnoDB;
