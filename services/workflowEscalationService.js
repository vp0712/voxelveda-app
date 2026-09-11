const crypto = require('crypto');
const pool = require('../config/db');
const { hasPermission } = require('./authorizationService');
const { logAudit } = require('./auditService');
const { createNotification } = require('./notificationService');
const { ensureWorkflowSchema } = require('./workflowSchema');
const { backgroundJobService } = require('./backgroundJobService');

async function loadCandidateUsers(db) {
  const [users] = await db.query(
    `SELECT id, name, email, role, permissions, manager_id
     FROM users WHERE active = 1 AND deleted_at IS NULL`
  );
  return users;
}

function actionUrl(user) {
  return `${['admin', 'super_admin'].includes(String(user?.role || '').toLowerCase()) ? '/admin' : '/dashboard'}?view=approvals`;
}

async function notifyUser(db, user, title, message, instanceId, priority = 'HIGH') {
  await createNotification(db, {
    userId: user.id,
    type: 'workflow_sla',
    category: 'TASKS',
    title,
    message,
    priority,
    linkedModule: 'WORKFLOW',
    linkedRecordId: instanceId,
    actionUrl: actionUrl(user)
  });
}

async function processAssignment(row, eventType) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[current]] = await connection.query(
      `SELECT a.*, i.title, i.requester_id, i.status AS instance_status, s.escalation_role
       FROM workflow_assignments a
       JOIN workflow_instances i ON i.id = a.instance_id
       JOIN workflow_steps s ON s.id = a.step_id
       WHERE a.id = ? LIMIT 1 FOR UPDATE`,
      [row.assignment_id]
    );
    if (!current || current.status !== 'PENDING' || current.instance_status !== 'PENDING') {
      await connection.rollback();
      return false;
    }
    const [eventInsert] = await connection.query(
      `INSERT IGNORE INTO workflow_sla_events
       (id, instance_id, step_id, assignment_id, event_type, due_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), current.instance_id, current.step_id, current.id, eventType, current.due_at,
        JSON.stringify({ source: 'workflow_sla_scheduler' })]
    );
    if (!eventInsert.affectedRows) {
      await connection.rollback();
      return false;
    }
    const [[assignee]] = await connection.query('SELECT id, role FROM users WHERE id = ? LIMIT 1', [current.assignee_user_id]);
    if (assignee) {
      await notifyUser(
        connection,
        assignee,
        eventType === 'DUE_SOON' ? 'Approval due soon' : 'Approval overdue',
        `${current.title} ${eventType === 'DUE_SOON' ? 'is due soon' : 'has passed its review deadline'}.`,
        current.instance_id,
        eventType === 'DUE_SOON' ? 'HIGH' : 'CRITICAL'
      );
    }
    if (eventType === 'BREACHED') {
      const users = await loadCandidateUsers(connection);
      let escalationUsers = users.filter((user) => String(user.role || '').toLowerCase() === String(current.escalation_role || '').toLowerCase());
      if (!escalationUsers.length) escalationUsers = users.filter((user) => hasPermission(user, 'MANAGE_WORKFLOWS'));
      escalationUsers = escalationUsers.filter((user) => Number(user.id) !== Number(current.requester_id) && Number(user.id) !== Number(current.assignee_user_id));
      if (!escalationUsers.length) {
        const requester = users.find((user) => Number(user.id) === Number(current.requester_id));
        if (requester) {
          await notifyUser(connection, requester, 'Approval escalation needs attention', `${current.title} is overdue and no escalation reviewer is available.`, current.instance_id, 'CRITICAL');
        }
      }
      for (const candidate of escalationUsers) {
        const escalationId = crypto.randomUUID();
        await connection.query(
          `INSERT IGNORE INTO workflow_assignments
           (id, instance_id, step_id, assignee_user_id, status, due_at)
           VALUES (?, ?, ?, ?, 'PENDING', DATE_ADD(NOW(), INTERVAL 8 HOUR))`,
          [crypto.randomUUID(), current.instance_id, current.step_id, candidate.id]
        );
        await connection.query(
          `INSERT IGNORE INTO workflow_escalations
           (id, instance_id, step_id, assignment_id, escalation_level, from_user_id, to_user_id, reason)
           VALUES (?, ?, ?, ?, 1, ?, ?, 'Approval SLA breached')`,
          [escalationId, current.instance_id, current.step_id, current.id, current.assignee_user_id, candidate.id]
        );
        await notifyUser(connection, candidate, 'Overdue approval escalated', `${current.title} needs urgent review.`, current.instance_id, 'CRITICAL');
      }
      await connection.query(
        `INSERT IGNORE INTO workflow_sla_events
         (id, instance_id, step_id, assignment_id, event_type, due_at, metadata_json)
         VALUES (?, ?, ?, ?, 'ESCALATED', ?, ?)`,
        [crypto.randomUUID(), current.instance_id, current.step_id, current.id, current.due_at,
          JSON.stringify({ recipients: escalationUsers.map((user) => Number(user.id)) })]
      );
    }
    await logAudit(connection, {
      actorId: null,
      action: `WORKFLOW_SLA_${eventType}`,
      module: 'WORKFLOW',
      recordType: 'WORKFLOW_ASSIGNMENT',
      recordId: current.id,
      newValue: {
        instanceId: current.instance_id,
        stepId: current.step_id,
        dueAt: current.due_at,
        source: 'workflow_sla_scheduler'
      },
      metadata: { automated: true }
    });
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function processWorkflowSla() {
  await ensureWorkflowSchema();
  const [rows] = await pool.query(
    `SELECT a.id AS assignment_id, a.due_at
     FROM workflow_assignments a
     JOIN workflow_instances i ON i.id = a.instance_id
     WHERE a.status = 'PENDING' AND i.status = 'PENDING'
       AND a.due_at IS NOT NULL AND a.due_at <= DATE_ADD(NOW(), INTERVAL 2 HOUR)
     ORDER BY a.due_at LIMIT 100`
  );
  let processed = 0;
  for (const row of rows) {
    const eventType = new Date(row.due_at).getTime() <= Date.now() ? 'BREACHED' : 'DUE_SOON';
    if (await processAssignment(row, eventType)) processed += 1;
  }
  return { processed, skipped: false };
}

const scheduler = backgroundJobService.createScheduler({
  jobKey: 'workflow_sla_escalation',
  description: 'Notify and escalate overdue approval assignments',
  handler: processWorkflowSla,
  intervalMs: () => Math.max(60000, Number(process.env.WORKFLOW_SLA_INTERVAL_MS || 300000)),
  initialDelayMs: 10000,
  leaseMs: Number(process.env.WORKFLOW_SLA_LEASE_MS || 5 * 60 * 1000)
});

function runWorkflowSlaScheduler(options = {}) {
  return scheduler.run(options);
}

function startWorkflowSlaScheduler() {
  return scheduler.start();
}

function stopWorkflowSlaScheduler() {
  scheduler.stop();
}

module.exports = { processWorkflowSla, runWorkflowSlaScheduler, startWorkflowSlaScheduler, stopWorkflowSlaScheduler };
