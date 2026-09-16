CREATE TABLE personal_money_recurring_matches (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  recurring_item_id CHAR(36) NOT NULL,
  bank_transaction_id BIGINT NOT NULL,
  decision ENUM('CONFIRMED','DISMISSED') NOT NULL,
  match_confidence DECIMAL(5,2) NOT NULL,
  expected_amount DECIMAL(18,4) NOT NULL,
  actual_amount DECIMAL(18,4) NOT NULL,
  expected_due_date DATE NULL,
  transaction_date DATE NOT NULL,
  amount_updated TINYINT(1) NOT NULL DEFAULT 0,
  decided_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_personal_recurring_match_transaction (user_id, recurring_item_id, bank_transaction_id),
  INDEX idx_personal_recurring_matches_user_decision (user_id, decision, decided_at),
  INDEX idx_personal_recurring_matches_transaction (bank_transaction_id),
  CONSTRAINT fk_personal_recurring_match_item FOREIGN KEY (recurring_item_id) REFERENCES personal_money_recurring_items(id)
);
