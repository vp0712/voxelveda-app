CREATE TABLE IF NOT EXISTS banking_user_account_access (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  bank_account_id BIGINT NOT NULL,
  access_level ENUM('VIEW','PREPARE','APPROVE','MANAGE') NOT NULL DEFAULT 'VIEW',
  can_view TINYINT(1) NOT NULL DEFAULT 1,
  can_prepare_payments TINYINT(1) NOT NULL DEFAULT 0,
  can_approve_payments TINYINT(1) NOT NULL DEFAULT 0,
  can_manage TINYINT(1) NOT NULL DEFAULT 0,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_banking_user_account_access (user_id, bank_account_id),
  KEY idx_banking_access_account (bank_account_id),
  KEY idx_banking_access_user (user_id)
);

CREATE TABLE IF NOT EXISTS banking_money_spaces (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  space_uid VARCHAR(80) NOT NULL,
  created_by BIGINT NOT NULL,
  ownership_scope ENUM('PERSONAL','BUSINESS') NOT NULL,
  name VARCHAR(120) NOT NULL,
  purpose VARCHAR(255) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'AUD',
  target_amount DECIMAL(18,2) NULL,
  allocated_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  minimum_reserve DECIMAL(18,2) NOT NULL DEFAULT 0,
  status ENUM('ACTIVE','ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_banking_space_uid (space_uid),
  KEY idx_banking_spaces_owner (created_by, ownership_scope, status)
);

CREATE TABLE IF NOT EXISTS banking_beneficiaries (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  beneficiary_uid VARCHAR(80) NOT NULL,
  created_by BIGINT NOT NULL,
  ownership_scope ENUM('PERSONAL','BUSINESS') NOT NULL,
  name VARCHAR(180) NOT NULL,
  nickname VARCHAR(120) NULL,
  bank_name VARCHAR(180) NULL,
  bsb_masked VARCHAR(32) NULL,
  account_masked VARCHAR(64) NULL,
  payid_masked VARCHAR(180) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'AUD',
  trusted TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('ACTIVE','ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_banking_beneficiary_uid (beneficiary_uid),
  KEY idx_banking_beneficiaries_owner (created_by, ownership_scope, status)
);

CREATE TABLE IF NOT EXISTS banking_payment_requests (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  payment_uid VARCHAR(80) NOT NULL,
  created_by BIGINT NOT NULL,
  bank_account_id BIGINT NULL,
  beneficiary_id BIGINT NULL,
  ownership_scope ENUM('PERSONAL','BUSINESS') NOT NULL,
  payment_type ENUM('EXTERNAL','INTERNAL','BILL','PAYROLL','REIMBURSEMENT','REQUEST_MONEY') NOT NULL DEFAULT 'EXTERNAL',
  payee_name VARCHAR(180) NOT NULL,
  reference_text VARCHAR(180) NULL,
  amount DECIMAL(18,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'AUD',
  due_date DATE NULL,
  schedule_type ENUM('ONCE','WEEKLY','FORTNIGHTLY','MONTHLY','QUARTERLY','YEARLY') NOT NULL DEFAULT 'ONCE',
  status ENUM('DRAFT','PENDING_APPROVAL','APPROVED','READY_FOR_EXECUTION','SCHEDULED','COMPLETED','REJECTED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  required_approvals INT NOT NULL DEFAULT 1,
  approved_count INT NOT NULL DEFAULT 0,
  provider_capability_required VARCHAR(80) NULL,
  provider_reference VARCHAR(180) NULL,
  submitted_at DATETIME NULL,
  approved_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_banking_payment_uid (payment_uid),
  KEY idx_banking_payment_status (ownership_scope, status, due_date),
  KEY idx_banking_payment_creator (created_by, created_at)
);

CREATE TABLE IF NOT EXISTS banking_payment_approvals (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  payment_id BIGINT NOT NULL,
  approver_user_id BIGINT NOT NULL,
  decision ENUM('APPROVE','REJECT') NOT NULL,
  note VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_banking_payment_approver (payment_id, approver_user_id),
  KEY idx_banking_approval_payment (payment_id)
);

CREATE TABLE IF NOT EXISTS banking_alert_preferences (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  low_balance_threshold DECIMAL(18,2) NULL,
  large_transaction_threshold DECIMAL(18,2) NULL,
  notify_budget TINYINT(1) NOT NULL DEFAULT 1,
  notify_payments TINYINT(1) NOT NULL DEFAULT 1,
  notify_bank_sync TINYINT(1) NOT NULL DEFAULT 1,
  notify_unusual_activity TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_banking_alert_preferences_user (user_id)
);
