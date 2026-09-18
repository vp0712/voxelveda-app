ALTER TABLE statement_import_rows
  ADD COLUMN manual_override TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN override_reason VARCHAR(500) NULL,
  ADD COLUMN override_original_json JSON NULL,
  ADD COLUMN overridden_by BIGINT NULL,
  ADD COLUMN overridden_at DATETIME NULL,
  ADD COLUMN override_version INT NOT NULL DEFAULT 0;

CREATE INDEX idx_statement_rows_override
  ON statement_import_rows (import_session_id, manual_override, validation_status);

ALTER TABLE bank_transactions
  ADD COLUMN statement_import_uid VARCHAR(60) NULL,
  ADD COLUMN statement_row_id BIGINT NULL,
  ADD COLUMN review_source_status VARCHAR(20) NULL,
  ADD COLUMN manual_override TINYINT(1) NOT NULL DEFAULT 0;

CREATE INDEX idx_bank_tx_statement_provenance
  ON bank_transactions (statement_import_uid, statement_row_id);

CREATE INDEX idx_bank_tx_scope_date
  ON bank_transactions (ownership_scope, transaction_date, id);
