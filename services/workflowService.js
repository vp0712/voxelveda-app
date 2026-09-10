const crypto = require('crypto');
const pool = require('../config/db');
const { hasAnyPermission, hasPermission } = require('./authorizationService');
const { logAudit } = require('./auditService');
const { createNotification } = require('./notificationService');
const { ensureWorkflowSchema } = require('./workflowSchema');

const ACTIVE_STATUSES = ['PENDING', 'BLOCKED_ASSIGNMENT'];
const ACTIONS = new Set(['APPROVE', 'REJECT', 'REQUEST_CHANGES']);
const APPROVER_TYPES = new Set(['USER', 'ROLE', 'PERMISSION', 'MANAGER']);
const APPROVAL_MODES = new Set(['ANY', 'ALL']);
const MODULE_SUBMIT_PERMISSIONS = Object.freeze({
  PROCUREMENT: ['VIEW_PROCUREMENT'],
  EXPENSE: ['VIEW_FINANCE'],
  FINANCE: ['VIEW_FINANCE'],
  SUPPLIER: ['VIEW_SUPPLIERS'],
  QUALITY: ['VIEW_QMS'],
  CAPA: ['VIEW_QMS'],
  DOCUMENT: ['VIEW_DASHBOARD'],
  SECURITY: ['VIEW_SECURITY_GOVERNANCE', 'MANAGE_SECURITY'],
  HR: ['VIEW_ATTENDANCE', 'VIEW_STAFF_HR']
});

