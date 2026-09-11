CREATE TABLE IF NOT EXISTS background_job_leases (
  job_key VARCHAR(190) NOT NULL,
  lease_owner VARCHAR(190) NOT NULL,
  lease_token CHAR(36) NOT NULL,
  acquired_at DATETIME(3) NOT NULL,
  heartbeat_at DATETIME(3) NOT NULL,
  lease_expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (job_key),
  INDEX idx_background_job_leases_expiry (lease_expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS background_job_runs (
  run_uuid CHAR(36) NOT NULL,
  job_key VARCHAR(190) NOT NULL,
  lease_token CHAR(36) NOT NULL,
  started_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  status VARCHAR(20) NOT NULL,
  attempt INT UNSIGNED NOT NULL DEFAULT 1,
  processed_count INT UNSIGNED NOT NULL DEFAULT 0,
  failed_count INT UNSIGNED NOT NULL DEFAULT 0,
  deployment_sha VARCHAR(80) NULL,
  trigger_source VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
  requested_by INT NULL,
  next_attempt_at DATETIME(3) NULL,
  error_code VARCHAR(100) NULL,
  error_summary VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (run_uuid),
  INDEX idx_background_job_runs_latest (job_key, started_at),
  INDEX idx_background_job_runs_retry (status, next_attempt_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS background_job_failures (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_uuid CHAR(36) NOT NULL,
  job_key VARCHAR(190) NOT NULL,
  attempt INT UNSIGNED NOT NULL,
  error_code VARCHAR(100) NOT NULL,
  error_summary VARCHAR(1000) NOT NULL,
  retry_at DATETIME(3) NULL,
  failed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_background_job_failure_run (run_uuid),
  INDEX idx_background_job_failures_job (job_key, failed_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS background_job_dead_letters (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_uuid CHAR(36) NOT NULL,
  job_key VARCHAR(190) NOT NULL,
  attempt INT UNSIGNED NOT NULL,
  error_code VARCHAR(100) NOT NULL,
  error_summary VARCHAR(1000) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  retry_requested_by INT NULL,
  retry_requested_at DATETIME(3) NULL,
  retry_run_uuid CHAR(36) NULL,
  resolved_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_background_job_dead_letter_run (run_uuid),
  INDEX idx_background_job_dead_letters_open (status, job_key, created_at)
) ENGINE=InnoDB;
