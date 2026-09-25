ALTER TABLE statement_import_sessions
  ADD COLUMN secure_document_id CHAR(36) NULL,
  ADD COLUMN detected_mime VARCHAR(120) NULL,
  ADD COLUMN file_size_bytes BIGINT NULL,
  ADD COLUMN document_type VARCHAR(60) NULL,
  ADD COLUMN institution VARCHAR(180) NULL,
  ADD COLUMN masked_account_identifier VARCHAR(80) NULL,
  ADD COLUMN statement_currency CHAR(3) NULL,
  ADD COLUMN page_count INT NULL,
  ADD COLUMN selectable_text TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN ocr_required TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN multiple_accounts TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN multiple_currencies TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN appears_incomplete TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN current_stage VARCHAR(40) NULL,
  ADD COLUMN progress_percent TINYINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN correlation_id CHAR(36) NULL,
  ADD COLUMN processing_started_at DATETIME NULL,
  ADD COLUMN processing_completed_at DATETIME NULL,
  ADD COLUMN last_error_code VARCHAR(100) NULL,
  ADD COLUMN last_error_summary VARCHAR(1000) NULL,
  ADD COLUMN approved_by BIGINT NULL,
  ADD COLUMN approved_at DATETIME NULL,
  ADD COLUMN posting_started_at DATETIME NULL,
  ADD COLUMN posted_at DATETIME NULL;

CREATE INDEX idx_statement_session_document ON statement_import_sessions (secure_document_id);
CREATE INDEX idx_statement_session_processing ON statement_import_sessions (status, current_stage, updated_at);

ALTER TABLE statement_import_rows
  ADD COLUMN source_file_id CHAR(36) NULL,
  ADD COLUMN source_page INT NULL,
  ADD COLUMN source_row_number INT NULL,
  ADD COLUMN source_bbox_json JSON NULL,
  ADD COLUMN source_snippet VARCHAR(1000) NULL,
  ADD COLUMN parser_name VARCHAR(80) NULL,
  ADD COLUMN parser_version VARCHAR(40) NULL,
  ADD COLUMN confidence_score DECIMAL(6,5) NULL,
  ADD COLUMN duplicate_status VARCHAR(30) NOT NULL DEFAULT 'NOT_DUPLICATE',
  ADD COLUMN review_status VARCHAR(30) NOT NULL DEFAULT 'UNREVIEWED',
  ADD COLUMN rejection_reasons_json JSON NULL,
  ADD COLUMN original_extracted_json JSON NULL,
  ADD COLUMN corrected_values_json JSON NULL,
  ADD COLUMN final_posted_transaction_id BIGINT NULL,
  ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

CREATE INDEX idx_statement_rows_source ON statement_import_rows (source_file_id, source_page, source_row_number);
CREATE INDEX idx_statement_rows_review_status ON statement_import_rows (import_session_id, review_status, validation_status, duplicate_status);

CREATE TABLE finance_statement_import_jobs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  job_uuid CHAR(36) NOT NULL,
  import_session_id BIGINT NOT NULL,
  idempotency_key CHAR(64) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'QUEUED',
  stage VARCHAR(40) NOT NULL DEFAULT 'QUEUED',
  progress_percent TINYINT UNSIGNED NOT NULL DEFAULT 0,
  attempt INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_by VARCHAR(120) NULL,
  locked_at DATETIME NULL,
  heartbeat_at DATETIME NULL,
  completed_at DATETIME NULL,
  encrypted_password TEXT NULL,
  mapping_json JSON NULL,
  error_code VARCHAR(100) NULL,
  error_summary VARCHAR(1000) NULL,
  correlation_id CHAR(36) NOT NULL,
  requested_by BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_finance_statement_job_uuid (job_uuid),
  UNIQUE KEY uq_finance_statement_job_session (import_session_id),
  UNIQUE KEY uq_finance_statement_job_idempotency (idempotency_key),
  KEY idx_finance_statement_job_queue (status, available_at, created_at),
  KEY idx_finance_statement_job_heartbeat (status, heartbeat_at)
) ENGINE=InnoDB;

