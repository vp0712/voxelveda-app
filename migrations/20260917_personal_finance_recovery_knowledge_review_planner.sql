CREATE TABLE IF NOT EXISTS personal_finance_recovery_knowledge_review_plans (
  id VARCHAR(36) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  lesson_id VARCHAR(36) NOT NULL,
  owner_label VARCHAR(120) NOT NULL,
  cadence_days INT NOT NULL DEFAULT 120,
  next_review_at DATETIME(3) NOT NULL,
  last_reviewed_at DATETIME(3) NULL,
  last_review_result VARCHAR(40) NULL,
  last_reviewer_label VARCHAR(120) NULL,
  last_review_note TEXT NULL,
  last_evidence_refs_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pf_recovery_knowledge_review_lesson (user_id, lesson_id),
  KEY idx_pf_recovery_knowledge_review_due (user_id, next_review_at),
  KEY idx_pf_recovery_knowledge_review_result (user_id, last_review_result)
);

CREATE TABLE IF NOT EXISTS personal_finance_recovery_knowledge_review_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  plan_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  lesson_id VARCHAR(36) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  event_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_pf_recovery_knowledge_review_events_plan (user_id, plan_id, id),
  KEY idx_pf_recovery_knowledge_review_events_lesson (user_id, lesson_id, id)
);
