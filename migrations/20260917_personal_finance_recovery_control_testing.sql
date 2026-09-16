CREATE TABLE IF NOT EXISTS personal_finance_recovery_control_tests (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  control_category VARCHAR(64) NOT NULL,
  test_name VARCHAR(180) NOT NULL,
  test_procedure_json JSON NOT NULL,
  expected_evidence_json JSON NOT NULL,
  frequency_days INT NOT NULL DEFAULT 90,
  lifecycle_status ENUM('DRAFT','EXECUTED','REVIEWED','ASSURED') NOT NULL DEFAULT 'DRAFT',
  result ENUM('NOT_TESTED','PASS','FAIL','NEEDS_REVIEW') NOT NULL DEFAULT 'NOT_TESTED',
  tester_label VARCHAR(120) NULL,
  reviewer_label VARCHAR(120) NULL,
  review_note VARCHAR(500) NULL,
  evidence_refs_json JSON NULL,
  linked_capa_ids_json JSON NULL,
  linked_review_id VARCHAR(36) NULL,
  executed_at DATETIME NULL,
  reviewed_at DATETIME NULL,
  assurance_signed_at DATETIME NULL,
  assurance_note VARCHAR(500) NULL,
  next_retest_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pf_recovery_control_test_owner_name (user_id, control_category, test_name),
  KEY idx_pf_recovery_control_test_owner_status (user_id, lifecycle_status),
  KEY idx_pf_recovery_control_test_owner_retest (user_id, next_retest_at),
  KEY idx_pf_recovery_control_test_owner_category (user_id, control_category)
);

CREATE TABLE IF NOT EXISTS personal_finance_recovery_control_test_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  control_test_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  event_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pf_recovery_control_test_events_owner_test (user_id, control_test_id, id)
);
