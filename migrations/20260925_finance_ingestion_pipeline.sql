SET @vv_col_sql = CONCAT_WS(', ',
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_sessions' AND column_name='secure_document_id'), NULL, 'ADD COLUMN secure_document_id CHAR(36) NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_sessions' AND column_name='detected_mime'), NULL, 'ADD COLUMN detected_mime VARCHAR(120) NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_sessions' AND column_name='file_size_bytes'), NULL, 'ADD COLUMN file_size_bytes BIGINT NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_sessions' AND column_name='document_type'), NULL, 'ADD COLUMN document_type VARCHAR(60) NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_sessions' AND column_name='institution'), NULL, 'ADD COLUMN institution VARCHAR(180) NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_sessions' AND column_name='masked_account_identifier'), NULL, 'ADD COLUMN masked_account_identifier VARCHAR(80) NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_sessions' AND column_name='statement_currency'), NULL, 'ADD COLUMN statement_currency CHAR(3) NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_sessions' AND column_name='page_count'), NULL, 'ADD COLUMN page_count INT NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_sessions' AND column_name='selectable_text'), NULL, 'ADD COLUMN selectable_text TINYINT(1) NOT NULL DEFAULT 0'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_sessions' AND column_name='ocr_required'), NULL, 'ADD COLUMN ocr_required TINYINT(1) NOT NULL DEFAULT 0'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_sessions' AND column_name='multiple_accounts'), NULL, 'ADD COLUMN multiple_accounts TINYINT(1) NOT NULL DEFAULT 0'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_sessions' AND column_name='multiple_currencies'), NULL, 'ADD COLUMN multiple_currencies TINYINT(1) NOT NULL DEFAULT 0'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_sessions' AND column_name='appears_incomplete'), NULL, 'ADD COLUMN appears_incomplete TINYINT(1) NOT NULL DEFAULT 0'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_sessions' AND column_name='current_stage'), NULL, 'ADD COLUMN current_stage VARCHAR(40) NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_sessions' AND column_name='progress_percent'), NULL, 'ADD COLUMN progress_percent TINYINT UNSIGNED NOT NULL DEFAULT 0'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_sessions' AND column_name='correlation_id'), NULL, 'ADD COLUMN correlation_id CHAR(36) NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_sessions' AND column_name='processing_started_at'), NULL, 'ADD COLUMN processing_started_at DATETIME NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_sessions' AND column_name='processing_completed_at'), NULL, 'ADD COLUMN processing_completed_at DATETIME NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_sessions' AND column_name='last_error_code'), NULL, 'ADD COLUMN last_error_code VARCHAR(100) NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_sessions' AND column_name='last_error_summary'), NULL, 'ADD COLUMN last_error_summary VARCHAR(1000) NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_sessions' AND column_name='approved_by'), NULL, 'ADD COLUMN approved_by BIGINT NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_sessions' AND column_name='approved_at'), NULL, 'ADD COLUMN approved_at DATETIME NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_sessions' AND column_name='posting_started_at'), NULL, 'ADD COLUMN posting_started_at DATETIME NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_sessions' AND column_name='posted_at'), NULL, 'ADD COLUMN posted_at DATETIME NULL')
);
SET @vv_col_sql = IF(@vv_col_sql='', 'SELECT 1', CONCAT('ALTER TABLE statement_import_sessions ', @vv_col_sql));
PREPARE vv_col_stmt FROM @vv_col_sql;
EXECUTE vv_col_stmt;
DEALLOCATE PREPARE vv_col_stmt;

SET @vv_idx_exists = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='statement_import_sessions' AND index_name='idx_statement_session_document');
SET @vv_idx_sql = IF(@vv_idx_exists=0, 'CREATE INDEX idx_statement_session_document ON statement_import_sessions (secure_document_id)', 'SELECT 1');
PREPARE vv_idx_stmt FROM @vv_idx_sql;
EXECUTE vv_idx_stmt;
DEALLOCATE PREPARE vv_idx_stmt;

SET @vv_idx_exists = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='statement_import_sessions' AND index_name='idx_statement_session_processing');
SET @vv_idx_sql = IF(@vv_idx_exists=0, 'CREATE INDEX idx_statement_session_processing ON statement_import_sessions (status, current_stage, updated_at)', 'SELECT 1');
PREPARE vv_idx_stmt FROM @vv_idx_sql;
EXECUTE vv_idx_stmt;
DEALLOCATE PREPARE vv_idx_stmt;

