'use strict';

const pool = require('../config/db');

let schemaPromise;

async function createEmailQueueSchema() {
  // Retain the existing table/column names so queued content and retry history
  // survive removal of the workforce module without copying or deleting rows.
  await pool.query(`CREATE TABLE IF NOT EXISTS email_queue (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    template_key VARCHAR(100) NULL,
    to_json LONGTEXT NOT NULL,
    cc_json LONGTEXT NULL,
    bcc_json LONGTEXT NULL,
    reply_to VARCHAR(255) NULL,
    subject VARCHAR(255) NOT NULL,
    html_body LONGTEXT NULL,
    text_body LONGTEXT NULL,
    attachments_json LONGTEXT NULL,
    related_module VARCHAR(80) NULL,
    related_record_id VARCHAR(80) NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    scheduled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    next_attempt_at DATETIME NULL,
    last_error TEXT NULL,
    message_id VARCHAR(255) NULL,
    idempotency_key VARCHAR(180) NULL,
    created_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at DATETIME NULL,
    UNIQUE KEY uniq_email_idempotency (idempotency_key),
    INDEX idx_email_queue_due (status, scheduled_at, next_attempt_at)
  ) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS email_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    queue_id BIGINT NULL,
    related_module VARCHAR(80) NULL,
    related_record_id VARCHAR(80) NULL,
    recipients TEXT NOT NULL,
    subject VARCHAR(255) NOT NULL,
    status VARCHAR(30) NOT NULL,
    provider_message_id VARCHAR(255) NULL,
    error_message TEXT NULL,
    created_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email_logs_record (related_module, related_record_id, created_at),
    INDEX idx_email_logs_status (status, created_at)
  ) ENGINE=InnoDB`);

  for (const sql of [
    'ALTER TABLE email_queue ADD COLUMN idempotency_key VARCHAR(180) NULL',
    'ALTER TABLE email_queue ADD UNIQUE KEY uniq_email_idempotency (idempotency_key)'
  ]) {
    try { await pool.query(sql); } catch (error) {
      if (!['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME'].includes(error?.code)) throw error;
    }
  }
}

function ensureEmailQueueSchema() {
  if (!schemaPromise) {
    schemaPromise = createEmailQueueSchema().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

module.exports = { ensureEmailQueueSchema };
