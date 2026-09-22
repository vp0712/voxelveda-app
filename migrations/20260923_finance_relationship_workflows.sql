CREATE TABLE IF NOT EXISTS bank_transaction_splits (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  split_uid VARCHAR(64) NOT NULL,
  parent_bank_transaction_id BIGINT NOT NULL,
  sequence_no INT NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  gst_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  category VARCHAR(120) NULL,
  subcategory VARCHAR(120) NULL,
  ownership_scope VARCHAR(30) NOT NULL DEFAULT 'UNCLASSIFIED',
  project_ref VARCHAR(120) NULL,
  tags_json JSON NULL,
  note TEXT NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by INT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_bank_transaction_split_uid (split_uid),
  UNIQUE KEY uniq_bank_transaction_split_sequence (parent_bank_transaction_id, sequence_no),
  INDEX idx_bank_transaction_split_parent (parent_bank_transaction_id, category, ownership_scope)
);

CREATE TABLE IF NOT EXISTS finance_refund_links (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  link_uid VARCHAR(64) NOT NULL,
  refund_bank_transaction_id BIGINT NOT NULL,
  original_expense_transaction_id BIGINT NOT NULL,
  linked_amount DECIMAL(18,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  note TEXT NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_by INT NULL,
  voided_at DATETIME NULL,
  UNIQUE KEY uniq_finance_refund_link_uid (link_uid),
  UNIQUE KEY uniq_finance_refund_pair (refund_bank_transaction_id, original_expense_transaction_id),
  INDEX idx_finance_refund_original (original_expense_transaction_id, status),
  INDEX idx_finance_refund_credit (refund_bank_transaction_id, status)
);

CREATE TABLE IF NOT EXISTS finance_reimbursements (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  reimbursement_uid VARCHAR(64) NOT NULL,
  expense_bank_transaction_id BIGINT NOT NULL,
  claimant_user_id INT NOT NULL,
  requested_amount DECIMAL(18,2) NOT NULL,
  currency CHAR(3) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  note TEXT NULL,
  submitted_at DATETIME NULL,
  approved_by INT NULL,
  approved_at DATETIME NULL,
  rejected_by INT NULL,
  rejected_at DATETIME NULL,
  rejection_reason TEXT NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_finance_reimbursement_uid (reimbursement_uid),
  INDEX idx_finance_reimbursement_expense (expense_bank_transaction_id, status),
  INDEX idx_finance_reimbursement_claimant (claimant_user_id, status, created_at)
);

CREATE TABLE IF NOT EXISTS finance_reimbursement_payments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  reimbursement_id BIGINT NOT NULL,
  payment_bank_transaction_id BIGINT NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_finance_reimbursement_payment (reimbursement_id, payment_bank_transaction_id),
  INDEX idx_finance_reimbursement_payment_txn (payment_bank_transaction_id)
);
