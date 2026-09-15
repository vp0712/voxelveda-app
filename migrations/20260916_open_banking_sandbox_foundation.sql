CREATE TABLE IF NOT EXISTS open_banking_provider_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  app_user_id BIGINT UNSIGNED NOT NULL,
  provider VARCHAR(40) NOT NULL,
  provider_user_id VARCHAR(180) NOT NULL,
  environment VARCHAR(20) NOT NULL DEFAULT 'SANDBOX',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_open_banking_provider_user (app_user_id, provider, environment),
  KEY idx_open_banking_provider_external (provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS open_banking_consent_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_uid VARCHAR(64) NOT NULL,
  app_user_id BIGINT UNSIGNED NOT NULL,
  provider VARCHAR(40) NOT NULL,
  environment VARCHAR(20) NOT NULL DEFAULT 'SANDBOX',
  state_hash CHAR(64) NOT NULL,
  provider_user_id VARCHAR(180) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'CREATED',
  consent_url_created_at DATETIME NULL,
  expires_at DATETIME NOT NULL,
  completed_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  last_error_code VARCHAR(100) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_open_banking_consent_session_uid (session_uid),
  UNIQUE KEY uq_open_banking_consent_state (state_hash),
  KEY idx_open_banking_consent_user (app_user_id, provider, environment, status),
  KEY idx_open_banking_consent_expiry (expires_at, status)
);

CREATE TABLE IF NOT EXISTS open_banking_sync_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sync_uid VARCHAR(64) NOT NULL,
  connection_uid VARCHAR(64) NULL,
  provider VARCHAR(40) NOT NULL,
  environment VARCHAR(20) NOT NULL DEFAULT 'SANDBOX',
  trigger_type VARCHAR(30) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'QUEUED',
  accounts_seen INT NOT NULL DEFAULT 0,
  transactions_seen INT NOT NULL DEFAULT 0,
  transactions_inserted INT NOT NULL DEFAULT 0,
  duplicates_skipped INT NOT NULL DEFAULT 0,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  error_code VARCHAR(100) NULL,
  error_detail VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_open_banking_sync_uid (sync_uid),
  KEY idx_open_banking_sync_connection (connection_uid, created_at),
  KEY idx_open_banking_sync_status (status, created_at)
);

CREATE TABLE IF NOT EXISTS open_banking_webhook_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider VARCHAR(40) NOT NULL,
  provider_event_id VARCHAR(180) NOT NULL,
  event_type VARCHAR(120) NULL,
  payload_hash CHAR(64) NOT NULL,
  signature_verified TINYINT(1) NOT NULL DEFAULT 0,
  processing_status VARCHAR(30) NOT NULL DEFAULT 'RECEIVED',
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  error_code VARCHAR(100) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_open_banking_webhook_event (provider, provider_event_id),
  KEY idx_open_banking_webhook_status (processing_status, received_at)
);