const pool = require('../config/db');

let schemaPromise;

async function createHighRiskFinanceSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS sensitive_bank_details (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    subject_type VARCHAR(20) NOT NULL,
    subject_id BIGINT NOT NULL,
    bank_name VARCHAR(160) NULL,
    account_name_ciphertext TEXT NOT NULL,
    bsb_ciphertext TEXT NOT NULL,
    account_number_ciphertext TEXT NOT NULL,
    account_last_four CHAR(4) NOT NULL,
    key_version VARCHAR(20) NOT NULL DEFAULT 'v1',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    activated_from_request_id CHAR(36) NOT NULL,
    activated_by INT NOT NULL,
    activated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    superseded_at DATETIME NULL,
    INDEX idx_sensitive_bank_subject (subject_type, subject_id, status),
    UNIQUE KEY uq_sensitive_bank_request (activated_from_request_id)
  ) ENGINE=InnoDB`);

  await pool.query(`CREATE TABLE IF NOT EXISTS bank_detail_change_requests (
    id CHAR(36) PRIMARY KEY,
    subject_type VARCHAR(20) NOT NULL,
    subject_id BIGINT NOT NULL,
    bank_name VARCHAR(160) NULL,
    account_name_ciphertext TEXT NOT NULL,
    bsb_ciphertext TEXT NOT NULL,
    account_number_ciphertext TEXT NOT NULL,
    account_last_four CHAR(4) NOT NULL,
    key_version VARCHAR(20) NOT NULL DEFAULT 'v1',
    reason VARCHAR(500) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    initiated_by INT NOT NULL,
    initiated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    rejected_by INT NULL,
    rejected_at DATETIME NULL,
    rejection_reason VARCHAR(500) NULL,
    INDEX idx_bank_change_status (status, subject_type, initiated_at),
    INDEX idx_bank_change_subject (subject_type, subject_id, initiated_at)
  ) ENGINE=InnoDB`);

  await pool.query(`CREATE TABLE IF NOT EXISTS payment_approval_requests (
    id CHAR(36) PRIMARY KEY,
    supplier_bill_id BIGINT NOT NULL,
    payment_date DATE NOT NULL,
    amount DECIMAL(18,2) NOT NULL,
    bank_account_id INT NULL,
    payment_method VARCHAR(60) NULL,
    reference VARCHAR(180) NULL,
    notes TEXT NULL,
    risk_reasons JSON NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    initiated_by INT NOT NULL,
    initiated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    rejected_by INT NULL,
    rejected_at DATETIME NULL,
    rejection_reason VARCHAR(500) NULL,
    executed_at DATETIME NULL,
    INDEX idx_payment_approval_status (status, initiated_at),
    INDEX idx_payment_approval_bill (supplier_bill_id, status)
  ) ENGINE=InnoDB`);
}

async function ensureHighRiskFinanceSchema() {
  if (!schemaPromise) schemaPromise = createHighRiskFinanceSchema().catch((error) => { schemaPromise = null; throw error; });
  return schemaPromise;
}

module.exports = { ensureHighRiskFinanceSchema };
