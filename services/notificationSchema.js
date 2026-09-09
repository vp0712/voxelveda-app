const pool = require('../config/db');

let schemaPromise;

async function addColumn(definition) {
  await pool.query(`ALTER TABLE notifications ADD COLUMN ${definition}`).catch((error) => {
    if (error?.code !== 'ER_DUP_FIELDNAME') throw error;
  });
}

async function addIndex(definition) {
  await pool.query(`ALTER TABLE notifications ADD ${definition}`).catch((error) => {
    if (!['ER_DUP_KEYNAME', 'ER_DUP_INDEX'].includes(error?.code)) throw error;
  });
}

async function createNotificationSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      type VARCHAR(80) NOT NULL,
      category VARCHAR(40) NOT NULL DEFAULT 'SYSTEM',
      title VARCHAR(180) NOT NULL,
      message TEXT NULL,
      priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
      linked_module VARCHAR(80) NULL,
      linked_record_id VARCHAR(80) NULL,
      action_url VARCHAR(500) NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      read_at DATETIME NULL,
      dismissed_at DATETIME NULL,
      deleted_at DATETIME NULL,
      deleted_by BIGINT NULL,
      delete_reason TEXT NULL,
      purge_after DATETIME NULL,
      expires_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_notifications_user_active (user_id, deleted_at, created_at),
      INDEX idx_notifications_unread (user_id, is_read, deleted_at),
      INDEX idx_notifications_category (user_id, category, created_at),
      INDEX idx_notifications_priority (user_id, priority, created_at)
    )
  `);

  await addColumn("category VARCHAR(40) NOT NULL DEFAULT 'SYSTEM'");
  await addColumn('action_url VARCHAR(500) NULL');
  await addColumn('dismissed_at DATETIME NULL');
  await addColumn('deleted_at DATETIME NULL');
  await addColumn('deleted_by BIGINT NULL');
  await addColumn('delete_reason TEXT NULL');
  await addColumn('purge_after DATETIME NULL');
  await addColumn('expires_at DATETIME NULL');
  await addColumn('updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP');
  await addIndex('INDEX idx_notifications_user_active (user_id, deleted_at, created_at)');
  await addIndex('INDEX idx_notifications_unread (user_id, is_read, deleted_at)');
  await addIndex('INDEX idx_notifications_category (user_id, category, created_at)');
  await addIndex('INDEX idx_notifications_priority (user_id, priority, created_at)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_preferences (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      category VARCHAR(40) NOT NULL,
      in_app_enabled TINYINT(1) NOT NULL DEFAULT 1,
      email_enabled TINYINT(1) NOT NULL DEFAULT 0,
      push_enabled TINYINT(1) NOT NULL DEFAULT 0,
      quiet_hours_start TIME NULL,
      quiet_hours_end TIME NULL,
      digest_frequency VARCHAR(20) NOT NULL DEFAULT 'IMMEDIATE',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_notification_preference (user_id, category),
      INDEX idx_notification_preferences_user (user_id)
    )
  `);
}

async function ensureNotificationSchema() {
  if (!schemaPromise) {
    schemaPromise = createNotificationSchema().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

module.exports = { ensureNotificationSchema };
