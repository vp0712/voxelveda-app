CREATE TABLE IF NOT EXISTS personal_money_savings_control (
  goal_id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  goal_type VARCHAR(32) NOT NULL DEFAULT 'OTHER',
  funding_strategy VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
  monthly_target DECIMAL(18,4) NOT NULL DEFAULT 0,
  protected_floor DECIMAL(18,4) NOT NULL DEFAULT 0,
  liquidity_priority VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
  contribution_day TINYINT NULL,
  funding_source_note VARCHAR(500) NULL,
  decision_note VARCHAR(700) NULL,
  reviewed_at DATETIME NULL,
  updated_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_personal_savings_control_owner (user_id,goal_type,liquidity_priority),
  INDEX idx_personal_savings_control_review (user_id,reviewed_at)
);
