CREATE TABLE IF NOT EXISTS public_submission_dedupe (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  submission_type VARCHAR(64) NOT NULL,
  dedupe_key CHAR(64) NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  lock_token CHAR(36) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PROCESSING',
  response_status SMALLINT UNSIGNED NULL,
  response_json JSON NULL,
  expires_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_public_submission_dedupe (submission_type, dedupe_key),
  KEY idx_public_submission_expiry (expires_at),
  KEY idx_public_submission_status (status, updated_at)
) ENGINE=InnoDB;
