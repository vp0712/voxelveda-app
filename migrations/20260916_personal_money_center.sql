CREATE TABLE IF NOT EXISTS personal_money_wallets (
  id CHAR(36) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  name VARCHAR(120) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'AUD',
  balance DECIMAL(18,4) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_personal_money_wallets_user (user_id, active)
);

CREATE TABLE IF NOT EXISTS personal_money_entries (
  id CHAR(36) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  wallet_id CHAR(36) NOT NULL,
  entry_type ENUM('INCOME','EXPENSE','CASH_IN','CASH_OUT','DEBT_RECEIVED','DEBT_GIVEN','REPAYMENT_RECEIVED','REPAYMENT_PAID','ADJUSTMENT') NOT NULL,
  amount DECIMAL(18,4) NOT NULL,
  currency CHAR(3) NOT NULL,
  fx_rate_to_wallet DECIMAL(20,8) NOT NULL DEFAULT 1,
  wallet_amount DECIMAL(18,4) NOT NULL,
  category VARCHAR(100) NULL,
  counterparty VARCHAR(160) NULL,
  note VARCHAR(500) NULL,
  occurred_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_personal_money_entries_user_date (user_id, occurred_at),
  INDEX idx_personal_money_entries_wallet (wallet_id, occurred_at),
  CONSTRAINT fk_personal_money_entries_wallet FOREIGN KEY (wallet_id) REFERENCES personal_money_wallets(id)
);

CREATE TABLE IF NOT EXISTS personal_money_debts (
  id CHAR(36) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  direction ENUM('BORROWED','LENT') NOT NULL,
  counterparty VARCHAR(160) NOT NULL,
  principal_amount DECIMAL(18,4) NOT NULL,
  outstanding_amount DECIMAL(18,4) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'AUD',
  due_date DATE NULL,
  status ENUM('OPEN','PARTIAL','SETTLED') NOT NULL DEFAULT 'OPEN',
  note VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_personal_money_debts_user_status (user_id, status, due_date)
);

CREATE TABLE IF NOT EXISTS personal_money_debt_payments (
  id CHAR(36) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  debt_id CHAR(36) NOT NULL,
  wallet_id CHAR(36) NULL,
  amount DECIMAL(18,4) NOT NULL,
  currency CHAR(3) NOT NULL,
  paid_at DATETIME NOT NULL,
  note VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_personal_money_debt_payments_debt (debt_id, paid_at),
  CONSTRAINT fk_personal_money_debt_payment_debt FOREIGN KEY (debt_id) REFERENCES personal_money_debts(id),
  CONSTRAINT fk_personal_money_debt_payment_wallet FOREIGN KEY (wallet_id) REFERENCES personal_money_wallets(id)
);

CREATE TABLE IF NOT EXISTS personal_money_budgets (
  id CHAR(36) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  month_start DATE NOT NULL,
  category VARCHAR(100) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'AUD',
  limit_amount DECIMAL(18,4) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_personal_money_budget (user_id, month_start, category, currency),
  INDEX idx_personal_money_budgets_user_month (user_id, month_start)
);
