CREATE TABLE IF NOT EXISTS personal_money_recurring_items (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  name VARCHAR(160) NOT NULL,
  item_type ENUM('BILL','SUBSCRIPTION','INCOME') NOT NULL,
  amount DECIMAL(18,4) NOT NULL,
  currency CHAR(3) NOT NULL,
  frequency ENUM('WEEKLY','FORTNIGHTLY','MONTHLY','QUARTERLY','YEARLY') NOT NULL,
  next_due_date DATE NOT NULL,
  category VARCHAR(100) NULL,
  counterparty VARCHAR(160) NULL,
  reminder_days INT NOT NULL DEFAULT 3,
  active TINYINT(1) NOT NULL DEFAULT 1,
  last_completed_date DATE NULL,
  note VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pm_recurring_owner_due (user_id, active, next_due_date),
  INDEX idx_pm_recurring_owner_type (user_id, item_type)
);

CREATE TABLE IF NOT EXISTS personal_money_savings_goals (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  name VARCHAR(160) NOT NULL,
  target_amount DECIMAL(18,4) NOT NULL,
  current_amount DECIMAL(18,4) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL,
  target_date DATE NULL,
  priority ENUM('LOW','MEDIUM','HIGH') NOT NULL DEFAULT 'MEDIUM',
  status ENUM('ACTIVE','COMPLETED','PAUSED') NOT NULL DEFAULT 'ACTIVE',
  note VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pm_goals_owner_status (user_id, status),
  INDEX idx_pm_goals_owner_target (user_id, target_date)
);

CREATE TABLE IF NOT EXISTS personal_money_goal_contributions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  goal_id VARCHAR(64) NOT NULL,
  amount DECIMAL(18,4) NOT NULL,
  contributed_at DATETIME NOT NULL,
  note VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pm_goal_contrib_owner_goal (user_id, goal_id),
  CONSTRAINT fk_pm_goal_contrib_goal FOREIGN KEY (goal_id) REFERENCES personal_money_savings_goals(id) ON DELETE CASCADE
);