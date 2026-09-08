const pool = require('../config/db');

async function ensureQmsSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS qms_records (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      record_uuid CHAR(36) NOT NULL,
      record_no VARCHAR(40) NULL,
      document_id VARCHAR(64) NOT NULL,
      document_title VARCHAR(255) NOT NULL,
      source_revision VARCHAR(32) NOT NULL DEFAULT '1.0',
      record_revision INT UNSIGNED NOT NULL DEFAULT 1,
      status ENUM('DRAFT','SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','CLOSED','VOID','SUPERSEDED') NOT NULL DEFAULT 'DRAFT',
      values_json JSON NOT NULL,
      owner_user_id BIGINT NULL,
      prepared_by BIGINT NULL,
      reviewed_by BIGINT NULL,
      approved_by BIGINT NULL,
      approved_at DATETIME NULL,
      closed_at DATETIME NULL,
      revision_reason VARCHAR(1000) NULL,
      integrity_hash CHAR(64) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_qms_record_uuid (record_uuid),
      UNIQUE KEY uq_qms_record_no (record_no),
      KEY idx_qms_document_status (document_id, status),
      KEY idx_qms_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qms_record_revisions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      qms_record_id BIGINT UNSIGNED NOT NULL,
      record_revision INT UNSIGNED NOT NULL,
      status VARCHAR(32) NOT NULL,
      values_json JSON NOT NULL,
      integrity_hash CHAR(64) NOT NULL,
      change_reason VARCHAR(1000) NULL,
      changed_by BIGINT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_qms_record_revision (qms_record_id, record_revision),
      CONSTRAINT fk_qms_revision_record FOREIGN KEY (qms_record_id) REFERENCES qms_records(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qms_record_workflow_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      qms_record_id BIGINT UNSIGNED NOT NULL,
      from_status VARCHAR(32) NULL,
      to_status VARCHAR(32) NOT NULL,
      actor_id BIGINT NULL,
      reason VARCHAR(1000) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_qms_workflow_record (qms_record_id, created_at),
      CONSTRAINT fk_qms_workflow_record FOREIGN KEY (qms_record_id) REFERENCES qms_records(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qms_record_signatures (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      qms_record_id BIGINT UNSIGNED NOT NULL,
      record_revision INT UNSIGNED NOT NULL,
      signer_user_id BIGINT NOT NULL,
      signature_type VARCHAR(50) NOT NULL,
      meaning_text VARCHAR(1000) NOT NULL,
      signed_integrity_hash CHAR(64) NOT NULL,
      signed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_qms_signature_record (qms_record_id, record_revision),
      CONSTRAINT fk_qms_signature_record FOREIGN KEY (qms_record_id) REFERENCES qms_records(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

module.exports = { ensureQmsSchema };
