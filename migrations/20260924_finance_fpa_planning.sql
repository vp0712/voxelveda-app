CREATE TABLE IF NOT EXISTS finance_operating_plans (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  plan_uid CHAR(36) NOT NULL,
  created_by INT NOT NULL,
  plan_name VARCHAR(180) NOT NULL,
  ownership_scope VARCHAR(24) NOT NULL,
  currency CHAR(3) NOT NULL,
  start_month DATE NOT NULL,
  months_count INT NOT NULL DEFAULT 12,
  status VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
  notes TEXT NULL,
  version_no INT NOT NULL DEFAULT 1,
  supersedes_plan_uid CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_finance_operating_plan_uid (plan_uid),
  INDEX idx_finance_operating_plan_scope (ownership_scope,currency,status,updated_at),
  INDEX idx_finance_operating_plan_owner (created_by,status,updated_at)
);

CREATE TABLE IF NOT EXISTS finance_operating_plan_lines (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  plan_id BIGINT NOT NULL,
  month_start DATE NOT NULL,
  direction VARCHAR(12) NOT NULL,
  category VARCHAR(120) NOT NULL,
  planned_amount DECIMAL(18,4) NOT NULL DEFAULT 0,
  note VARCHAR(300) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_finance_operating_plan_line (plan_id,month_start,direction,category),
  INDEX idx_finance_operating_plan_line_month (plan_id,month_start,direction)
);
