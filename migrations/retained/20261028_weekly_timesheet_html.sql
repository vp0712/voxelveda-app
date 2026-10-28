-- Explicit versioned delivery formats and immutable HTML content metadata.
-- Existing deliveries/versions default to PDF and retain all source/queue history.
-- New unsnapshotted routine deliveries select HTML in the locked scheduler.

CREATE TABLE IF NOT EXISTS weekly_timesheet_deliveries (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL, period_start DATE NOT NULL, period_end DATE NOT NULL,
    timezone VARCHAR(100) NOT NULL, version INT NOT NULL DEFAULT 1,
    status VARCHAR(40) NOT NULL DEFAULT 'PENDING',
    recipient VARCHAR(254) NULL, source_sha256 CHAR(64) NULL, snapshot_json LONGTEXT NULL,
    delivery_format VARCHAR(16) NOT NULL DEFAULT 'PDF', content_sha256 CHAR(64) NULL, content_snapshot_json LONGTEXT NULL,
    total_minutes INT NOT NULL DEFAULT 0, review_reasons_json TEXT NULL,
    claim_token CHAR(36) NULL, claim_expires_at DATETIME NULL,
    timesheet_id INT NULL, email_queue_id BIGINT NULL, document_request_id BIGINT NULL,
    revision_authorised_by INT NULL, revision_authorised_at DATETIME NULL, revision_reason VARCHAR(1000) NULL,
    provider_accepted_at DATETIME NULL, sent_at DATETIME NULL, last_error_code VARCHAR(100) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_weekly_staff_period (user_id, period_start, period_end),
    UNIQUE KEY uniq_weekly_delivery_queue (email_queue_id),
    INDEX idx_weekly_delivery_status (status, updated_at)
  ) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS weekly_timesheet_delivery_versions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, delivery_id BIGINT NOT NULL, version INT NOT NULL,
    user_id INT NOT NULL, period_start DATE NOT NULL, period_end DATE NOT NULL,
    recipient VARCHAR(254) NULL, source_sha256 CHAR(64) NOT NULL, snapshot_json LONGTEXT NOT NULL,
    delivery_format VARCHAR(16) NOT NULL DEFAULT 'PDF', content_sha256 CHAR(64) NULL, content_snapshot_json LONGTEXT NULL,
    total_minutes INT NOT NULL, email_queue_id BIGINT NULL, document_request_id BIGINT NULL, status VARCHAR(40) NOT NULL,
    created_by INT NULL, reason VARCHAR(1000) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_weekly_delivery_version (delivery_id, version)
  ) ENGINE=InnoDB;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='weekly_timesheet_deliveries' AND column_name='delivery_format'),
  'SELECT 1', 'ALTER TABLE `weekly_timesheet_deliveries` ADD COLUMN `delivery_format` VARCHAR(16) NOT NULL DEFAULT ''PDF''');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='weekly_timesheet_deliveries' AND column_name='content_sha256'),
  'SELECT 1', 'ALTER TABLE `weekly_timesheet_deliveries` ADD COLUMN `content_sha256` CHAR(64) NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='weekly_timesheet_deliveries' AND column_name='content_snapshot_json'),
  'SELECT 1', 'ALTER TABLE `weekly_timesheet_deliveries` ADD COLUMN `content_snapshot_json` LONGTEXT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='weekly_timesheet_delivery_versions' AND column_name='delivery_format'),
  'SELECT 1', 'ALTER TABLE `weekly_timesheet_delivery_versions` ADD COLUMN `delivery_format` VARCHAR(16) NOT NULL DEFAULT ''PDF''');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='weekly_timesheet_delivery_versions' AND column_name='content_sha256'),
  'SELECT 1', 'ALTER TABLE `weekly_timesheet_delivery_versions` ADD COLUMN `content_sha256` CHAR(64) NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='weekly_timesheet_delivery_versions' AND column_name='content_snapshot_json'),
  'SELECT 1', 'ALTER TABLE `weekly_timesheet_delivery_versions` ADD COLUMN `content_snapshot_json` LONGTEXT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;