class WorkflowError extends Error {
  constructor(message, code = 'WORKFLOW_ERROR', statusCode = 400, details = null) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function safeJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function trim(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function requestContext(req) {
  return {
    ipAddress: req?.ip || null,
    userAgent: req?.get?.('user-agent') || null,
    requestId: req?.id || req?.headers?.['x-request-id'] || null,
    sessionId: req?.session?.id || null
  };
}

function lockName(namespace, value) {
  return `vv_${namespace}_${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 36)}`;
}

function isAdminPortalRole(role) {
  return ['admin', 'super_admin'].includes(String(role || '').toLowerCase());
}

function approvalUrl(user) {
  return `${isAdminPortalRole(user?.role) ? '/admin' : '/dashboard'}?view=approvals`;
}

async function activeUsers(db) {
  const [users] = await db.query(
    `SELECT id, name, email, role, permissions, manager_id
     FROM users WHERE active = 1 AND deleted_at IS NULL`
  );
  return users;
}

async function resolveApprovers(db, step, requesterId, allowSelfApproval = false) {
  const users = await activeUsers(db);
  const value = trim(step.approver_value, 120);
  let approvers = [];
  if (step.approver_type === 'USER') {
    approvers = users.filter((user) => Number(user.id) === Number(value));
  } else if (step.approver_type === 'ROLE') {
    approvers = users.filter((user) => String(user.role || '').toLowerCase() === value.toLowerCase());
  } else if (step.approver_type === 'PERMISSION') {
    approvers = users.filter((user) => hasPermission(user, value));
  } else if (step.approver_type === 'MANAGER') {
    const requester = users.find((user) => Number(user.id) === Number(requesterId));
    approvers = users.filter((user) => Number(user.id) === Number(requester?.manager_id));
  }
  approvers = approvers.filter((user) => hasPermission(user, 'ACTION_APPROVALS'));
  return allowSelfApproval ? approvers : approvers.filter((user) => Number(user.id) !== Number(requesterId));
}

async function notify(db, user, notification) {
  return createNotification(db, {
    userId: user.id,
    type: notification.type,
    category: notification.category || 'TASKS',
    title: notification.title,
    message: notification.message,
    priority: notification.priority || 'HIGH',
    linkedModule: 'WORKFLOW',
    linkedRecordId: notification.instanceId,
    actionUrl: approvalUrl(user)
  });
}

async function notifyBlockedManagers(db, instance) {
  const users = await activeUsers(db);
  const managers = users.filter((candidate) => hasPermission(candidate, 'MANAGE_WORKFLOWS'));
  for (const manager of managers) {
    await notify(db, manager, {
      type: 'workflow_assignment_blocked',
      title: 'Approval assignment required',
      message: `${instance.title} has no complete reviewer assignment and needs attention.`,
      priority: 'CRITICAL',
      instanceId: instance.id
    });
  }
  return managers.length;
}

async function getDefinition(db, workflowKey, lock = false) {
  const [definitions] = await db.query(
    `SELECT * FROM workflow_definitions
     WHERE workflow_key = ? AND status = 'ACTIVE'
     ORDER BY version DESC LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [workflowKey]
  );
  const definition = definitions[0];
  if (!definition) throw new WorkflowError('Active workflow definition was not found', 'WORKFLOW_DEFINITION_NOT_FOUND', 404);
  const [steps] = await db.query(
    'SELECT * FROM workflow_steps WHERE definition_id = ? ORDER BY step_order',
    [definition.id]
  );
  if (!steps.length) throw new WorkflowError('Workflow definition has no approval steps', 'WORKFLOW_STEPS_MISSING', 409);
  return { ...definition, steps };
}

async function createAssignments(db, instance, step) {
  const approvers = await resolveApprovers(db, step, instance.requester_id, Boolean(Number(instance.allow_self_approval)));
  const dueAt = new Date(Date.now() + Math.max(1, Number(step.sla_hours || 24)) * 60 * 60 * 1000);
  for (const approver of approvers) {
    await db.query(
      `INSERT IGNORE INTO workflow_assignments
       (id, instance_id, step_id, assignee_user_id, status, due_at)
       VALUES (?, ?, ?, ?, 'PENDING', ?)`,
      [crypto.randomUUID(), instance.id, step.id, approver.id, dueAt]
    );
    await notify(db, approver, {
      type: 'workflow_assignment',
      title: 'Approval required',
      message: `${instance.title} is waiting for your review.`,
      priority: 'HIGH',
      instanceId: instance.id
    });
  }
  const minimum = Math.max(1, Number(step.minimum_approvals || 1));
  const ready = step.approval_mode === 'ALL' ? approvers.length > 0 : approvers.length >= minimum;
  return { approvers, dueAt, ready };
}

function assertModuleAccess(user, module) {
  const required = MODULE_SUBMIT_PERMISSIONS[module] || [];
  if (!required.length || !hasAnyPermission(user, required)) {
    throw new WorkflowError('You do not have access to submit this workflow type', 'WORKFLOW_MODULE_ACCESS_DENIED', 403);
  }
}

function validatePayload(payload) {
  if (payload == null) return null;
  const json = JSON.stringify(payload);
  if (json.length > 20000) throw new WorkflowError('Workflow supporting data is too large', 'WORKFLOW_PAYLOAD_TOO_LARGE', 413);
  return json;
}

async function listDefinitions() {
  await ensureWorkflowSchema();
  const [rows] = await pool.query(
    `SELECT d.*, COUNT(s.id) AS step_count
     FROM workflow_definitions d
     LEFT JOIN workflow_steps s ON s.definition_id = d.id
     WHERE d.status = 'ACTIVE'
     GROUP BY d.id ORDER BY d.module, d.name`
  );
  if (!rows.length) return [];
  const [steps] = await pool.query(
    `SELECT s.* FROM workflow_steps s
     JOIN workflow_definitions d ON d.id = s.definition_id
     WHERE d.status = 'ACTIVE' ORDER BY s.definition_id, s.step_order`
  );
  return rows.map((definition) => ({
    ...definition,
    steps: steps.filter((step) => Number(step.definition_id) === Number(definition.id))
  }));
}

async function createDefinition({ user, input, req }) {
  await ensureWorkflowSchema();
  const workflowKey = trim(input.workflow_key, 80).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  const name = trim(input.name, 160);
  const moduleName = trim(input.module, 60).toUpperCase();
  const steps = Array.isArray(input.steps) ? input.steps : [];
  if (!workflowKey || !name || !moduleName || !steps.length || steps.length > 10) {
    throw new WorkflowError('Workflow key, name, module and 1-10 steps are required', 'WORKFLOW_DEFINITION_INVALID');
  }
  const normalizedSteps = steps.map((step, index) => {
    const approverType = trim(step.approver_type, 20).toUpperCase();
    const approvalMode = trim(step.approval_mode || 'ANY', 10).toUpperCase();
    if (!APPROVER_TYPES.has(approverType) || !APPROVAL_MODES.has(approvalMode)) {
      throw new WorkflowError(`Approval rule is invalid at step ${index + 1}`, 'WORKFLOW_STEP_INVALID');
    }
    const approverValue = trim(step.approver_value, 120);
    if (approverType !== 'MANAGER' && !approverValue) {
      throw new WorkflowError(`Approver value is required at step ${index + 1}`, 'WORKFLOW_STEP_INVALID');
    }
    return {
      order: index + 1,
      name: trim(step.name || `Approval step ${index + 1}`, 160),
      approverType,
      approverValue: approverValue || null,
      approvalMode,
      minimumApprovals: Number.isFinite(Number(step.minimum_approvals))
        ? Math.max(1, Math.min(20, Math.trunc(Number(step.minimum_approvals)))) : 1,
      slaHours: Number.isFinite(Number(step.sla_hours))
        ? Math.max(1, Math.min(2160, Math.trunc(Number(step.sla_hours)))) : 24,
      escalationRole: trim(step.escalation_role || 'admin', 80) || null
    };
  });

  const connection = await pool.getConnection();
  const advisoryLock = lockName('workflow_definition', workflowKey);
  let locked = false;
  try {
    const [[result]] = await connection.query('SELECT GET_LOCK(?, 5) AS acquired', [advisoryLock]);
    locked = Number(result?.acquired) === 1;
    if (!locked) throw new WorkflowError('Workflow definition is being changed by another user', 'WORKFLOW_DEFINITION_BUSY', 409);
    await connection.beginTransaction();
    const [[latest]] = await connection.query(
      'SELECT COALESCE(MAX(version), 0) AS version FROM workflow_definitions WHERE workflow_key = ?',
      [workflowKey]
    );
    const version = Number(latest?.version || 0) + 1;
    await connection.query("UPDATE workflow_definitions SET status = 'INACTIVE' WHERE workflow_key = ? AND status = 'ACTIVE'", [workflowKey]);
    const [insert] = await connection.query(
      `INSERT INTO workflow_definitions
       (workflow_key, version, name, module, description, status, allow_self_approval, created_by)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
      [workflowKey, version, name, moduleName, trim(input.description, 4000) || null,
        input.allow_self_approval === true || Number(input.allow_self_approval) === 1 ? 1 : 0, user.id]
    );
    for (const step of normalizedSteps) {
      await connection.query(
        `INSERT INTO workflow_steps
         (definition_id, step_order, name, approver_type, approver_value, approval_mode,
          minimum_approvals, sla_hours, escalation_role)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [insert.insertId, step.order, step.name, step.approverType, step.approverValue,
          step.approvalMode, step.minimumApprovals, step.slaHours, step.escalationRole]
      );
    }
    await logAudit(connection, {
      actorId: user.id, action: 'WORKFLOW_DEFINITION_VERSION_CREATED', module: 'WORKFLOW',
      recordType: 'workflow_definition', recordId: insert.insertId,
      newValue: { workflowKey, version, name, module: moduleName, steps: normalizedSteps.length },
      ...requestContext(req)
    });
    await connection.commit();
    return { id: insert.insertId, workflow_key: workflowKey, version };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    if (locked) await connection.query('SELECT RELEASE_LOCK(?)', [advisoryLock]).catch(() => {});
    connection.release();
  }
}

async function startWorkflow({ user, input, req }) {
  await ensureWorkflowSchema();
  const workflowKey = trim(input.workflow_key, 80).toUpperCase();
  const entityType = trim(input.entity_type, 80);
  const entityId = trim(input.entity_id, 100);
  const title = trim(input.title, 200);
  if (!workflowKey || !entityType || !entityId || !title) {
    throw new WorkflowError('Workflow, record type, record ID and title are required', 'WORKFLOW_REQUEST_INVALID');
  }
  const payloadJson = validatePayload(input.payload);
  const connection = await pool.getConnection();
  const advisoryLock = lockName('workflow_instance', `${workflowKey}:${entityType}:${entityId}`);
  let locked = false;
  try {
    const [[result]] = await connection.query('SELECT GET_LOCK(?, 5) AS acquired', [advisoryLock]);
    locked = Number(result?.acquired) === 1;
    if (!locked) throw new WorkflowError('This record is already being submitted', 'WORKFLOW_REQUEST_BUSY', 409);
    await connection.beginTransaction();
    const definition = await getDefinition(connection, workflowKey, true);
    assertModuleAccess(user, String(definition.module).toUpperCase());
    const [[existing]] = await connection.query(
      `SELECT id, status FROM workflow_instances
       WHERE workflow_key = ? AND entity_type = ? AND entity_id = ?
         AND status IN ('PENDING','BLOCKED_ASSIGNMENT')
       LIMIT 1 FOR UPDATE`,
      [workflowKey, entityType, entityId]
    );
    if (existing) throw new WorkflowError('An active approval request already exists for this record', 'WORKFLOW_DUPLICATE_REQUEST', 409, { instance_id: existing.id });

    const id = crypto.randomUUID();
    const firstStep = definition.steps[0];
    const instance = {
      id,
      requester_id: Number(user.id),
      title,
      module: definition.module,
      current_step_order: Number(firstStep.step_order),
      allow_self_approval: Number(definition.allow_self_approval)
    };
    await connection.query(
      `INSERT INTO workflow_instances
       (id, definition_id, workflow_key, workflow_version, module, entity_type, entity_id,
        title, summary, status, current_step_order, requester_id, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
      [id, definition.id, definition.workflow_key, definition.version, definition.module, entityType,
        entityId, title, trim(input.summary, 4000) || null, firstStep.step_order, user.id, payloadJson]
    );
    const assignment = await createAssignments(connection, instance, firstStep);
    const status = assignment.ready ? 'PENDING' : 'BLOCKED_ASSIGNMENT';
    await connection.query('UPDATE workflow_instances SET status = ?, due_at = ? WHERE id = ?', [status, assignment.dueAt, id]);
    await connection.query(
      `INSERT INTO workflow_actions
       (id, instance_id, step_id, actor_id, action_type, comment, from_status, to_status, metadata_json)
       VALUES (?, ?, ?, ?, 'SUBMIT', ?, NULL, ?, ?)`,
      [crypto.randomUUID(), id, firstStep.id, user.id, trim(input.comment, 4000) || null, status,
        JSON.stringify({ workflow_key: workflowKey, workflow_version: definition.version })]
    );
    if (status === 'BLOCKED_ASSIGNMENT') {
      await notifyBlockedManagers(connection, instance);
    }
    await logAudit(connection, {
      actorId: user.id, action: 'WORKFLOW_SUBMITTED', module: 'WORKFLOW',
      recordType: 'workflow_instance', recordId: id,
      newValue: { workflowKey, module: definition.module, entityType, entityId, status, approverCount: assignment.approvers.length },
      ...requestContext(req)
    });
    await connection.commit();
    return { id, status, assigned_count: assignment.approvers.length };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    if (locked) await connection.query('SELECT RELEASE_LOCK(?)', [advisoryLock]).catch(() => {});
    connection.release();
  }
}

async function listInbox(userId, { status = 'PENDING' } = {}) {
  await ensureWorkflowSchema();
  const statuses = status === 'ALL' ? ['PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'SKIPPED', 'CANCELLED'] : ['PENDING'];
  const placeholders = statuses.map(() => '?').join(',');
  const [items] = await pool.query(
    `SELECT a.id AS assignment_id, a.status AS assignment_status, a.assigned_at, a.due_at,
            i.id, i.title, i.summary, i.module, i.entity_type, i.entity_id, i.status,
            i.requested_at, i.requester_id, d.name AS workflow_name, d.workflow_key,
            s.name AS step_name, s.step_order, u.name AS requester_name, u.email AS requester_email
     FROM workflow_assignments a
     JOIN workflow_instances i ON i.id = a.instance_id
     JOIN workflow_definitions d ON d.id = i.definition_id
     JOIN workflow_steps s ON s.id = a.step_id
     LEFT JOIN users u ON u.id = i.requester_id
     WHERE a.assignee_user_id = ? AND a.status IN (${placeholders})
     ORDER BY CASE WHEN a.due_at IS NULL THEN 1 ELSE 0 END, a.due_at, a.assigned_at DESC LIMIT 200`,
    [userId, ...statuses]
  );
  return items;
}

async function listRequests(userId) {
  await ensureWorkflowSchema();
  const [items] = await pool.query(
    `SELECT i.*, d.name AS workflow_name,
            (SELECT COUNT(*) FROM workflow_assignments a WHERE a.instance_id = i.id AND a.status = 'PENDING') AS pending_assignments
     FROM workflow_instances i JOIN workflow_definitions d ON d.id = i.definition_id
     WHERE i.requester_id = ? ORDER BY i.requested_at DESC LIMIT 200`,
    [userId]
  );
  return items.map((item) => ({ ...item, payload_json: safeJson(item.payload_json) }));
}

async function canViewInstance(db, instanceId, user) {
  if (hasPermission(user, 'MANAGE_WORKFLOWS')) return true;
  const [[visible]] = await db.query(
    `SELECT i.id FROM workflow_instances i
     LEFT JOIN workflow_assignments a ON a.instance_id = i.id AND a.assignee_user_id = ?
     WHERE i.id = ? AND (i.requester_id = ? OR a.id IS NOT NULL) LIMIT 1`,
    [user.id, instanceId, user.id]
  );
  return Boolean(visible);
}

async function getInstance(instanceId, user) {
  await ensureWorkflowSchema();
  if (!await canViewInstance(pool, instanceId, user)) throw new WorkflowError('Approval request was not found', 'WORKFLOW_NOT_FOUND', 404);
  const [[instance]] = await pool.query(
    `SELECT i.*, d.name AS workflow_name, u.name AS requester_name, u.email AS requester_email
     FROM workflow_instances i
     JOIN workflow_definitions d ON d.id = i.definition_id
     LEFT JOIN users u ON u.id = i.requester_id WHERE i.id = ? LIMIT 1`,
    [instanceId]
  );
  if (!instance) throw new WorkflowError('Approval request was not found', 'WORKFLOW_NOT_FOUND', 404);
  const [assignments] = await pool.query(
    `SELECT a.*, u.name AS assignee_name, u.email AS assignee_email, s.name AS step_name, s.step_order
     FROM workflow_assignments a JOIN workflow_steps s ON s.id = a.step_id
     LEFT JOIN users u ON u.id = a.assignee_user_id WHERE a.instance_id = ? ORDER BY s.step_order, a.assigned_at`,
    [instanceId]
  );
  const [actions] = await pool.query(
    `SELECT a.*, u.name AS actor_name FROM workflow_actions a
     LEFT JOIN users u ON u.id = a.actor_id WHERE a.instance_id = ? ORDER BY a.created_at`,
    [instanceId]
  );
  return { ...instance, payload_json: safeJson(instance.payload_json), assignments, actions: actions.map((action) => ({ ...action, metadata_json: safeJson(action.metadata_json) })) };
}

async function actionWorkflow({ instanceId, user, action, comment, req }) {
  const actionType = trim(action, 30).toUpperCase();
  if (!ACTIONS.has(actionType)) throw new WorkflowError('Approval action is invalid', 'WORKFLOW_ACTION_INVALID');
  if (['REJECT', 'REQUEST_CHANGES'].includes(actionType) && !trim(comment, 4000)) {
    throw new WorkflowError('A reason is required for this action', 'WORKFLOW_COMMENT_REQUIRED');
  }
  await ensureWorkflowSchema();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[instance]] = await connection.query('SELECT * FROM workflow_instances WHERE id = ? LIMIT 1 FOR UPDATE', [instanceId]);
    if (!instance) throw new WorkflowError('Approval request was not found', 'WORKFLOW_NOT_FOUND', 404);
    if (!ACTIVE_STATUSES.includes(instance.status)) throw new WorkflowError('This approval request is no longer actionable', 'WORKFLOW_ALREADY_FINAL', 409);
    const [[step]] = await connection.query(
      'SELECT * FROM workflow_steps WHERE definition_id = ? AND step_order = ? LIMIT 1',
      [instance.definition_id, instance.current_step_order]
    );
    const [[assignment]] = await connection.query(
      `SELECT * FROM workflow_assignments
       WHERE instance_id = ? AND step_id = ? AND assignee_user_id = ? LIMIT 1 FOR UPDATE`,
      [instanceId, step.id, user.id]
    );
    if (!assignment || assignment.status !== 'PENDING') {
      throw new WorkflowError('You do not have a pending assignment for this approval', 'WORKFLOW_ASSIGNMENT_NOT_FOUND', 403);
    }
    const [[definition]] = await connection.query('SELECT allow_self_approval FROM workflow_definitions WHERE id = ?', [instance.definition_id]);
    if (!Number(definition?.allow_self_approval) && Number(instance.requester_id) === Number(user.id)) {
      throw new WorkflowError('You cannot approve your own request', 'WORKFLOW_SELF_APPROVAL_DENIED', 403);
    }

    const assignmentStatus = actionType === 'APPROVE' ? 'APPROVED' : actionType === 'REJECT' ? 'REJECTED' : 'CHANGES_REQUESTED';
    await connection.query('UPDATE workflow_assignments SET status = ?, acted_at = NOW() WHERE id = ?', [assignmentStatus, assignment.id]);
    let nextStatus = instance.status;
    let completed = false;
    if (actionType === 'REJECT' || actionType === 'REQUEST_CHANGES') {
      nextStatus = actionType === 'REJECT' ? 'REJECTED' : 'NEEDS_CHANGES';
      completed = true;
      await connection.query("UPDATE workflow_assignments SET status = 'CANCELLED', acted_at = NOW() WHERE instance_id = ? AND status = 'PENDING'", [instanceId]);
      await connection.query('UPDATE workflow_instances SET status = ?, completed_at = NOW(), revision = revision + 1 WHERE id = ?', [nextStatus, instanceId]);
    } else {
      const [[counts]] = await connection.query(
        `SELECT COUNT(*) AS total, SUM(status = 'APPROVED') AS approved
         FROM workflow_assignments WHERE instance_id = ? AND step_id = ?`,
        [instanceId, step.id]
      );
      const required = step.approval_mode === 'ALL' ? Number(counts.total || 0) : Math.max(1, Number(step.minimum_approvals || 1));
      if (Number(counts.approved || 0) >= required) {
        await connection.query("UPDATE workflow_assignments SET status = 'SKIPPED', acted_at = NOW() WHERE instance_id = ? AND step_id = ? AND status = 'PENDING'", [instanceId, step.id]);
        const [[nextStep]] = await connection.query(
          'SELECT * FROM workflow_steps WHERE definition_id = ? AND step_order > ? ORDER BY step_order LIMIT 1',
          [instance.definition_id, instance.current_step_order]
        );
        if (!nextStep) {
          nextStatus = 'APPROVED';
          completed = true;
          await connection.query("UPDATE workflow_instances SET status = 'APPROVED', completed_at = NOW(), due_at = NULL, revision = revision + 1 WHERE id = ?", [instanceId]);
        } else {
          const nextInstance = {
            ...instance,
            title: instance.title,
            current_step_order: nextStep.step_order,
            allow_self_approval: Number(definition?.allow_self_approval)
          };
          const nextAssignment = await createAssignments(connection, nextInstance, nextStep);
          nextStatus = nextAssignment.ready ? 'PENDING' : 'BLOCKED_ASSIGNMENT';
          await connection.query(
            'UPDATE workflow_instances SET status = ?, current_step_order = ?, due_at = ?, revision = revision + 1 WHERE id = ?',
            [nextStatus, nextStep.step_order, nextAssignment.dueAt, instanceId]
          );
          if (nextStatus === 'BLOCKED_ASSIGNMENT') await notifyBlockedManagers(connection, nextInstance);
        }
      }
    }
    await connection.query(
      `INSERT INTO workflow_actions
       (id, instance_id, step_id, actor_id, action_type, comment, from_status, to_status, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), instanceId, step.id, user.id, actionType, trim(comment, 4000) || null,
        instance.status, nextStatus, JSON.stringify({ assignment_id: assignment.id, completed })]
    );
    const [[requester]] = await connection.query('SELECT id, role FROM users WHERE id = ? LIMIT 1', [instance.requester_id]);
    if (requester) {
      await notify(connection, requester, {
        type: `workflow_${actionType.toLowerCase()}`,
        title: actionType === 'APPROVE' ? (completed ? 'Request approved' : 'Approval progressed') : actionType === 'REJECT' ? 'Request rejected' : 'Changes requested',
        message: `${instance.title}: ${actionType.replace('_', ' ').toLowerCase()} by ${user.name || user.email || 'reviewer'}.`,
        priority: actionType === 'APPROVE' ? 'NORMAL' : 'HIGH', instanceId
      });
    }
    await logAudit(connection, {
      actorId: user.id, action: `WORKFLOW_${actionType}`, module: 'WORKFLOW',
      recordType: 'workflow_instance', recordId: instanceId,
      oldValue: { status: instance.status, step: instance.current_step_order },
      newValue: { status: nextStatus, action: actionType, assignmentId: assignment.id },
      ...requestContext(req)
    });
    await connection.commit();
    return { id: instanceId, status: nextStatus, completed };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function cancelWorkflow({ instanceId, user, comment, req }) {
  await ensureWorkflowSchema();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[instance]] = await connection.query('SELECT * FROM workflow_instances WHERE id = ? LIMIT 1 FOR UPDATE', [instanceId]);
    if (!instance) throw new WorkflowError('Approval request was not found', 'WORKFLOW_NOT_FOUND', 404);
    if (Number(instance.requester_id) !== Number(user.id) && !hasPermission(user, 'MANAGE_WORKFLOWS')) {
      throw new WorkflowError('Only the requester or workflow administrator can cancel this request', 'WORKFLOW_CANCEL_DENIED', 403);
    }
    if (!ACTIVE_STATUSES.includes(instance.status) && instance.status !== 'NEEDS_CHANGES') {
      throw new WorkflowError('This approval request cannot be cancelled', 'WORKFLOW_ALREADY_FINAL', 409);
    }
    await connection.query("UPDATE workflow_instances SET status = 'CANCELLED', cancelled_at = NOW(), completed_at = NOW(), due_at = NULL, revision = revision + 1 WHERE id = ?", [instanceId]);
    await connection.query("UPDATE workflow_assignments SET status = 'CANCELLED', acted_at = NOW() WHERE instance_id = ? AND status = 'PENDING'", [instanceId]);
    await connection.query(
      `INSERT INTO workflow_actions
       (id, instance_id, step_id, actor_id, action_type, comment, from_status, to_status)
       VALUES (?, ?, NULL, ?, 'CANCEL', ?, ?, 'CANCELLED')`,
      [crypto.randomUUID(), instanceId, user.id, trim(comment, 4000) || null, instance.status]
    );
    await logAudit(connection, {
      actorId: user.id, action: 'WORKFLOW_CANCELLED', module: 'WORKFLOW', recordType: 'workflow_instance', recordId: instanceId,
      oldValue: { status: instance.status }, newValue: { status: 'CANCELLED' }, ...requestContext(req)
    });
    await connection.commit();
    return { id: instanceId, status: 'CANCELLED' };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function reassignWorkflow({ instanceId, assigneeUserId, user, comment, req }) {
  await ensureWorkflowSchema();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[instance]] = await connection.query('SELECT * FROM workflow_instances WHERE id = ? LIMIT 1 FOR UPDATE', [instanceId]);
    if (!instance || !ACTIVE_STATUSES.includes(instance.status)) throw new WorkflowError('Active approval request was not found', 'WORKFLOW_NOT_FOUND', 404);
    const [[assignee]] = await connection.query('SELECT id, role, permissions, active, deleted_at FROM users WHERE id = ? LIMIT 1 FOR UPDATE', [assigneeUserId]);
    if (!assignee || !Number(assignee.active) || assignee.deleted_at) throw new WorkflowError('The selected reviewer is not active', 'WORKFLOW_ASSIGNEE_INVALID');
    if (!hasPermission(assignee, 'ACTION_APPROVALS')) throw new WorkflowError('The selected user cannot action approvals', 'WORKFLOW_ASSIGNEE_NOT_AUTHORIZED', 409);
    const [[definition]] = await connection.query('SELECT allow_self_approval FROM workflow_definitions WHERE id = ? LIMIT 1', [instance.definition_id]);
    if (!Number(definition?.allow_self_approval) && Number(instance.requester_id) === Number(assignee.id)) {
      throw new WorkflowError('The requester cannot be assigned to approve their own request', 'WORKFLOW_SELF_APPROVAL_DENIED', 409);
    }
    const [[step]] = await connection.query('SELECT * FROM workflow_steps WHERE definition_id = ? AND step_order = ? LIMIT 1', [instance.definition_id, instance.current_step_order]);
    if (instance.status !== 'BLOCKED_ASSIGNMENT') {
      await connection.query("UPDATE workflow_assignments SET status = 'CANCELLED', acted_at = NOW() WHERE instance_id = ? AND step_id = ? AND status = 'PENDING'", [instanceId, step.id]);
    }
    const assignmentId = crypto.randomUUID();
    const dueAt = new Date(Date.now() + Math.max(1, Number(step.sla_hours || 24)) * 60 * 60 * 1000);
    await connection.query(
      `INSERT INTO workflow_assignments (id, instance_id, step_id, assignee_user_id, status, due_at)
       VALUES (?, ?, ?, ?, 'PENDING', ?)
       ON DUPLICATE KEY UPDATE status = 'PENDING', assigned_at = NOW(), acted_at = NULL, due_at = VALUES(due_at)`,
      [assignmentId, instanceId, step.id, assignee.id, dueAt]
    );
    const [[assignmentCount]] = await connection.query(
      `SELECT COUNT(*) AS total FROM workflow_assignments
       WHERE instance_id = ? AND step_id = ? AND status IN ('PENDING','APPROVED')`,
      [instanceId, step.id]
    );
    const ready = step.approval_mode === 'ALL'
      ? Number(assignmentCount.total || 0) > 0
      : Number(assignmentCount.total || 0) >= Math.max(1, Number(step.minimum_approvals || 1));
    const nextStatus = ready ? 'PENDING' : 'BLOCKED_ASSIGNMENT';
    await connection.query('UPDATE workflow_instances SET status = ?, due_at = ?, revision = revision + 1 WHERE id = ?', [nextStatus, dueAt, instanceId]);
    await connection.query(
      `INSERT INTO workflow_actions
       (id, instance_id, step_id, actor_id, action_type, comment, from_status, to_status, metadata_json)
       VALUES (?, ?, ?, ?, 'REASSIGN', ?, ?, ?, ?)`,
      [crypto.randomUUID(), instanceId, step.id, user.id, trim(comment, 4000) || null, instance.status, nextStatus,
        JSON.stringify({ assignee_user_id: assignee.id })]
    );
    await notify(connection, assignee, {
      type: 'workflow_reassigned', title: 'Approval assigned to you', message: `${instance.title} is waiting for your review.`,
      priority: 'HIGH', instanceId
    });
    await logAudit(connection, {
      actorId: user.id, action: 'WORKFLOW_REASSIGNED', module: 'WORKFLOW', recordType: 'workflow_instance', recordId: instanceId,
      oldValue: { status: instance.status }, newValue: { status: nextStatus, assigneeUserId: Number(assignee.id) }, ...requestContext(req)
    });
    await connection.commit();
    return { id: instanceId, status: nextStatus, assignee_user_id: Number(assignee.id) };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  MODULE_SUBMIT_PERMISSIONS,
  WorkflowError,
  actionWorkflow,
  cancelWorkflow,
  createDefinition,
  getInstance,
  listDefinitions,
  listInbox,
  listRequests,
  reassignWorkflow,
  resolveApprovers,
  startWorkflow
};
