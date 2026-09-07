const pool = require('../config/db');

let schemaPromise;

async function createSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS control_evidence (
    id CHAR(36) PRIMARY KEY,
    control_key VARCHAR(120) NOT NULL,
    evidence_type VARCHAR(80) NOT NULL,
    evidence_reference VARCHAR(700) NOT NULL,
    verification_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    verified_by INT NULL,
    verified_at DATETIME NULL,
    expires_at DATETIME NULL,
    notes VARCHAR(1000) NULL,
    created_by INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_control_evidence_key (control_key, verification_status, expires_at)
  ) ENGINE=InnoDB`);

  await pool.query(`CREATE TABLE IF NOT EXISTS enterprise_change_requests (
    id CHAR(36) PRIMARY KEY,
    title VARCHAR(180) NOT NULL,
    change_type VARCHAR(60) NOT NULL,
    risk_level VARCHAR(20) NOT NULL,
    description VARCHAR(2000) NOT NULL,
    rollback_plan VARCHAR(2000) NOT NULL,
    validation_plan VARCHAR(2000) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING_APPROVAL',
    requested_by INT NOT NULL,
    approved_by INT NULL,
    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_at DATETIME NULL,
    implemented_at DATETIME NULL,
    INDEX idx_change_status (status, risk_level, requested_at)
  ) ENGINE=InnoDB`);

  await pool.query(`CREATE TABLE IF NOT EXISTS resilience_drills (
    id CHAR(36) PRIMARY KEY,
    drill_type VARCHAR(80) NOT NULL,
    scenario VARCHAR(1200) NOT NULL,
    recovery_time_minutes INT NULL,
    recovery_point_minutes INT NULL,
    result_status VARCHAR(30) NOT NULL,
    evidence_reference VARCHAR(700) NULL,
    lessons_learned VARCHAR(1800) NULL,
    performed_by INT NOT NULL,
    performed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    next_due_at DATETIME NULL,
    INDEX idx_resilience_due (result_status, next_due_at)
  ) ENGINE=InnoDB`);

  await pool.query(`CREATE TABLE IF NOT EXISTS vendor_risk_assessments (
    id CHAR(36) PRIMARY KEY,
    vendor_name VARCHAR(180) NOT NULL,
    service_scope VARCHAR(500) NOT NULL,
    data_access_level VARCHAR(40) NOT NULL,
    criticality VARCHAR(20) NOT NULL,
    risk_score INT NOT NULL,
    status VARCHAR(30) NOT NULL,
    evidence_reference VARCHAR(700) NULL,
    owner_user_id INT NULL,
    reviewed_by INT NOT NULL,
    reviewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    next_review_at DATETIME NOT NULL,
    INDEX idx_vendor_review (status, criticality, next_review_at)
  ) ENGINE=InnoDB`);

  await pool.query(`CREATE TABLE IF NOT EXISTS ai_action_policies (
    id CHAR(36) PRIMARY KEY,
    action_key VARCHAR(120) NOT NULL UNIQUE,
    autonomy_level VARCHAR(30) NOT NULL DEFAULT 'SUGGEST_ONLY',
    max_risk_score INT NOT NULL DEFAULT 25,
    requires_human_approval TINYINT(1) NOT NULL DEFAULT 1,
    requires_step_up TINYINT(1) NOT NULL DEFAULT 0,
    blocked TINYINT(1) NOT NULL DEFAULT 0,
    policy_reason VARCHAR(1000) NOT NULL,
    updated_by INT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);

  await pool.query(`CREATE TABLE IF NOT EXISTS manufacturing_trace_events (
    id CHAR(36) PRIMARY KEY,
    job_reference VARCHAR(120) NOT NULL,
    batch_reference VARCHAR(120) NULL,
    event_type VARCHAR(80) NOT NULL,
    asset_reference VARCHAR(160) NULL,
    material_lot VARCHAR(120) NULL,
    operator_user_id INT NULL,
    quality_status VARCHAR(30) NULL,
    event_payload JSON NULL,
    integrity_hash CHAR(64) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_trace_job (job_reference, created_at),
    INDEX idx_trace_batch (batch_reference, created_at)
  ) ENGINE=InnoDB`);
}

async function ensureEnterpriseControlPlaneSchema() {
  if (!schemaPromise) schemaPromise = createSchema().catch((error) => { schemaPromise = null; throw error; });
  return schemaPromise;
}

module.exports = { ensureEnterpriseControlPlaneSchema };
