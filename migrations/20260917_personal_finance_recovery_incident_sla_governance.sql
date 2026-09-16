ALTER TABLE personal_finance_recovery_incident_cases
  ADD COLUMN assignee_label VARCHAR(120) NULL AFTER title,
  ADD COLUMN response_due_at DATETIME NULL AFTER source_signal_type,
  ADD COLUMN resolution_due_at DATETIME NULL AFTER response_due_at,
  ADD COLUMN first_response_at DATETIME NULL AFTER resolution_due_at,
  ADD COLUMN escalation_level VARCHAR(16) NOT NULL DEFAULT 'L0' AFTER first_response_at,
  ADD COLUMN approval_checkpoint VARCHAR(32) NOT NULL DEFAULT 'NONE' AFTER remediation_decision,
  ADD COLUMN evidence_checklist_json JSON NULL AFTER approval_checkpoint,
  ADD COLUMN governance_policy_version VARCHAR(32) NOT NULL DEFAULT 'PF_RECOVERY_SLA_V1' AFTER evidence_checklist_json,
  ADD INDEX idx_pf_recovery_case_owner_sla (user_id, status, response_due_at, resolution_due_at),
  ADD INDEX idx_pf_recovery_case_owner_escalation (user_id, escalation_level, updated_at);

UPDATE personal_finance_recovery_incident_cases
SET response_due_at = COALESCE(response_due_at, DATE_ADD(opened_at, INTERVAL CASE WHEN source_level='CRITICAL' THEN 2 ELSE 24 END HOUR)),
    resolution_due_at = COALESCE(resolution_due_at, DATE_ADD(opened_at, INTERVAL CASE WHEN source_level='CRITICAL' THEN 24 ELSE 72 END HOUR)),
    evidence_checklist_json = COALESCE(evidence_checklist_json, JSON_OBJECT(
      'CURRENT_VERIFICATION', FALSE,
      'CANONICAL_BACKUP', FALSE,
      'CERTIFICATE_EVIDENCE', FALSE,
      'REMEDIATION_DECISION', FALSE,
      'RESOLUTION_VERIFICATION', FALSE
    ));