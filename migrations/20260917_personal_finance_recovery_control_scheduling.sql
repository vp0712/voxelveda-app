CREATE TABLE IF NOT EXISTS personal_finance_recovery_control_evidence_requests (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  control_test_id VARCHAR(36) NOT NULL,
  request_type ENUM('EVIDENCE','REVIEW','RETEST','ASSURANCE') NOT NULL,
  status ENUM('OPEN','COMPLETED','CANCELLED') NOT NULL DEFAULT 'OPEN',
  request_note VARCHAR(500) NULL,
  required_items_json JSON NULL,
  collected_refs_json JSON NULL,
  due_at DATETIME NULL,
  completed_at DATETIME NULL,
  completion_note VARCHAR(500) NULL,
  cancelled_at DATETIME NULL,
  cancel_reason VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_pf_recovery_control_request_owner_status (user_id, status),
  KEY idx_pf_recovery_control_request_owner_due (user_id, due_at),
  KEY idx_pf_recovery_control_request_owner_test (user_id, control_test_id, created_at)
);

CREATE TABLE IF NOT EXISTS personal_finance_recovery_control_evidence_request_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  event_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pf_recovery_control_request_events_owner (user_id, request_id, id)
);
