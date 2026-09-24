CREATE TABLE IF NOT EXISTS personal_money_recurring_control (
  recurring_id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  essentiality VARCHAR(24) NOT NULL DEFAULT 'UNKNOWN',
  lifecycle_decision VARCHAR(24) NOT NULL DEFAULT 'KEEP',
  auto_renew VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN',
  renewal_date DATE NULL,
  contract_end_date DATE NULL,
  cancellation_notice_days INT NOT NULL DEFAULT 0,
  cancellation_reference VARCHAR(500) NULL,
  decision_note VARCHAR(700) NULL,
  reviewed_at DATETIME NULL,
  updated_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_personal_recurring_control_owner (user_id,lifecycle_decision,renewal_date),
  INDEX idx_personal_recurring_control_renewal (renewal_date,auto_renew)
);
