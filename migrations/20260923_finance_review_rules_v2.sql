ALTER TABLE bank_transactions
  ADD COLUMN merchant_normalized VARCHAR(255) NULL,
  ADD COLUMN project_ref VARCHAR(120) NULL,
  ADD COLUMN tags_json JSON NULL,
  ADD COLUMN gst_treatment VARCHAR(40) NULL,
  ADD COLUMN reviewed_at DATETIME NULL,
  ADD COLUMN reviewed_by INT NULL,
  ADD INDEX idx_bank_transactions_reviewed (reviewed_at, reviewed_by),
  ADD INDEX idx_bank_transactions_project (project_ref);

ALTER TABLE finance_category_rules
  ADD COLUMN gst_treatment VARCHAR(40) NULL,
  ADD COLUMN tags_json JSON NULL,
  ADD COLUMN application_mode VARCHAR(24) NOT NULL DEFAULT 'SUGGEST_ONLY',
  ADD COLUMN last_used_at DATETIME NULL,
  ADD COLUMN updated_by INT NULL,
  ADD INDEX idx_finance_rules_mode (created_by, enabled, application_mode);

CREATE TABLE IF NOT EXISTS finance_transaction_rule_matches (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  finance_category_rule_id BIGINT NOT NULL,
  bank_transaction_id BIGINT NOT NULL,
  match_kind VARCHAR(20) NOT NULL DEFAULT 'SUGGESTED',
  status VARCHAR(20) NOT NULL DEFAULT 'SUGGESTED',
  matched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  applied_at DATETIME NULL,
  applied_by INT NULL,
  UNIQUE KEY uniq_finance_rule_transaction (finance_category_rule_id, bank_transaction_id),
  INDEX idx_finance_rule_match_transaction (bank_transaction_id, status),
  INDEX idx_finance_rule_match_rule (finance_category_rule_id, status, matched_at)
);
