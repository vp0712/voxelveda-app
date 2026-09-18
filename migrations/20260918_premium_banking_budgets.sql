CREATE TABLE IF NOT EXISTS finance_bank_budgets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  budget_uid VARCHAR(60) NOT NULL,
  created_by BIGINT NOT NULL,
  ownership_scope ENUM('ALL','PERSONAL','BUSINESS','MIXED','UNCLASSIFIED') NOT NULL DEFAULT 'PERSONAL',
  category VARCHAR(120) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'AUD',
  cycle ENUM('WEEKLY','FORTNIGHTLY','MONTHLY') NOT NULL DEFAULT 'MONTHLY',
  cycle_anchor_date DATE NOT NULL,
  limit_amount DECIMAL(18,2) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_finance_bank_budget_uid (budget_uid),
  UNIQUE KEY uq_finance_bank_budget_owner (created_by, ownership_scope, category, currency, cycle),
  KEY idx_finance_bank_budget_active (created_by, active, ownership_scope)
);
