CREATE TABLE IF NOT EXISTS recovery_remediation_items (
  id VARCHAR(36) NOT NULL,
  drill_id VARCHAR(36) NOT NULL,
  title VARCHAR(180) NOT NULL,
  source_severity VARCHAR(24) NOT NULL,
  priority VARCHAR(24) NOT NULL DEFAULT 'HIGH',
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  owner_label VARCHAR(120) NULL,
  due_at DATETIME(3) NULL,
  remediation_note TEXT NULL,
  closure_evidence_json JSON NULL,
  source_reasons_json JSON NULL,
  created_by_user_id VARCHAR(191) NOT NULL,
  closed_by_user_id VARCHAR(191) NULL,
  closed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_recovery_remediation_open_source (drill_id, status),
  KEY idx_recovery_remediation_status_due (status, due_at),
  KEY idx_recovery_remediation_priority (priority, created_at),
  CONSTRAINT fk_recovery_remediation_drill FOREIGN KEY (drill_id) REFERENCES recovery_drill_records(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recovery_remediation_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  remediation_id VARCHAR(36) NOT NULL,
  actor_user_id VARCHAR(191) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  event_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_recovery_remediation_event_item (remediation_id, id),
  CONSTRAINT fk_recovery_remediation_event_item FOREIGN KEY (remediation_id) REFERENCES recovery_remediation_items(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
