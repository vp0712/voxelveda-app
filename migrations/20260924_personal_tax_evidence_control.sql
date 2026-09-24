CREATE TABLE IF NOT EXISTS personal_tax_review_control (
  entry_id CHAR(36) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  review_status VARCHAR(24) NOT NULL DEFAULT 'UNREVIEWED',
  evidence_status VARCHAR(24) NOT NULL DEFAULT 'UNKNOWN',
  review_note VARCHAR(1000) NULL,
  accountant_question VARCHAR(1000) NULL,
  reviewed_at DATETIME NULL,
  updated_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_personal_tax_review_owner (user_id,review_status,evidence_status),
  INDEX idx_personal_tax_review_updated (user_id,updated_at)
);
