ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS archived_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS archived_by INT NULL,
  ADD COLUMN IF NOT EXISTS archive_reason VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS pre_archive_reconciliation_status VARCHAR(40) NULL,
  ADD COLUMN IF NOT EXISTS pre_archive_ignored_reason VARCHAR(500) NULL;

CREATE INDEX IF NOT EXISTS idx_bank_transactions_archived_at ON bank_transactions (archived_at);
