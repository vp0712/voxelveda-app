-- Weekly timesheet email automation and safe user-account lifecycle.
-- Back up the database before applying this migration in production.

ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by INT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_reason VARCHAR(255) NULL;

SET @vv_has_users_active_deleted = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'users'
    AND index_name = 'idx_users_active_deleted'
);
SET @vv_users_active_deleted_sql = IF(
  @vv_has_users_active_deleted = 0,
  'ALTER TABLE users ADD INDEX idx_users_active_deleted (active, deleted_at)',
  'SELECT 1'
);
PREPARE vv_users_active_deleted_stmt FROM @vv_users_active_deleted_sql;
EXECUTE vv_users_active_deleted_stmt;
DEALLOCATE PREPARE vv_users_active_deleted_stmt;

-- The email queue idempotency column and unique index are also created by
-- migrations/20260809_timesheet_workflow.sql and the additive startup schema.
-- Apply that migration first on databases that pre-date the timesheet workflow.
