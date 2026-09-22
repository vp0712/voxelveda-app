CREATE TABLE IF NOT EXISTS finance_user_preferences (
  user_id INT PRIMARY KEY,
  default_workspace VARCHAR(20) NOT NULL DEFAULT 'ALL',
  default_account_id BIGINT NULL,
  reporting_currency CHAR(3) NULL,
  default_period VARCHAR(40) NOT NULL DEFAULT 'month',
  dashboard_cards_json JSON NULL,
  date_format VARCHAR(20) NOT NULL DEFAULT 'DD/MM/YYYY',
  number_format VARCHAR(20) NOT NULL DEFAULT 'en-AU',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
