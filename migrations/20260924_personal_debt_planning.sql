CREATE TABLE IF NOT EXISTS personal_money_debt_terms (
  debt_id CHAR(36) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  start_date DATE NULL,
  interest_mode VARCHAR(24) NOT NULL DEFAULT 'NONE',
  annual_interest_rate DECIMAL(9,4) NOT NULL DEFAULT 0,
  repayment_frequency VARCHAR(24) NOT NULL DEFAULT 'NONE',
  scheduled_payment DECIMAL(18,4) NOT NULL DEFAULT 0,
  next_payment_date DATE NULL,
  reminder_days INT NOT NULL DEFAULT 14,
  contact_reference VARCHAR(240) NULL,
  agreement_reference VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_personal_debt_terms_user_next (user_id,next_payment_date),
  INDEX idx_personal_debt_terms_schedule (repayment_frequency,next_payment_date)
);
