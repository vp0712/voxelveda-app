CREATE TABLE IF NOT EXISTS personal_finance_recovery_knowledge_dispositions (
  id CHAR(36) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  lesson_id CHAR(36) NOT NULL,
  proposed_action VARCHAR(32) NOT NULL,
  proposer_label VARCHAR(120) NOT NULL,
  proposal_note VARCHAR(1600) NOT NULL,
  proposal_evidence_refs_json JSON NOT NULL,
  superseding_lesson_id CHAR(36) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  decision VARCHAR(32) NULL,
  decision_maker_label VARCHAR(120) NULL,
  decision_note VARCHAR(1600) NULL,
  decision_evidence_refs_json JSON NULL,
  decided_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pf_recovery_knowledge_disposition_lesson (user_id, lesson_id),
  KEY idx_pf_recovery_knowledge_disposition_status (user_id, status),
  KEY idx_pf_recovery_knowledge_disposition_superseding (user_id, superseding_lesson_id)
);

CREATE TABLE IF NOT EXISTS personal_finance_recovery_knowledge_disposition_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  disposition_id CHAR(36) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  lesson_id CHAR(36) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  event_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_pf_recovery_knowledge_disposition_events (user_id, disposition_id, id)
);