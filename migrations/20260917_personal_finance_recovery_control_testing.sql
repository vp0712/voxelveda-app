CREATE TABLE IF NOT EXISTS personal_finance_recovery_control_tests (
  id CHAR(36) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  control_category VARCHAR(80) NOT NULL,
  procedure_title VARCHAR(180) NOT NULL,
  procedure_steps_json JSON NOT NULL,
  frequency_days INT NOT NULL,
  expected_evidence_json JSON NOT NULL,
  scheduled_at DATETIME NOT NULL,
  tester_label VARCHAR(120) NULL,
  reviewer_label VARCHAR(120) NULL,
  linked_capa_id CHAR(36) NULL,
  linked_review_id CHAR(36) NULL,
  result ENUM('PENDING','PASS','FAIL','NEEDS_REVIEW') NOT NULL DEFAULT 'PENDING',
  result_note VARCHAR(1200) NULL,
  evidence_refs_json JSON NOT NULL,
  tested_at DATETIME NULL,
  next_retest_at DATETIME NULL,
  signed_off_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pf_control_test_owner_category (user_id,control_category,created_at),
  INDEX idx_pf_control_test_owner_due (user_id,next_retest_at),
  INDEX idx_pf_control_test_links (user_id,linked_capa_id,linked_review_id)
);

CREATE TABLE IF NOT EXISTS personal_finance_recovery_control_test_events (
  id CHAR(36) PRIMARY KEY,
  control_test_id CHAR(36) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  note VARCHAR(1200) NULL,
  evidence_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pf_control_test_event_owner (user_id,control_test_id,created_at)
);