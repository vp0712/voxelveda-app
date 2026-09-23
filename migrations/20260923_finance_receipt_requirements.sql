CREATE TABLE IF NOT EXISTS finance_receipt_requirements (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  bank_transaction_id BIGINT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'MISSING',
  policy_source VARCHAR(40) NOT NULL DEFAULT 'MANUAL_REVIEW',
  reason VARCHAR(500) NULL,
  requested_by INT NULL,
  requested_at DATETIME NULL,
  resolved_by INT NULL,
  resolved_at DATETIME NULL,
  updated_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_finance_receipt_requirement_transaction (bank_transaction_id),
  INDEX idx_finance_receipt_requirement_status (status, updated_at),
  INDEX idx_finance_receipt_requirement_requested (requested_by, requested_at)
);
