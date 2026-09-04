-- Expense payment ledger and due dates
-- Additive and idempotent: no existing expense amounts or statuses are rewritten.

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS due_date DATE NULL AFTER expense_date;

CREATE TABLE IF NOT EXISTS expense_payments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  expense_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  payment_date DATE NOT NULL,
  payment_method VARCHAR(80) NOT NULL,
  account_name VARCHAR(180) NULL,
  reference VARCHAR(180) NULL,
  notes TEXT NULL,
  idempotency_key VARCHAR(80) NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_by INT NULL,
  voided_at DATETIME NULL,
  void_reason TEXT NULL,
  UNIQUE KEY uniq_expense_payment_idempotency (idempotency_key),
  INDEX idx_expense_payments_expense (expense_id, payment_date),
  INDEX idx_expense_payments_voided (expense_id, voided_at)
);

-- Rollback, only if the ledger has never been used:
-- DROP TABLE expense_payments;
-- ALTER TABLE expenses DROP COLUMN due_date;
