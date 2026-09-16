CREATE TABLE IF NOT EXISTS personal_spending_category_budgets (
  id CHAR(36) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  category VARCHAR(100) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'AUD',
  monthly_limit DECIMAL(18,4) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  note VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_personal_spending_category_budget (user_id, category, currency),
  INDEX idx_personal_spending_category_budget_user (user_id, active, currency)
);