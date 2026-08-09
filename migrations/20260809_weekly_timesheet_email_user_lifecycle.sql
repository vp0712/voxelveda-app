-- Weekly timesheet email automation and safe user-account lifecycle.
-- Back up the database before applying this migration in production.

ALTER TABLE users
  ADD COLUMN deleted_at DATETIME NULL,
  ADD COLUMN deleted_by INT NULL,
  ADD COLUMN deletion_reason VARCHAR(255) NULL,
  ADD INDEX idx_users_active_deleted (active, deleted_at);

-- The email queue idempotency column and unique index are also created by
-- migrations/20260809_timesheet_workflow.sql and the additive startup schema.
-- Apply that migration first on databases that pre-date the timesheet workflow.
