const pool = require('../config/db');

let schemaPromise;

const SEEDED_WORKFLOWS = [
  ['PROCUREMENT_APPROVAL', 'Purchase approval', 'PROCUREMENT', 'Purchase and procurement requests', 'PERMISSION', 'EDIT_SUPPLIERS'],
  ['EXPENSE_APPROVAL', 'Expense approval', 'EXPENSE', 'Expense review and payment authorization', 'PERMISSION', 'APPROVE_PAYMENT'],
  ['FINANCE_APPROVAL', 'Finance approval', 'FINANCE', 'Controlled finance approvals', 'PERMISSION', 'APPROVE_PAYMENT'],
  ['SUPPLIER_APPROVAL', 'Supplier approval', 'SUPPLIER', 'Supplier onboarding and material changes', 'PERMISSION', 'EDIT_SUPPLIERS'],
  ['QUALITY_APPROVAL', 'Quality approval', 'QUALITY', 'Quality review and release decisions', 'PERMISSION', 'APPROVE_QMS'],
  ['CAPA_APPROVAL', 'CAPA approval', 'CAPA', 'Corrective and preventive action approval', 'PERMISSION', 'APPROVE_QMS'],
  ['DOCUMENT_APPROVAL', 'Document approval', 'DOCUMENT', 'Controlled document approval', 'PERMISSION', 'MANAGE_DOCUMENT_CONTROL'],
  ['SECURITY_APPROVAL', 'Security approval', 'SECURITY', 'Security and privileged access approval', 'PERMISSION', 'MANAGE_SECURITY'],
  ['HR_APPROVAL', 'HR request approval', 'HR', 'HR, leave and workforce requests', 'PERMISSION', 'VIEW_STAFF_HR']
];

async function seedWorkflowDefinitions() {
  for (const [key, name, module, description, approverType, approverValue] of SEEDED_WORKFLOWS) {
    await pool.query(
      `INSERT IGNORE INTO workflow_definitions
       (workflow_key, version, name, module, description, status, allow_self_approval)
       VALUES (?, 1, ?, ?, ?, 'ACTIVE', 0)`,
      [key, name, module, description]
    );
    const [[definition]] = await pool.query(
      'SELECT id FROM workflow_definitions WHERE workflow_key = ? AND version = 1 LIMIT 1',
      [key]
    );
    if (!definition) continue;
    await pool.query(
      `INSERT IGNORE INTO workflow_steps
       (definition_id, step_order, name, approver_type, approver_value, approval_mode,
        minimum_approvals, sla_hours, escalation_role)
       VALUES (?, 1, 'Review and approve', ?, ?, 'ANY', 1, 24, 'admin')`,
      [definition.id, approverType, approverValue]
    );
  }
}

