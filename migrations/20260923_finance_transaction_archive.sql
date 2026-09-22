ALTER TABLE bank_transactions
  ADD COLUMN archived_at DATETIME NULL,
  ADD COLUMN archived_by INT NULL,
  ADD COLUMN archive_reason VARCHAR(500) NULL,
  ADD COLUMN pre_archive_reconciliation_status VARCHAR(40) NULL,
  ADD COLUMN pre_archive_ignored_reason VARCHAR(500) NULL,
  ADD INDEX idx_bank_transactions_archived_at (archived_at);
