ALTER TABLE statement_import_rows
  ADD COLUMN raw_payload_json JSON NULL;

UPDATE statement_import_rows
SET raw_payload_json = COALESCE(
  raw_payload_json,
  override_original_json,
  JSON_OBJECT(
    'transaction_date', transaction_date,
    'posting_date', posting_date,
    'description', description,
    'merchant_name', merchant_name,
    'reference', reference,
    'category', category,
    'debit', debit,
    'credit', credit,
    'running_balance', running_balance,
    'currency', currency
  )
)
WHERE raw_payload_json IS NULL;

CREATE TABLE IF NOT EXISTS bank_transaction_original_data (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  bank_transaction_id BIGINT NOT NULL,
  bank_account_id INT NOT NULL,
  source_type VARCHAR(40) NOT NULL,
  source_statement_uid VARCHAR(60) NULL,
  source_statement_row_id BIGINT NULL,
  original_transaction_date DATE NULL,
  original_posting_date DATE NULL,
  original_description VARCHAR(500) NULL,
  original_merchant_string VARCHAR(255) NULL,
  original_reference VARCHAR(180) NULL,
  original_bank_category VARCHAR(120) NULL,
  original_debit DECIMAL(18,2) NOT NULL DEFAULT 0,
  original_credit DECIMAL(18,2) NOT NULL DEFAULT 0,
  original_running_balance DECIMAL(18,2) NULL,
  original_currency CHAR(3) NULL,
  original_payload_json JSON NULL,
  captured_by BIGINT NULL,
  captured_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bank_transaction_original (bank_transaction_id),
  KEY idx_bank_original_account_date (bank_account_id, original_transaction_date),
  KEY idx_bank_original_statement (source_statement_uid, source_statement_row_id)
);

INSERT IGNORE INTO bank_transaction_original_data (
  bank_transaction_id, bank_account_id, source_type, source_statement_uid, source_statement_row_id,
  original_transaction_date, original_posting_date, original_description, original_merchant_string,
  original_reference, original_bank_category, original_debit, original_credit, original_running_balance,
  original_currency, original_payload_json, captured_by
)
SELECT
  bt.id, bt.bank_account_id, bt.source_type, bt.statement_import_uid, bt.statement_row_id,
  sr.transaction_date, sr.posting_date, sr.description, sr.merchant_name,
  sr.reference, sr.category, sr.debit, sr.credit, sr.running_balance,
  sr.currency,
  COALESCE(sr.raw_payload_json, sr.override_original_json,
    JSON_OBJECT(
      'transaction_date', sr.transaction_date,
      'posting_date', sr.posting_date,
      'description', sr.description,
      'merchant_name', sr.merchant_name,
      'reference', sr.reference,
      'category', sr.category,
      'debit', sr.debit,
      'credit', sr.credit,
      'running_balance', sr.running_balance,
      'currency', sr.currency
    )
  ),
  bt.imported_by
FROM bank_transactions bt
JOIN statement_import_rows sr ON sr.id=bt.statement_row_id
WHERE bt.source_type='STATEMENT_IMPORT' AND bt.statement_row_id IS NOT NULL;