async function createWorkflowSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workflow_definitions (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      workflow_key VARCHAR(80) NOT NULL,
      version INT NOT NULL,
      name VARCHAR(160) NOT NULL,
      module VARCHAR(60) NOT NULL,
      description TEXT NULL,
      status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
      allow_self_approval TINYINT(1) NOT NULL DEFAULT 0,
      created_by BIGINT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_workflow_definition_version (workflow_key, version),
      INDEX idx_workflow_definition_active (workflow_key, status, version)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workflow_steps (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      definition_id BIGINT NOT NULL,
      step_order INT NOT NULL,
      name VARCHAR(160) NOT NULL,
      approver_type ENUM('USER','ROLE','PERMISSION','MANAGER') NOT NULL,
      approver_value VARCHAR(120) NULL,
      approval_mode ENUM('ANY','ALL') NOT NULL DEFAULT 'ANY',
      minimum_approvals INT NOT NULL DEFAULT 1,
      sla_hours INT NOT NULL DEFAULT 24,
      escalation_role VARCHAR(80) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_workflow_step_order (definition_id, step_order),
      INDEX idx_workflow_steps_definition (definition_id, step_order)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workflow_instances (
      id CHAR(36) PRIMARY KEY,
      definition_id BIGINT NOT NULL,
      workflow_key VARCHAR(80) NOT NULL,
      workflow_version INT NOT NULL,
      module VARCHAR(60) NOT NULL,
      entity_type VARCHAR(80) NOT NULL,
      entity_id VARCHAR(100) NOT NULL,
      title VARCHAR(200) NOT NULL,
      summary TEXT NULL,
      status ENUM('PENDING','BLOCKED_ASSIGNMENT','NEEDS_CHANGES','APPROVED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
      current_step_order INT NOT NULL DEFAULT 1,
      requester_id BIGINT NOT NULL,
      payload_json JSON NULL,
      requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      due_at DATETIME NULL,
      completed_at DATETIME NULL,
      cancelled_at DATETIME NULL,
      revision INT NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_workflow_instance_requester (requester_id, status, created_at),
      INDEX idx_workflow_instance_entity (module, entity_type, entity_id),
      INDEX idx_workflow_instance_active (status, due_at)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workflow_assignments (
      id CHAR(36) PRIMARY KEY,
      instance_id CHAR(36) NOT NULL,
      step_id BIGINT NOT NULL,
      assignee_user_id BIGINT NOT NULL,
      status ENUM('PENDING','APPROVED','REJECTED','CHANGES_REQUESTED','SKIPPED','CANCELLED') NOT NULL DEFAULT 'PENDING',
      assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      acted_at DATETIME NULL,
      due_at DATETIME NULL,
      UNIQUE KEY uniq_workflow_assignment (instance_id, step_id, assignee_user_id),
      INDEX idx_workflow_assignment_inbox (assignee_user_id, status, due_at),
      INDEX idx_workflow_assignment_instance (instance_id, step_id, status)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workflow_actions (
      id CHAR(36) PRIMARY KEY,
      instance_id CHAR(36) NOT NULL,
      step_id BIGINT NULL,
      actor_id BIGINT NOT NULL,
      action_type ENUM('SUBMIT','APPROVE','REJECT','REQUEST_CHANGES','CANCEL','REASSIGN','ESCALATE') NOT NULL,
      comment TEXT NULL,
      from_status VARCHAR(40) NULL,
      to_status VARCHAR(40) NULL,
      metadata_json JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_workflow_actions_instance (instance_id, created_at),
      INDEX idx_workflow_actions_actor (actor_id, created_at)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workflow_escalations (
      id CHAR(36) PRIMARY KEY,
      instance_id CHAR(36) NOT NULL,
      step_id BIGINT NOT NULL,
      assignment_id CHAR(36) NOT NULL,
      escalation_level INT NOT NULL DEFAULT 1,
      from_user_id BIGINT NULL,
      to_user_id BIGINT NULL,
      reason VARCHAR(500) NOT NULL,
      status ENUM('OPEN','ACKNOWLEDGED','RESOLVED') NOT NULL DEFAULT 'OPEN',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME NULL,
      UNIQUE KEY uniq_workflow_escalation_level (assignment_id, escalation_level),
      INDEX idx_workflow_escalation_open (status, created_at)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workflow_sla_events (
      id CHAR(36) PRIMARY KEY,
      instance_id CHAR(36) NOT NULL,
      step_id BIGINT NOT NULL,
      assignment_id CHAR(36) NOT NULL,
      event_type ENUM('DUE_SOON','BREACHED','ESCALATED') NOT NULL,
      due_at DATETIME NULL,
      metadata_json JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_workflow_sla_event (assignment_id, event_type),
      INDEX idx_workflow_sla_instance (instance_id, created_at)
    )
  `);
  await seedWorkflowDefinitions();
}

async function ensureWorkflowSchema() {
  if (!schemaPromise) {
    schemaPromise = createWorkflowSchema().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

module.exports = { SEEDED_WORKFLOWS, ensureWorkflowSchema };
