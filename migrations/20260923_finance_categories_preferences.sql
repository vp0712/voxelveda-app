CREATE TABLE IF NOT EXISTS finance_categories (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  category_uid VARCHAR(64) NOT NULL,
  name VARCHAR(120) NOT NULL,
  parent_category_id BIGINT NULL,
  scope VARCHAR(20) NOT NULL DEFAULT 'BOTH',
  colour VARCHAR(20) NULL,
  icon VARCHAR(40) NULL,
  gst_default VARCHAR(20) NOT NULL DEFAULT 'REVIEW',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by INT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at DATETIME NULL,
  archived_by INT NULL,
  UNIQUE KEY uniq_finance_category_uid (category_uid),
  INDEX idx_finance_category_scope_active (scope,active,name),
  INDEX idx_finance_category_creator (created_by,active,name),
  INDEX idx_finance_category_parent (parent_category_id)
);

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
