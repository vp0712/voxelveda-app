'use strict';
const pool = require('../config/db');
const { ensureWorkforceSchema } = require('./workforceSchema');
const { ensureUserLifecycleSchema } = require('./userLifecycleService');
const { ensureHrAdministrationSchema } = require('./hrAdministrationSchema');
let schemaPromise;
async function additive(sql) { try { await pool.query(sql); } catch (error) { if (!['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME'].includes(error.code)) throw error; } }
async function createSchema() {
  await ensureUserLifecycleSchema();
  await ensureHrAdministrationSchema();
  await ensureWorkforceSchema();
  // Only additive metadata. NULL preserves historical records without asserting
  // an authorisation or a break that was never recorded.
  for (const [name, type] of Object.entries({ break_minutes: 'INT NULL', entry_source: 'VARCHAR(30) NULL', timestamp_basis: 'VARCHAR(16) NULL', clock_out_timestamp_basis: 'VARCHAR(16) NULL', recorded_timezone: 'VARCHAR(100) NULL', manual_authorised_by: 'INT NULL', manual_authorised_at: 'DATETIME NULL', attendance_status: 'VARCHAR(30) NULL', review_required: 'TINYINT(1) NOT NULL DEFAULT 0', review_reason: 'VARCHAR(500) NULL' })) {
    await additive(`ALTER TABLE staff_attendance ADD COLUMN ${name} ${type}`);
  }
  await additive('ALTER TABLE staff_attendance ADD INDEX idx_attendance_delivery_period (clock_in, user_id)');
  await pool.query(`CREATE TABLE IF NOT EXISTS weekly_timesheet_deliveries (
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
  ) ENGINE=InnoDB`);
  for (const [name, type] of Object.entries({ generation_attempts: 'INT NOT NULL DEFAULT 0', next_generation_attempt_at: 'DATETIME NULL', timesheet_id: 'INT NULL', revision_authorised_by: 'INT NULL', revision_authorised_at: 'DATETIME NULL', revision_reason: 'VARCHAR(1000) NULL' })) {
    await additive(`ALTER TABLE weekly_timesheet_deliveries ADD COLUMN ${name} ${type}`);
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS weekly_timesheet_delivery_versions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, delivery_id BIGINT NOT NULL, version INT NOT NULL,
    user_id INT NOT NULL, period_start DATE NOT NULL, period_end DATE NOT NULL,
    recipient VARCHAR(254) NULL, source_sha256 CHAR(64) NOT NULL, snapshot_json LONGTEXT NOT NULL,
    delivery_format VARCHAR(16) NOT NULL DEFAULT 'PDF', content_sha256 CHAR(64) NULL, content_snapshot_json LONGTEXT NULL,
    total_minutes INT NOT NULL, email_queue_id BIGINT NULL, document_request_id BIGINT NULL, status VARCHAR(40) NOT NULL,
    created_by INT NULL, reason VARCHAR(1000) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_weekly_delivery_version (delivery_id, version)
  ) ENGINE=InnoDB`);
  await additive('ALTER TABLE weekly_timesheet_delivery_versions ADD COLUMN document_request_id BIGINT NULL');
  // Current HTML metadata is installed by the ordered retained migration.
  // Request/startup compatibility checks never conceal an incomplete migration.
  const [columns] = await pool.query("SELECT table_name AS table_name,column_name AS column_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name IN ('weekly_timesheet_deliveries','weekly_timesheet_delivery_versions') AND column_name IN ('delivery_format','content_sha256','content_snapshot_json')");
  const present = new Set(columns.map(column => column.table_name + '.' + column.column_name));
  if (['weekly_timesheet_deliveries','weekly_timesheet_delivery_versions'].some(table => ['delivery_format','content_sha256','content_snapshot_json'].some(column => !present.has(table + '.' + column)))) {
    throw Object.assign(new Error('Weekly HTML delivery schema is incomplete. Apply the ordered retained migration before starting weekly workers.'), { code: 'WEEKLY_HTML_SCHEMA_REQUIRED' });
  }
}
function ensureWeeklyTimesheetDeliverySchema() {
  if (!schemaPromise) schemaPromise = createSchema().catch((error) => { schemaPromise = null; throw error; });
  return schemaPromise;
}
module.exports = { ensureWeeklyTimesheetDeliverySchema };
