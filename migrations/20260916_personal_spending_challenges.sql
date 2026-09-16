CREATE TABLE IF NOT EXISTS personal_spending_challenges (
  id CHAR(36) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  name VARCHAR(140) NOT NULL,
  challenge_type VARCHAR(32) NOT NULL,
  category VARCHAR(100) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'AUD',
  target_amount DECIMAL(18,4) NULL,
  baseline_amount DECIMAL(18,4) NULL,
  target_percent DECIMAL(7,3) NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  note VARCHAR(300) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_personal_spending_challenges_user_status (user_id, status, start_date, end_date),
  INDEX idx_personal_spending_challenges_user_category (user_id, currency, category)
);
