-- Durable Finance PDF email delivery
CREATE TABLE IF NOT EXISTS finance_report_email_deliveries (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  delivery_uid CHAR(36) NOT NULL,
  report_uid VARCHAR(80) NULL,
  filename VARCHAR(190) NOT NULL,
  mime_type VARCHAR(120) NOT NULL DEFAULT 'application/pdf',
  pdf_blob LONGBLOB NOT NULL,
  byte_size BIGINT NOT NULL,
  sha256 CHAR(64) NOT NULL,
  object_storage_key VARCHAR(500) NULL,
  created_by INT NULL,
  expires_at DATETIME NOT NULL,
  first_accessed_at DATETIME NULL,
  last_accessed_at DATETIME NULL,
  access_count INT NOT NULL DEFAULT 0,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_finance_report_email_delivery_uid (delivery_uid),
  INDEX idx_finance_report_email_delivery_expiry (expires_at, revoked_at),
  INDEX idx_finance_report_email_delivery_report (report_uid, created_at)
) ENGINE=InnoDB;
