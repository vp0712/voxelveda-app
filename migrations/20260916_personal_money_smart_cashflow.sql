ALTER TABLE personal_money_recurring_items
  ADD COLUMN detected_source_key CHAR(64) NULL,
  ADD COLUMN detected_from_bank_account_id INT NULL,
  ADD COLUMN detection_confidence DECIMAL(5,2) NULL;

CREATE UNIQUE INDEX uniq_personal_recurring_detected_source
  ON personal_money_recurring_items (user_id, detected_source_key);

CREATE TABLE personal_money_safety_buffers (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  currency CHAR(3) NOT NULL,
  reserve_amount DECIMAL(18,4) NOT NULL DEFAULT 0,
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_personal_safety_buffer (user_id, currency),
  INDEX idx_personal_safety_buffer_user (user_id, currency)
);
