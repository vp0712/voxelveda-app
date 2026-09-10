-- Wave A deployment-owned migration ledger. The runner bootstraps this table
-- before discovery so this migration can be recorded like every later change.

CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_id VARCHAR(190) PRIMARY KEY,
  checksum_sha256 CHAR(64) NOT NULL,
  applied_at DATETIME NULL,
  deployment_sha VARCHAR(80) NULL,
  duration_ms BIGINT NULL,
  status VARCHAR(20) NOT NULL,
  error_code VARCHAR(80) NULL,
  error_message VARCHAR(500) NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_schema_migrations_status (status, migration_id)
) ENGINE=InnoDB;