CREATE TABLE statement_import_pages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  import_session_id BIGINT NOT NULL,
  secure_document_id CHAR(36) NOT NULL,
  page_number INT NOT NULL,
  extraction_method VARCHAR(30) NOT NULL,
  text_content MEDIUMTEXT NULL,
  word_count INT NOT NULL DEFAULT 0,
  confidence DECIMAL(6,5) NULL,
  width_pixels INT NULL,
  height_pixels INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_statement_import_page (import_session_id, page_number),
  KEY idx_statement_page_document (secure_document_id, page_number)
) ENGINE=InnoDB;

CREATE TABLE finance_statement_mapping_templates (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  template_uid CHAR(36) NOT NULL,
  owner_user_id BIGINT NOT NULL,
  institution VARCHAR(180) NOT NULL,
  source_format VARCHAR(20) NOT NULL,
  template_name VARCHAR(180) NOT NULL,
  mapping_json JSON NOT NULL,
  parser_version VARCHAR(40) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_statement_mapping_uid (template_uid),
  UNIQUE KEY uq_statement_mapping_owner_name (owner_user_id, template_name),
  KEY idx_statement_mapping_match (owner_user_id, institution, source_format, active)
) ENGINE=InnoDB;

CREATE TABLE finance_statement_parser_templates (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  parser_name VARCHAR(80) NOT NULL,
  parser_version VARCHAR(40) NOT NULL,
  institution_pattern VARCHAR(500) NULL,
  configuration_json JSON NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_statement_parser_version (parser_name, parser_version)
) ENGINE=InnoDB;

INSERT INTO finance_statement_parser_templates (parser_name, parser_version, institution_pattern, configuration_json)
VALUES
  ('australian-crdr', 'australian-crdr-v1', 'Australian institution plus CR/DR layout', JSON_OBJECT('date_format','DMY','requires_direction',true)),
  ('generic-statement', 'generic-statement-v1', 'Generic positional financial statement', JSON_OBJECT('requires_direction',true));

CREATE TABLE statement_validation_results (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  import_session_id BIGINT NOT NULL,
  validation_key VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL,
  expected_value VARCHAR(120) NULL,
  actual_value VARCHAR(120) NULL,
  difference_value VARCHAR(120) NULL,
  detail VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_statement_validation (import_session_id, validation_key),
  KEY idx_statement_validation_status (import_session_id, status)
) ENGINE=InnoDB;

CREATE TABLE statement_duplicate_candidates (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  import_session_id BIGINT NOT NULL,
  statement_row_id BIGINT NOT NULL,
  existing_bank_transaction_id BIGINT NULL,
  match_class VARCHAR(30) NOT NULL,
  match_score DECIMAL(6,5) NOT NULL,
  explanation VARCHAR(1000) NOT NULL,
  resolved_status VARCHAR(30) NOT NULL DEFAULT 'UNRESOLVED',
  resolved_by BIGINT NULL,
  resolved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_statement_duplicate_candidate (statement_row_id, existing_bank_transaction_id),
  KEY idx_statement_duplicate_review (import_session_id, match_class, resolved_status)
) ENGINE=InnoDB;

CREATE TABLE processing_errors (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  correlation_id CHAR(36) NOT NULL,
  scope_type VARCHAR(60) NOT NULL,
  scope_id VARCHAR(80) NOT NULL,
  stage VARCHAR(40) NOT NULL,
  error_code VARCHAR(100) NOT NULL,
  error_summary VARCHAR(1000) NOT NULL,
  retry_safe TINYINT(1) NOT NULL DEFAULT 0,
  resolved_at DATETIME NULL,
  resolved_by BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_processing_error_scope (scope_type, scope_id, created_at),
  KEY idx_processing_error_open (resolved_at, error_code, created_at)
) ENGINE=InnoDB;

ALTER TABLE statement_import_files
  ADD COLUMN secure_document_id CHAR(36) NULL,
  ADD COLUMN detected_mime VARCHAR(120) NULL,
  ADD COLUMN file_size_bytes BIGINT NULL,
  ADD COLUMN parser_name VARCHAR(80) NULL,
  ADD COLUMN parser_version VARCHAR(40) NULL,
  ADD COLUMN reconciliation_status VARCHAR(30) NULL,
  ADD COLUMN reconciliation_difference DECIMAL(18,2) NULL;

CREATE INDEX idx_statement_import_document ON statement_import_files (secure_document_id);