SET @vv_col_sql = CONCAT_WS(', ',
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_rows' AND column_name='source_file_id'), NULL, 'ADD COLUMN source_file_id CHAR(36) NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_rows' AND column_name='source_page'), NULL, 'ADD COLUMN source_page INT NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_rows' AND column_name='source_row_number'), NULL, 'ADD COLUMN source_row_number INT NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_rows' AND column_name='source_bbox_json'), NULL, 'ADD COLUMN source_bbox_json JSON NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_rows' AND column_name='source_snippet'), NULL, 'ADD COLUMN source_snippet VARCHAR(1000) NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_rows' AND column_name='parser_name'), NULL, 'ADD COLUMN parser_name VARCHAR(80) NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_rows' AND column_name='parser_version'), NULL, 'ADD COLUMN parser_version VARCHAR(40) NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_rows' AND column_name='confidence_score'), NULL, 'ADD COLUMN confidence_score DECIMAL(6,5) NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_rows' AND column_name='duplicate_status'), NULL, 'ADD COLUMN duplicate_status VARCHAR(30) NOT NULL DEFAULT ''NOT_DUPLICATE'''),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_rows' AND column_name='review_status'), NULL, 'ADD COLUMN review_status VARCHAR(30) NOT NULL DEFAULT ''UNREVIEWED'''),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_rows' AND column_name='rejection_reasons_json'), NULL, 'ADD COLUMN rejection_reasons_json JSON NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_rows' AND column_name='original_extracted_json'), NULL, 'ADD COLUMN original_extracted_json JSON NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_rows' AND column_name='corrected_values_json'), NULL, 'ADD COLUMN corrected_values_json JSON NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_rows' AND column_name='final_posted_transaction_id'), NULL, 'ADD COLUMN final_posted_transaction_id BIGINT NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_rows' AND column_name='updated_at'), NULL, 'ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
);
SET @vv_col_sql = IF(@vv_col_sql='', 'SELECT 1', CONCAT('ALTER TABLE statement_import_rows ', @vv_col_sql));
PREPARE vv_col_stmt FROM @vv_col_sql;
EXECUTE vv_col_stmt;
DEALLOCATE PREPARE vv_col_stmt;

SET @vv_idx_exists = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='statement_import_rows' AND index_name='idx_statement_rows_source');
SET @vv_idx_sql = IF(@vv_idx_exists=0, 'CREATE INDEX idx_statement_rows_source ON statement_import_rows (source_file_id, source_page, source_row_number)', 'SELECT 1');
PREPARE vv_idx_stmt FROM @vv_idx_sql;
EXECUTE vv_idx_stmt;
DEALLOCATE PREPARE vv_idx_stmt;

SET @vv_idx_exists = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='statement_import_rows' AND index_name='idx_statement_rows_review_status');
SET @vv_idx_sql = IF(@vv_idx_exists=0, 'CREATE INDEX idx_statement_rows_review_status ON statement_import_rows (import_session_id, review_status, validation_status, duplicate_status)', 'SELECT 1');
PREPARE vv_idx_stmt FROM @vv_idx_sql;
EXECUTE vv_idx_stmt;
DEALLOCATE PREPARE vv_idx_stmt;

CREATE TABLE IF NOT EXISTS finance_statement_import_jobs (
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

CREATE TABLE IF NOT EXISTS statement_import_pages (
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

CREATE TABLE IF NOT EXISTS finance_statement_mapping_templates (
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

CREATE TABLE IF NOT EXISTS finance_statement_parser_templates (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  parser_name VARCHAR(80) NOT NULL,
  parser_version VARCHAR(40) NOT NULL,
  institution_pattern VARCHAR(500) NULL,
  configuration_json JSON NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_statement_parser_version (parser_name, parser_version)
) ENGINE=InnoDB;

INSERT IGNORE INTO finance_statement_parser_templates (parser_name, parser_version, institution_pattern, configuration_json)
VALUES
  ('australian-crdr', 'australian-crdr-v1', 'Australian institution plus CR/DR layout', JSON_OBJECT('date_format','DMY','requires_direction',true)),
  ('generic-statement', 'generic-statement-v1', 'Generic positional financial statement', JSON_OBJECT('requires_direction',true));

CREATE TABLE IF NOT EXISTS statement_validation_results (
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

CREATE TABLE IF NOT EXISTS statement_duplicate_candidates (
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

CREATE TABLE IF NOT EXISTS processing_errors (
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

SET @vv_col_sql = CONCAT_WS(', ',
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_files' AND column_name='secure_document_id'), NULL, 'ADD COLUMN secure_document_id CHAR(36) NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_files' AND column_name='detected_mime'), NULL, 'ADD COLUMN detected_mime VARCHAR(120) NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_files' AND column_name='file_size_bytes'), NULL, 'ADD COLUMN file_size_bytes BIGINT NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_files' AND column_name='parser_name'), NULL, 'ADD COLUMN parser_name VARCHAR(80) NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_files' AND column_name='parser_version'), NULL, 'ADD COLUMN parser_version VARCHAR(40) NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_files' AND column_name='reconciliation_status'), NULL, 'ADD COLUMN reconciliation_status VARCHAR(30) NULL'),
  IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='statement_import_files' AND column_name='reconciliation_difference'), NULL, 'ADD COLUMN reconciliation_difference DECIMAL(18,2) NULL')
);
SET @vv_col_sql = IF(@vv_col_sql='', 'SELECT 1', CONCAT('ALTER TABLE statement_import_files ', @vv_col_sql));
PREPARE vv_col_stmt FROM @vv_col_sql;
EXECUTE vv_col_stmt;
DEALLOCATE PREPARE vv_col_stmt;

SET @vv_idx_exists = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='statement_import_files' AND index_name='idx_statement_import_document');
SET @vv_idx_sql = IF(@vv_idx_exists=0, 'CREATE INDEX idx_statement_import_document ON statement_import_files (secure_document_id)', 'SELECT 1');
PREPARE vv_idx_stmt FROM @vv_idx_sql;
EXECUTE vv_idx_stmt;
DEALLOCATE PREPARE vv_idx_stmt;
