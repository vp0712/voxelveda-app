ALTER TABLE bank_accounts
  ADD COLUMN ownership_scope VARCHAR(20) NOT NULL DEFAULT 'BUSINESS',
  ADD COLUMN entity_name VARCHAR(180) NULL,
  ADD COLUMN account_type VARCHAR(50) NULL,
  ADD COLUMN financial_purpose VARCHAR(80) NULL,
  ADD COLUMN connection_type VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN connection_status VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN available_balance DECIMAL(18,2) NULL,
  ADD COLUMN history_start_date DATE NULL,
  ADD COLUMN history_end_date DATE NULL,
  ADD COLUMN last_synced_at DATETIME NULL;

ALTER TABLE bank_transactions
  ADD COLUMN source_type VARCHAR(30) NOT NULL DEFAULT 'STATEMENT_IMPORT',
  ADD COLUMN source_provider VARCHAR(80) NULL,
  ADD COLUMN provider_transaction_id VARCHAR(180) NULL,
  ADD COLUMN merchant_name VARCHAR(255) NULL,
  ADD COLUMN posting_date DATE NULL,
  ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'AUD',
  ADD COLUMN ownership_scope VARCHAR(20) NOT NULL DEFAULT 'BUSINESS',
  ADD COLUMN category VARCHAR(120) NULL,
  ADD COLUMN classification_status VARCHAR(30) NOT NULL DEFAULT 'UNCLASSIFIED',
  ADD COLUMN is_internal_transfer TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX idx_bank_accounts_scope_status ON bank_accounts (ownership_scope, status);
CREATE INDEX idx_bank_transactions_scope_date ON bank_transactions (ownership_scope, transaction_date);
CREATE INDEX idx_bank_transactions_source_provider ON bank_transactions (source_type, source_provider, provider_transaction_id);

CREATE TABLE bank_connections (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  connection_uid VARCHAR(60) NOT NULL,
  provider VARCHAR(80) NOT NULL,
  institution VARCHAR(180) NULL,
  provider_connection_id VARCHAR(180) NULL,
  consent_status VARCHAR(30) NOT NULL DEFAULT 'NOT_CONFIGURED',
  consent_expires_at DATETIME NULL,
  last_sync_started_at DATETIME NULL,
  last_sync_completed_at DATETIME NULL,
  last_sync_status VARCHAR(30) NULL,
  last_sync_error_code VARCHAR(80) NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_bank_connection_uid (connection_uid),
  UNIQUE KEY uniq_provider_connection (provider, provider_connection_id),
  INDEX idx_bank_connection_status (provider, consent_status)
);

CREATE TABLE statement_import_files (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  import_uid VARCHAR(60) NOT NULL,
  bank_account_id INT NOT NULL,
  source_format VARCHAR(20) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  content_hash CHAR(64) NOT NULL,
  statement_start_date DATE NULL,
  statement_end_date DATE NULL,
  opening_balance DECIMAL(18,2) NULL,
  closing_balance DECIMAL(18,2) NULL,
  parse_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  imported_rows INT NOT NULL DEFAULT 0,
  duplicate_rows INT NOT NULL DEFAULT 0,
  rejected_rows INT NOT NULL DEFAULT 0,
  uploaded_by INT NULL,
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME NULL,
  reviewed_by INT NULL,
  UNIQUE KEY uniq_statement_import_uid (import_uid),
  UNIQUE KEY uniq_statement_account_hash (bank_account_id, content_hash),
  INDEX idx_statement_import_account (bank_account_id, uploaded_at)
);

CREATE TABLE finance_data_quality_issues (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  issue_uid VARCHAR(60) NOT NULL,
  bank_account_id INT NULL,
  bank_transaction_id BIGINT NULL,
  issue_type VARCHAR(80) NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'WARNING',
  title VARCHAR(180) NOT NULL,
  detail TEXT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  resolved_by INT NULL,
  UNIQUE KEY uniq_finance_quality_issue_uid (issue_uid),
  INDEX idx_finance_quality_queue (status, severity, issue_type)
);
