ALTER TABLE bank_connections
  ADD COLUMN app_user_id BIGINT NULL,
  ADD COLUMN environment VARCHAR(20) NOT NULL DEFAULT 'SANDBOX',
  ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN provider_user_id VARCHAR(180) NULL,
  ADD COLUMN next_sync_at DATETIME NULL,
  ADD COLUMN sync_cursor VARCHAR(255) NULL,
  ADD COLUMN archived_at DATETIME NULL,
  ADD COLUMN disconnected_at DATETIME NULL;

CREATE INDEX idx_bank_connections_user_status ON bank_connections (app_user_id, status, provider);
CREATE INDEX idx_bank_connections_sync_due ON bank_connections (status, next_sync_at);

CREATE TABLE bank_connection_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  connection_id BIGINT NOT NULL,
  bank_account_id INT NULL,
  provider_account_id VARCHAR(180) NOT NULL,
  account_name VARCHAR(255) NULL,
  account_type VARCHAR(80) NULL,
  account_number_masked VARCHAR(80) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'AUD',
  current_balance DECIMAL(18,2) NULL,
  available_balance DECIMAL(18,2) NULL,
  sync_enabled TINYINT(1) NOT NULL DEFAULT 1,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  provider_updated_at DATETIME NULL,
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bank_connection_provider_account (connection_id, provider_account_id),
  KEY idx_bank_connection_accounts_bank (bank_account_id, status),
  KEY idx_bank_connection_accounts_provider (provider_account_id)
);

ALTER TABLE bank_transactions
  ADD COLUMN provider_account_id VARCHAR(180) NULL,
  ADD COLUMN provider_status VARCHAR(40) NULL,
  ADD COLUMN provider_raw_hash CHAR(64) NULL,
  ADD COLUMN canonical_fingerprint CHAR(64) NULL,
  ADD COLUMN transaction_timestamp DATETIME NULL,
  ADD COLUMN provider_updated_at DATETIME NULL,
  ADD COLUMN superseded_at DATETIME NULL;

CREATE INDEX idx_bank_tx_provider_identity ON bank_transactions (source_provider, provider_transaction_id);
CREATE INDEX idx_bank_tx_fingerprint ON bank_transactions (bank_account_id, canonical_fingerprint, transaction_date);

ALTER TABLE open_banking_sync_runs
  ADD COLUMN app_user_id BIGINT NULL,
  ADD COLUMN transactions_updated INT NOT NULL DEFAULT 0,
  ADD COLUMN accounts_linked INT NOT NULL DEFAULT 0,
  ADD COLUMN cursor_before VARCHAR(255) NULL,
  ADD COLUMN cursor_after VARCHAR(255) NULL;

CREATE TABLE bank_consent_receipts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  receipt_uid VARCHAR(64) NOT NULL,
  app_user_id BIGINT UNSIGNED NOT NULL,
  connection_uid VARCHAR(64) NULL,
  provider VARCHAR(40) NOT NULL,
  provider_user_id VARCHAR(180) NULL,
  provider_consent_id VARCHAR(180) NULL,
  consent_status VARCHAR(40) NOT NULL,
  scopes_json JSON NULL,
  purpose_text VARCHAR(500) NULL,
  consented_at DATETIME NULL,
  expires_at DATETIME NULL,
  withdrawn_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bank_consent_receipt_uid (receipt_uid),
  KEY idx_bank_consent_user (app_user_id, provider, created_at),
  KEY idx_bank_consent_connection (connection_uid, consent_status)
);

CREATE TABLE bank_sync_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_uid VARCHAR(64) NOT NULL,
  sync_uid VARCHAR(64) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  event_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bank_sync_event_uid (event_uid),
  KEY idx_bank_sync_event_run (sync_uid, id)
);

ALTER TABLE statement_import_sessions
  ADD COLUMN parser_version VARCHAR(40) NULL,
  ADD COLUMN parser_confidence DECIMAL(5,4) NULL,
  ADD COLUMN reconciliation_status VARCHAR(30) NULL,
  ADD COLUMN reconciliation_difference DECIMAL(18,2) NULL,
  ADD COLUMN extraction_diagnostics_json JSON NULL;
