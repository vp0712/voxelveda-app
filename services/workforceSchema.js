const pool = require('../config/db');

let schemaPromise;

async function addColumn(sql) {
  try {
    await pool.query(sql);
  } catch (error) {
    if (error?.code !== 'ER_DUP_FIELDNAME') throw error;
  }
}

async function addIndex(sql) {
  try {
    await pool.query(sql);
  } catch (error) {
    if (!['ER_DUP_KEYNAME', 'ER_DUP_ENTRY'].includes(error?.code)) throw error;
  }
}

async function createWorkforceSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS weekly_timesheets (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      week_start DATE NOT NULL,
      week_end DATE NOT NULL,
      total_hours DECIMAL(8,2) NOT NULL DEFAULT 0,
      status VARCHAR(40) NOT NULL DEFAULT 'DRAFT',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_weekly_timesheet (user_id, week_start, week_end)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS timesheet_versions (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      timesheet_id INT NOT NULL,
      version_no INT NOT NULL,
      status VARCHAR(40) NOT NULL,
      snapshot_json LONGTEXT NOT NULL,
      reason TEXT NULL,
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_timesheet_version (timesheet_id, version_no),
      INDEX idx_timesheet_versions_timesheet (timesheet_id, created_at)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS timesheet_approvals (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      timesheet_id INT NOT NULL,
      action VARCHAR(40) NOT NULL,
      from_status VARCHAR(40) NOT NULL,
      to_status VARCHAR(40) NOT NULL,
      comments TEXT NULL,
      acted_by INT NULL,
      acted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_timesheet_approvals_timesheet (timesheet_id, acted_at)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payroll_ready (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      timesheet_id INT NOT NULL,
      user_id INT NOT NULL,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      ordinary_hours DECIMAL(9,2) NOT NULL DEFAULT 0,
      overtime_hours DECIMAL(9,2) NOT NULL DEFAULT 0,
      approved_hours DECIMAL(9,2) NOT NULL DEFAULT 0,
      hourly_rate DECIMAL(12,2) NOT NULL DEFAULT 0,
      gross_estimated_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      allowance DECIMAL(14,2) NOT NULL DEFAULT 0,
      adjustment DECIMAL(14,2) NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'READY',
      exported_at DATETIME NULL,
      processed_at DATETIME NULL,
      locked_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_payroll_timesheet (timesheet_id),
      INDEX idx_payroll_period_status (period_start, period_end, status),
      INDEX idx_payroll_user (user_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      type VARCHAR(80) NOT NULL,
      title VARCHAR(180) NOT NULL,
      message TEXT NULL,
      priority VARCHAR(20) NOT NULL DEFAULT 'normal',
      linked_module VARCHAR(80) NULL,
      linked_record_id VARCHAR(80) NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      read_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_notifications_user_read (user_id, is_read, created_at)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      actor_id INT NULL,
      action VARCHAR(120) NOT NULL,
      module VARCHAR(80) NOT NULL,
      record_type VARCHAR(80) NULL,
      record_id VARCHAR(80) NULL,
      old_value LONGTEXT NULL,
      new_value LONGTEXT NULL,
      ip_address VARCHAR(80) NULL,
      user_agent TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_audit_module_record (module, record_id),
      INDEX idx_audit_actor_created (actor_id, created_at)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      module VARCHAR(80) NOT NULL,
      record_id VARCHAR(80) NOT NULL,
      event_type VARCHAR(100) NOT NULL,
      message TEXT NULL,
      actor_id INT NULL,
      metadata_json LONGTEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_activity_record (module, record_id, created_at)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_queue (
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
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_logs (
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
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_templates (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      template_key VARCHAR(100) NOT NULL,
      name VARCHAR(180) NOT NULL,
      subject_template VARCHAR(255) NOT NULL,
      html_template LONGTEXT NOT NULL,
      text_template LONGTEXT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_email_template_key (template_key)
    )
  `);

  await addColumn(`ALTER TABLE weekly_timesheets ADD COLUMN ordinary_hours DECIMAL(9,2) NOT NULL DEFAULT 0`);
  await addColumn(`ALTER TABLE weekly_timesheets ADD COLUMN overtime_hours DECIMAL(9,2) NOT NULL DEFAULT 0`);
  await addColumn(`ALTER TABLE weekly_timesheets ADD COLUMN approved_hours DECIMAL(9,2) NOT NULL DEFAULT 0`);
  await addColumn(`ALTER TABLE weekly_timesheets ADD COLUMN submitted_at DATETIME NULL`);
  await addColumn(`ALTER TABLE weekly_timesheets ADD COLUMN approved_at DATETIME NULL`);
  await addColumn(`ALTER TABLE weekly_timesheets ADD COLUMN approved_by INT NULL`);
  await addColumn(`ALTER TABLE weekly_timesheets ADD COLUMN rejected_at DATETIME NULL`);
  await addColumn(`ALTER TABLE weekly_timesheets ADD COLUMN rejected_by INT NULL`);
  await addColumn(`ALTER TABLE weekly_timesheets ADD COLUMN correction_requested_at DATETIME NULL`);
  await addColumn(`ALTER TABLE weekly_timesheets ADD COLUMN correction_requested_by INT NULL`);
  await addColumn(`ALTER TABLE weekly_timesheets ADD COLUMN manager_comments TEXT NULL`);
  await addColumn(`ALTER TABLE weekly_timesheets ADD COLUMN version_no INT NOT NULL DEFAULT 0`);
  await addColumn(`ALTER TABLE weekly_timesheets ADD COLUMN payroll_status VARCHAR(30) NOT NULL DEFAULT 'NOT_READY'`);
  await addIndex(`ALTER TABLE weekly_timesheets ADD INDEX idx_weekly_timesheet_status (status, week_start, week_end)`);
  await addColumn(`ALTER TABLE email_queue ADD COLUMN idempotency_key VARCHAR(180) NULL`);
  await addIndex(`ALTER TABLE email_queue ADD UNIQUE KEY uniq_email_idempotency (idempotency_key)`);

  await pool.query(`
    UPDATE weekly_timesheets
    SET status = CASE LOWER(status)
      WHEN 'open' THEN 'PENDING_APPROVAL'
      WHEN 'approved' THEN 'APPROVED'
      WHEN 'rejected' THEN 'REJECTED'
      ELSE UPPER(status)
    END
    WHERE status IS NOT NULL
  `);
}

async function ensureWorkforceSchema() {
  if (!schemaPromise) {
    schemaPromise = createWorkforceSchema().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

module.exports = { ensureWorkforceSchema };
