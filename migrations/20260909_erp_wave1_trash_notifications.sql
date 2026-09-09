CREATE TABLE IF NOT EXISTS trash_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  trash_uuid CHAR(36) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(120) NOT NULL,
  entity_display_name VARCHAR(255) NOT NULL,
  source_module VARCHAR(100) NOT NULL,
  original_parent_type VARCHAR(80) NULL,
  original_parent_id VARCHAR(120) NULL,
  deleted_by BIGINT NULL,
  deleted_at DATETIME NOT NULL,
  delete_reason TEXT NULL,
  purge_at DATETIME NOT NULL,
  restore_status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  restored_by BIGINT NULL,
  restored_at DATETIME NULL,
  purged_at DATETIME NULL,
  metadata_json LONGTEXT NULL,
  integrity_hash CHAR(64) NOT NULL,
  retention_hold TINYINT(1) NOT NULL DEFAULT 0,
  purge_attempts INT NOT NULL DEFAULT 0,
  purge_error TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_trash_uuid (trash_uuid),
  INDEX idx_trash_active_purge (restore_status, purge_at),
  INDEX idx_trash_entity (entity_type, entity_id, restore_status),
  INDEX idx_trash_actor (deleted_by, deleted_at),
  INDEX idx_trash_module (source_module, deleted_at)
);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS category VARCHAR(40) NOT NULL DEFAULT 'SYSTEM';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_url VARCHAR(500) NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dismissed_at DATETIME NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS deleted_by BIGINT NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS delete_reason TEXT NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS purge_after DATETIME NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS expires_at DATETIME NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP;

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
);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL, ADD COLUMN IF NOT EXISTS deleted_by BIGINT NULL, ADD COLUMN IF NOT EXISTS delete_reason TEXT NULL, ADD COLUMN IF NOT EXISTS purge_after DATETIME NULL;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL, ADD COLUMN IF NOT EXISTS deleted_by BIGINT NULL, ADD COLUMN IF NOT EXISTS delete_reason TEXT NULL, ADD COLUMN IF NOT EXISTS purge_after DATETIME NULL;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL, ADD COLUMN IF NOT EXISTS deleted_by BIGINT NULL, ADD COLUMN IF NOT EXISTS delete_reason TEXT NULL, ADD COLUMN IF NOT EXISTS purge_after DATETIME NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL, ADD COLUMN IF NOT EXISTS deleted_by BIGINT NULL, ADD COLUMN IF NOT EXISTS delete_reason TEXT NULL, ADD COLUMN IF NOT EXISTS purge_after DATETIME NULL;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL, ADD COLUMN IF NOT EXISTS deleted_by BIGINT NULL, ADD COLUMN IF NOT EXISTS delete_reason TEXT NULL, ADD COLUMN IF NOT EXISTS purge_after DATETIME NULL;
ALTER TABLE staff_messages ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL, ADD COLUMN IF NOT EXISTS deleted_by BIGINT NULL, ADD COLUMN IF NOT EXISTS delete_reason TEXT NULL, ADD COLUMN IF NOT EXISTS purge_after DATETIME NULL;
ALTER TABLE staff_work_requests ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL, ADD COLUMN IF NOT EXISTS deleted_by BIGINT NULL, ADD COLUMN IF NOT EXISTS delete_reason TEXT NULL, ADD COLUMN IF NOT EXISTS purge_after DATETIME NULL;

-- Runtime schema initialisation adds the standard deletion columns only to
-- eligible tables that already exist. Historical deleted rows are deliberately
-- not backfilled because their deletion time and actor are unknown.
