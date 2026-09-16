CREATE TABLE IF NOT EXISTS personal_tax_reviews (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  entry_id CHAR(36) NOT NULL,
  financial_year_start SMALLINT NOT NULL,
  review_status ENUM('CANDIDATE','NOT_CLAIMING','ASK_ACCOUNTANT') NOT NULL,
  evidence_status ENUM('HAS_EVIDENCE','MISSING_EVIDENCE','NOT_REQUIRED','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  note VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_personal_tax_review_entry (user_id, entry_id),
  INDEX idx_personal_tax_review_year (user_id, financial_year_start, review_status),
  CONSTRAINT fk_personal_tax_review_entry FOREIGN KEY (entry_id) REFERENCES personal_money_entries(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
