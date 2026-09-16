CREATE TABLE IF NOT EXISTS personal_finance_restore_runs (
  id CHAR(36) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  package_sha256 CHAR(64) NOT NULL,
  schema_version VARCHAR(40) NOT NULL,
  action_plan_sha256 CHAR(64) NOT NULL,
  approval_token_sha256 CHAR(64) NOT NULL,
  status ENUM('DRY_RUN_READY','EXECUTING','SUCCEEDED','FAILED','EXPIRED','ROLLED_BACK') NOT NULL DEFAULT 'DRY_RUN_READY',
  dry_run_summary_json LONGTEXT NOT NULL,
  requested_actions_json LONGTEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  executed_at DATETIME NULL,
  rollback_expires_at DATETIME NULL,
  rolled_back_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_personal_finance_restore_approval_token (approval_token_sha256),
  INDEX idx_personal_finance_restore_user_status (user_id, status, expires_at),
  INDEX idx_personal_finance_restore_package (user_id, package_sha256)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS personal_finance_restore_checkpoints (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  restore_run_id CHAR(36) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  dataset_name VARCHAR(100) NOT NULL,
  checkpoint_sha256 CHAR(64) NOT NULL,
  before_rows_json LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_personal_finance_restore_checkpoint_run FOREIGN KEY (restore_run_id) REFERENCES personal_finance_restore_runs(id) ON DELETE CASCADE,
  UNIQUE KEY uq_personal_finance_restore_checkpoint_dataset (restore_run_id, dataset_name),
  INDEX idx_personal_finance_restore_checkpoint_user (user_id, restore_run_id)
) ENGINE=InnoDB;
