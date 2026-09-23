CREATE TABLE IF NOT EXISTS finance_fx_rates (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  rate_uid VARCHAR(60) NOT NULL,
  user_id INT NOT NULL,
  from_currency CHAR(3) NOT NULL,
  to_currency CHAR(3) NOT NULL,
  rate DECIMAL(24,10) NOT NULL,
  effective_date DATE NOT NULL,
  source_note VARCHAR(255) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_finance_fx_uid (rate_uid),
  UNIQUE KEY uniq_finance_fx_user_day (user_id, from_currency, to_currency, effective_date),
  INDEX idx_finance_fx_user_active_date (user_id, active, effective_date),
  INDEX idx_finance_fx_pair (user_id, from_currency, to_currency, effective_date)
) ENGINE=InnoDB;
