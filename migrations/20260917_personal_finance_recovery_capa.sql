CREATE TABLE IF NOT EXISTS personal_finance_recovery_capa (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  capa_key VARCHAR(191) NOT NULL,
  source_category VARCHAR(64) NOT NULL,
  title VARCHAR(180) NOT NULL,
  description VARCHAR(1000) NULL,
  action_type ENUM('CORRECTIVE','PREVENTIVE','BOTH') NOT NULL DEFAULT 'BOTH',
  status ENUM('OPEN','IN_PROGRESS','IMPLEMENTED','EFFECTIVENESS_REVIEW','CLOSED') NOT NULL DEFAULT 'OPEN',
  owner_label VARCHAR(120) NULL,
  due_at DATETIME NULL,
  source_case_ids_json JSON NULL,
  source_review_id VARCHAR(36) NULL,
  action_plan_json JSON NULL,
  evidence_refs_json JSON NULL,
  effectiveness_result ENUM('NOT_CHECKED','EFFECTIVE','NOT_EFFECTIVE','INSUFFICIENT_EVIDENCE') NOT NULL DEFAULT 'NOT_CHECKED',
  effectiveness_checked_at DATETIME NULL,
  implemented_at DATETIME NULL,
  closed_at DATETIME NULL,
  closure_reason VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pf_recovery_capa_owner_key (user_id, capa_key),
  KEY idx_pf_recovery_capa_owner_status (user_id, status),
  KEY idx_pf_recovery_capa_owner_due (user_id, due_at)
);

CREATE TABLE IF NOT EXISTS personal_finance_recovery_capa_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  capa_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  event_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pf_recovery_capa_events_owner_capa (user_id, capa_id, id)
);
