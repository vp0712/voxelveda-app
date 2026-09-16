ALTER TABLE personal_finance_recovery_evidence_investigations
  ADD COLUMN first_response_at DATETIME NULL AFTER owner_label,
  ADD COLUMN response_due_at DATETIME NULL AFTER first_response_at,
  ADD COLUMN resolution_due_at DATETIME NULL AFTER response_due_at,
  ADD COLUMN hypotheses_json JSON NULL AFTER investigation_notes_json,
  ADD COLUMN cause_evidence_json JSON NULL AFTER hypotheses_json,
  ADD COLUMN cause_conclusion ENUM('NOT_ASSESSED','EVIDENCE_SUPPORTED_CONTRIBUTOR','INSUFFICIENT_EVIDENCE','EVIDENCE_CONTRADICTED') NOT NULL DEFAULT 'NOT_ASSESSED' AFTER cause_evidence_json,
  ADD COLUMN reviewer_label VARCHAR(120) NULL AFTER cause_conclusion,
  ADD COLUMN review_status ENUM('NOT_REVIEWED','APPROVED','CHANGES_REQUIRED') NOT NULL DEFAULT 'NOT_REVIEWED' AFTER reviewer_label,
  ADD COLUMN review_note VARCHAR(1000) NULL AFTER review_status,
  ADD COLUMN reviewed_at DATETIME NULL AFTER review_note,
  ADD KEY idx_pf_recovery_evidence_investigation_response_due (user_id,response_due_at),
  ADD KEY idx_pf_recovery_evidence_investigation_resolution_due (user_id,resolution_due_at),
  ADD KEY idx_pf_recovery_evidence_investigation_review (user_id,review_status);
