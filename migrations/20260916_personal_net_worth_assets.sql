CREATE TABLE IF NOT EXISTS personal_net_worth_assets (
  id CHAR(36) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  asset_type VARCHAR(40) NOT NULL,
  name VARCHAR(160) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'AUD',
  current_value DECIMAL(18,4) NOT NULL DEFAULT 0,
  purchase_value DECIMAL(18,4) NULL,
  purchase_date DATE NULL,
  institution VARCHAR(160) NULL,
  note VARCHAR(500) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pnwa_user_active (user_id, active),
  INDEX idx_pnwa_user_currency (user_id, currency)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS personal_net_worth_asset_values (
  id CHAR(36) PRIMARY KEY,
  asset_id CHAR(36) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  value_amount DECIMAL(18,4) NOT NULL,
  value_date DATE NOT NULL,
  source VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pnwa_values_asset FOREIGN KEY (asset_id) REFERENCES personal_net_worth_assets(id),
  INDEX idx_pnwa_values_user_asset_date (user_id, asset_id, value_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS personal_net_worth_liabilities (
  id CHAR(36) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  liability_type VARCHAR(40) NOT NULL,
  name VARCHAR(160) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'AUD',
  current_balance DECIMAL(18,4) NOT NULL DEFAULT 0,
  original_balance DECIMAL(18,4) NULL,
  interest_rate_percent DECIMAL(8,4) NULL,
  minimum_payment DECIMAL(18,4) NULL,
  due_day TINYINT UNSIGNED NULL,
  institution VARCHAR(160) NULL,
  note VARCHAR(500) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pnwl_user_active (user_id, active),
  INDEX idx_pnwl_user_currency (user_id, currency)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS personal_net_worth_liability_values (
  id CHAR(36) PRIMARY KEY,
  liability_id CHAR(36) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  balance_amount DECIMAL(18,4) NOT NULL,
  value_date DATE NOT NULL,
  source VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pnwl_values_liability FOREIGN KEY (liability_id) REFERENCES personal_net_worth_liabilities(id),
  INDEX idx_pnwl_values_user_liability_date (user_id, liability_id, value_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS personal_net_worth_snapshots (
  id CHAR(36) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  currency CHAR(3) NOT NULL,
  snapshot_date DATE NOT NULL,
  liquid_funds DECIMAL(18,4) NOT NULL DEFAULT 0,
  registered_assets DECIMAL(18,4) NOT NULL DEFAULT 0,
  lent_receivables DECIMAL(18,4) NOT NULL DEFAULT 0,
  registered_liabilities DECIMAL(18,4) NOT NULL DEFAULT 0,
  borrowed_money DECIMAL(18,4) NOT NULL DEFAULT 0,
  net_worth DECIMAL(18,4) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pnws_user_currency_date (user_id, currency, snapshot_date),
  INDEX idx_pnws_user_date (user_id, snapshot_date)
) ENGINE=InnoDB;
