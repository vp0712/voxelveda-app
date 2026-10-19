const pool = require('../config/db');
const { ensureWorkforceSchema } = require('./workforceSchema');
const { ensureWeeklyTimesheetDeliverySchema } = require('./weeklyTimesheetDeliverySchema');
const verifiedAttendance = require('./attendanceVerifiedSummaryService');
const { logAudit, logActivity } = require('./auditService');
const { createNotification } = require('./notificationService');
const { renderEmailTemplate } = require('./emailTemplates');
const { queueEmail } = require('./emailQueue');
const { canAccessUserRecord, hasAnyPermission, hasPermission, isManagerOf } = require('./authorizationService');

const APPROVAL_READY = new Set(['PENDING_APPROVAL', 'CORRECTION_RESUBMITTED']);

class WorkflowError extends Error {
  constructor(message, statusCode = 400, code = 'WORKFLOW_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function normalizeStatus(value) {
  const status = String(value || 'DRAFT').trim().toUpperCase();
  if (status === 'OPEN') return 'PENDING_APPROVAL';
  return status;
}

function canApprove(user) {
  return hasAnyPermission(user, ['APPROVE_TEAM_TIMESHEET', 'APPROVE_ALL_TIMESHEETS']);
}

async function canViewTimesheet(user, timesheet, connection = pool) {
  return canAccessUserRecord(user, timesheet.user_id, {
    own: 'VIEW_OWN_TIMESHEET',
    team: 'VIEW_TEAM_TIMESHEET',
    all: 'VIEW_ALL_TIMESHEETS',
    connection
  });
}

async function canApproveTimesheet(user, timesheet, connection = pool) {
  if (hasPermission(user, 'APPROVE_ALL_TIMESHEETS')) return true;
  return hasPermission(user, 'APPROVE_TEAM_TIMESHEET') && isManagerOf(user?.id, timesheet.user_id, connection);
}

function requestMeta(req) {
  return {
    ipAddress: String(req?.ip || req?.headers?.['x-forwarded-for'] || '').slice(0, 80) || null,
    userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 1000) || null
  };
}

async function calculateTimesheet(db, timesheet) {
  const verified=await verifiedAttendance.loadVerifiedSummary({db,userId:timesheet.user_id,fromDate:timesheet.week_start,toDate:timesheet.week_end,lock:db!==pool});
  const records=verified.records;
  const actualHours = verified.actualHours;
  const standardHours = Number(process.env.STANDARD_WEEKLY_HOURS || 38);
  return {
    records,
    actualHours,
    ...verifiedAttendance.diagnostics(verified),
    reviewRequired:verified.reviewRequired,reviewIssues:verified.reviewIssues,eligibleRecords:verified.eligibleRecords,
    ordinaryHours: Number(Math.min(actualHours, standardHours).toFixed(2)),
    overtimeHours: Number(Math.max(0, actualHours - standardHours).toFixed(2))
  };
}

async function getLockedTimesheet(connection, id) {
  const [[identity]] = await connection.query('SELECT user_id FROM weekly_timesheets WHERE id=?', [id]);
  if (!identity) throw new WorkflowError('Timesheet not found.', 404, 'TIMESHEET_NOT_FOUND');
  await connection.query('SELECT id FROM users WHERE id=? FOR UPDATE', [identity.user_id]);
  const [[timesheet]] = await connection.query(
    `
    SELECT wt.*, u.name AS staff_name, u.email AS staff_email
    FROM weekly_timesheets wt
    LEFT JOIN users u ON u.id = wt.user_id
    WHERE wt.id = ?
    LIMIT 1 FOR UPDATE
    `,
    [id]
  );
  if (!timesheet) throw new WorkflowError('Timesheet not found.', 404, 'TIMESHEET_NOT_FOUND');
  if (Number(timesheet.user_id) !== Number(identity.user_id)) throw new WorkflowError('The staff identity changed. Refresh before retrying.', 409, 'TIMESHEET_IDENTITY_CHANGED');
  timesheet.status = normalizeStatus(timesheet.status);
  return timesheet;
}

async function createVersion(connection, timesheet, summary, status, actorId, reason) {
  const versionNo = Number(timesheet.version_no || 0) + 1;
  const snapshot = {
    timesheet: {
      id: timesheet.id,
      user_id: timesheet.user_id,
      week_start: timesheet.week_start,
      week_end: timesheet.week_end,
      submitted_total_hours: Number(timesheet.total_hours || 0),
      previous_status: timesheet.status
    },
    calculated: {
      actual_hours: summary.actualHours,
      ordinary_hours: summary.ordinaryHours,
      overtime_hours: summary.overtimeHours
    },
    attendance: summary.eligibleRecords,
    source_attendance: summary.records,
    verification: {total_minutes:summary.verified_total_minutes,total_hours:summary.verified_total_hours,historical_saved_hours:summary.historical_saved_hours,review_issues:summary.reviewIssues,duplicates:summary.duplicate_records}
  };

  await connection.query(
    `
    INSERT INTO timesheet_versions
    (timesheet_id, version_no, status, snapshot_json, reason, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
    `,
    [timesheet.id, versionNo, status, JSON.stringify(snapshot), reason || null, actorId || null]
  );
  return versionNo;
}

async function recordTransition(connection, timesheet, action, toStatus, actorId, comments) {
  await connection.query(
    `
    INSERT INTO timesheet_approvals
    (timesheet_id, action, from_status, to_status, comments, acted_by)
    VALUES (?, ?, ?, ?, ?, ?)
    `,
    [timesheet.id, action, timesheet.status, toStatus, comments || null, actorId || null]
  );
}

async function notifyAdmins(connection,timesheet,title,message,priority='normal') {
  const [[event]]=await connection.query('SELECT version_no,status FROM weekly_timesheets WHERE id=? LIMIT 1',[timesheet.id]);
  if(!event || !Number.isSafeInteger(Number(event.version_no)) || Number(event.version_no)<1)throw new Error('The submitted timesheet version is unavailable.');
  const [recipients]=await connection.query(`SELECT id FROM users WHERE active=1 AND deleted_at IS NULL AND (LOWER(role) IN ('admin','super_admin','hr') OR id=(SELECT manager_id FROM users WHERE id=? LIMIT 1))`,[timesheet.user_id]);
  for(const recipient of recipients)await createNotification(connection,{
    userId:recipient.id,type:'TIMESHEET',category:'HR',title,message,priority,linkedModule:'timesheets',linkedRecordId:timesheet.id,actionUrl:'/admin?view=timesheets',
    dedupeKey:`timesheet-submitted:${timesheet.id}:version:${Number(event.version_no)}:status:${event.status}`
  });
}

async function listTimesheets({ user, status = 'ALL', userId, fromDate, toDate } = {}) {
  await ensureWorkforceSchema();
  await ensureWeeklyTimesheetDeliverySchema();
  const params = [];
  const filters = [];
  const normalizedStatus = normalizeStatus(status);
  if (normalizedStatus !== 'ALL') {
    filters.push("CASE WHEN UPPER(wt.status) = 'OPEN' THEN 'PENDING_APPROVAL' ELSE UPPER(wt.status) END = ?");
    params.push(normalizedStatus);
  }
  if (hasPermission(user, 'VIEW_ALL_TIMESHEETS')) {
    if (userId) {
      filters.push('wt.user_id = ?');
      params.push(Number(userId));
    }
  } else if (hasPermission(user, 'VIEW_TEAM_TIMESHEET')) {
    filters.push('u.manager_id = ?');
    params.push(Number(user.id));
    if (userId) {
      filters.push('wt.user_id = ?');
      params.push(Number(userId));
    }
  } else if (hasPermission(user, 'VIEW_OWN_TIMESHEET')) {
    filters.push('wt.user_id = ?');
    params.push(Number(user.id));
  } else {
    throw new WorkflowError('Timesheet access is not enabled for your account.', 403, 'TIMESHEET_ACCESS_DENIED');
  }
  if (fromDate) {
    filters.push('wt.week_end >= ?');
    params.push(String(fromDate).slice(0, 10));
  }
  if (toDate) {
    filters.push('wt.week_start <= ?');
    params.push(String(toDate).slice(0, 10));
  }

  const [rows] = await pool.query(
    `
    SELECT
      wt.*, u.name, u.email, approver.name AS approved_by_name,
      pr.status AS payroll_ready_status, pr.gross_estimated_cost
    FROM weekly_timesheets wt
    LEFT JOIN users u ON u.id = wt.user_id
    LEFT JOIN users approver ON approver.id = wt.approved_by
    LEFT JOIN payroll_ready pr ON pr.timesheet_id = wt.id
    ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
    ORDER BY wt.week_start ASC, u.name ASC
    `,
    params
  );
  return rows.map((row) => ({ ...row, status: normalizeStatus(row.status) }));
}

async function getTimesheetDetail(id, user) {
  await ensureWorkforceSchema();
  await ensureWeeklyTimesheetDeliverySchema();
  const [[timesheet]] = await pool.query(
    `
    SELECT wt.*, u.name, u.email, approver.name AS approved_by_name
    FROM weekly_timesheets wt
    LEFT JOIN users u ON u.id = wt.user_id
    LEFT JOIN users approver ON approver.id = wt.approved_by
    WHERE wt.id = ? LIMIT 1
    `,
    [id]
  );
  if (!timesheet) throw new WorkflowError('Timesheet not found.', 404, 'TIMESHEET_NOT_FOUND');
  if (!await canViewTimesheet(user, timesheet)) {
    throw new WorkflowError('You do not have access to this timesheet.', 403, 'TIMESHEET_ACCESS_DENIED');
  }
  const summary = await calculateTimesheet(pool, timesheet);
  const [versions] = await pool.query(
    'SELECT id, version_no, status, reason, created_by, created_at FROM timesheet_versions WHERE timesheet_id = ? ORDER BY version_no ASC',
    [id]
  );
  const [approvals] = await pool.query(
    `
    SELECT ta.*, u.name AS actor_name
    FROM timesheet_approvals ta
    LEFT JOIN users u ON u.id = ta.acted_by
    WHERE ta.timesheet_id = ? ORDER BY ta.acted_at ASC
    `,
    [id]
  );
  return { timesheet: { ...timesheet, status: normalizeStatus(timesheet.status) }, summary, versions, approvals };
}

async function submitTimesheet(id, user, req) {
  await ensureWorkforceSchema();
  await ensureWeeklyTimesheetDeliverySchema();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const timesheet = await getLockedTimesheet(connection, id);
    if (Number(timesheet.user_id) !== Number(user?.id) || !hasPermission(user, 'VIEW_OWN_TIMESHEET')) {
      throw new WorkflowError('You can only submit your own timesheet.', 403, 'TIMESHEET_ACCESS_DENIED');
    }
    if (!['DRAFT', 'CORRECTION_REQUIRED'].includes(timesheet.status)) {
      throw new WorkflowError('This timesheet has already been submitted.', 409, 'TIMESHEET_ALREADY_SUBMITTED');
    }
    const toStatus = timesheet.status === 'CORRECTION_REQUIRED' ? 'CORRECTION_RESUBMITTED' : 'PENDING_APPROVAL';
    const summary = await calculateTimesheet(connection, timesheet);
    verifiedAttendance.assertReviewResolved(summary);
    const versionNo = await createVersion(connection, timesheet, summary, toStatus, user.id, null);
    await connection.query(
      `
      UPDATE weekly_timesheets
      SET total_hours = ?, ordinary_hours = ?, overtime_hours = ?, status = ?, submitted_at = NOW(),
          manager_comments = NULL, version_no = ?, payroll_status = 'NOT_READY'
      WHERE id = ?
      `,
      [summary.actualHours, summary.ordinaryHours, summary.overtimeHours, toStatus, versionNo, id]
    );
    await recordTransition(connection, timesheet, 'SUBMITTED', toStatus, user.id, null);
    await logAudit(connection, {
      actorId: user.id, action: 'TIMESHEET_SUBMITTED', module: 'timesheets', recordType: 'weekly_timesheet', recordId: id,
      oldValue: { status: timesheet.status }, newValue: { status: toStatus, total_hours: summary.actualHours }, ...requestMeta(req)
    });
    await logActivity(connection, {
      module: 'timesheets', recordId: id, eventType: 'SUBMITTED', message: 'Timesheet submitted for approval.', actorId: user.id
    });
    await notifyAdmins(connection, timesheet, 'Timesheet awaiting approval', `${timesheet.staff_name || 'Staff'} submitted ${timesheet.week_start} to ${timesheet.week_end}.`, 'high');
    await connection.commit();
    return { id, status: toStatus, total_hours: summary.actualHours, version_no: versionNo };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function assertDecisionVersion(timesheet,options){
  if(!options.requireVersion&&options.expectedVersion===undefined)return;
  if(!Number.isSafeInteger(Number(options.expectedVersion))||options.expectedVersion===undefined)throw new WorkflowError('Refresh the timesheet before deciding. Its current version is required.',422,'TIMESHEET_VERSION_REQUIRED');
  if(Number(options.expectedVersion)!==Number(timesheet.version_no||0))throw new WorkflowError('This timesheet changed after it was opened. Refresh and review the current version.',409,'TIMESHEET_VERSION_CONFLICT');
}

async function approveTimesheet(id, user, options = {}, req) {
  await ensureWorkforceSchema();
  await ensureWeeklyTimesheetDeliverySchema();
  const connection = await pool.getConnection();
  let emailPayload;
  try {
    await connection.beginTransaction();
    const timesheet = await getLockedTimesheet(connection, id);
    if (!await canApproveTimesheet(user, timesheet, connection)) {
      throw new WorkflowError('You cannot approve a timesheet outside your authorised scope.', 403, 'TIMESHEET_APPROVAL_DENIED');
    }
    if (timesheet.status === 'APPROVED') {
      throw new WorkflowError('Timesheet has already been approved.', 409, 'TIMESHEET_ALREADY_APPROVED');
    }
    if (!APPROVAL_READY.has(timesheet.status)) {
      throw new WorkflowError('Only submitted timesheets can be approved.', 409, 'TIMESHEET_NOT_READY');
    }

    assertDecisionVersion(timesheet,options);
    const calculated = await calculateTimesheet(connection, timesheet);
    verifiedAttendance.assertReviewResolved(calculated);
    const approvedHours = options.approvedHours === undefined
      ? calculated.actualHours
      : Number(options.approvedHours);
    if (!Number.isFinite(approvedHours) || approvedHours < 0 || approvedHours > 168) {
      throw new WorkflowError('Approved hours must be between 0 and 168.', 400, 'APPROVED_HOURS_INVALID');
    }
    if(options.requireVersion&&(!Number.isSafeInteger(Number(options.expectedSourceMinutes))||options.expectedSourceMinutes===undefined))throw new WorkflowError('Refresh the authoritative source hours before approving.',422,'TIMESHEET_SOURCE_REQUIRED');
    if(options.expectedSourceMinutes!==undefined&&Number(options.expectedSourceMinutes)!==Number(calculated.verified_total_minutes))throw new WorkflowError('Attendance changed after this review was opened. Refresh the source hours.',409,'TIMESHEET_SOURCE_CONFLICT');
    if(Math.abs(approvedHours-calculated.actualHours)>0.00001&&!String(options.reason||options.comments||'').trim())throw new WorkflowError('Explain why approved hours differ from the verified source hours.',422,'TIMESHEET_ADJUSTMENT_REASON_REQUIRED');
    const standardHours = Number(process.env.STANDARD_WEEKLY_HOURS || 38);
    const summary = {
      ...calculated,
      ordinaryHours: Number(Math.min(approvedHours, standardHours).toFixed(2)),
      overtimeHours: Number(Math.max(0, approvedHours - standardHours).toFixed(2))
    };
    const versionNo = await createVersion(connection, timesheet, summary, 'APPROVED', user.id, options.reason||options.comments);
    await recordTransition(connection, timesheet, 'APPROVED', 'APPROVED', user.id, options.comments);

    await connection.query(
      `
      UPDATE weekly_timesheets
      SET status = 'APPROVED', approved_hours = ?, ordinary_hours = ?, overtime_hours = ?, total_hours = ?,
          approved_by = ?, approved_at = NOW(), version_no = ?, payroll_status = 'READY', manager_comments = ?,
          rejected_by = NULL, rejected_at = NULL, correction_requested_by = NULL, correction_requested_at = NULL
      WHERE id = ?
      `,
      [approvedHours, summary.ordinaryHours, summary.overtimeHours, summary.actualHours, user.id, versionNo, options.comments || null, id]
    );

    await connection.query(
      `
      INSERT INTO payroll_ready
      (timesheet_id, user_id, period_start, period_end, ordinary_hours, overtime_hours, approved_hours, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'READY')
      ON DUPLICATE KEY UPDATE ordinary_hours = VALUES(ordinary_hours), overtime_hours = VALUES(overtime_hours),
        approved_hours = VALUES(approved_hours), status = 'READY', updated_at = NOW()
      `,
      [id, timesheet.user_id, timesheet.week_start, timesheet.week_end, summary.ordinaryHours, summary.overtimeHours, approvedHours]
    );

    const managerName = user.username || user.email || 'Manager';
    await logAudit(connection, {
      actorId: user.id, action: 'TIMESHEET_APPROVED', module: 'timesheets', recordType: 'weekly_timesheet', recordId: id,
      oldValue: { status: timesheet.status, total_hours: timesheet.total_hours },
      newValue: { status: 'APPROVED', approved_hours: approvedHours, version_no: versionNo, payroll_status: 'READY' },
      ...requestMeta(req)
    });
    await logActivity(connection, {
      module: 'timesheets', recordId: id, eventType: 'APPROVED', message: `Approved ${approvedHours.toFixed(2)} hours.`, actorId: user.id,
      metadata: { ordinary_hours: summary.ordinaryHours, overtime_hours: summary.overtimeHours, version_no: versionNo }
    });
    await createNotification(connection, {
      userId: timesheet.user_id, type: 'TIMESHEET_APPROVED', title: 'Timesheet approved',
      message: `Your timesheet for ${timesheet.week_start} to ${timesheet.week_end} was approved for ${approvedHours.toFixed(2)} hours.`,
      category: 'HR', priority: 'normal', linkedModule: 'timesheets', linkedRecordId: id, actionUrl: '/dashboard?view=timesheets',
      dedupeKey: `timesheet:${id}:version:${versionNo}:status:APPROVED`
    });
    await connection.commit();

    if (timesheet.staff_email && String(process.env.TIMESHEET_APPROVAL_EMAIL_ENABLED || '').toLowerCase() === 'true') {
      const rendered = renderEmailTemplate('timesheet_approved', {
        staff_name: timesheet.staff_name || 'Team member', week_start: String(timesheet.week_start).slice(0, 10),
        week_end: String(timesheet.week_end).slice(0, 10), approved_hours: approvedHours.toFixed(2),
        manager_name: managerName, approved_at: new Date().toLocaleString('en-AU')
      });
      emailPayload = { to: timesheet.staff_email, ...rendered, relatedModule: 'timesheets', relatedRecordId: id, createdBy: user.id,
        idempotencyKey: `timesheet-approved-${id}-v${versionNo}` };
    }
    if (emailPayload) await queueEmail(emailPayload).catch((error) => console.error('TIMESHEET APPROVAL EMAIL QUEUE ERROR:', error.message));
    return { id, status: 'APPROVED', approved_hours: approvedHours, ordinary_hours: summary.ordinaryHours, overtime_hours: summary.overtimeHours, version_no: versionNo, payroll_status: 'READY' };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function reviewTimesheet(id, user, action, comments, req, options = {}) {
  const cleanAction = String(action || '').toUpperCase();
  const toStatus = cleanAction === 'REJECT' ? 'REJECTED' : cleanAction === 'REQUEST_CORRECTION' ? 'CORRECTION_REQUIRED' : '';
  if (!toStatus) throw new WorkflowError('A valid review action is required.');
  if (!String(comments || '').trim()) throw new WorkflowError('Manager comments are required for this action.');

  await ensureWorkforceSchema();
  await ensureWeeklyTimesheetDeliverySchema();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const timesheet = await getLockedTimesheet(connection, id);
    if (!await canApproveTimesheet(user, timesheet, connection)) {
      throw new WorkflowError('You cannot review a timesheet outside your authorised scope.', 403, 'TIMESHEET_REVIEW_DENIED');
    }
    if (!APPROVAL_READY.has(timesheet.status)) {
      throw new WorkflowError('Only submitted timesheets can be reviewed.', 409, 'TIMESHEET_NOT_READY');
    }
    assertDecisionVersion(timesheet,options);
    const summary = await calculateTimesheet(connection, timesheet);
    const versionNo = await createVersion(connection, timesheet, summary, toStatus, user.id, comments);
    await recordTransition(connection, timesheet, cleanAction, toStatus, user.id, comments);
    const columnSql = toStatus === 'REJECTED'
      ? 'rejected_by = ?, rejected_at = NOW()'
      : 'correction_requested_by = ?, correction_requested_at = NOW()';
    await connection.query(
      `UPDATE weekly_timesheets SET status = ?, manager_comments = ?, version_no = ?, payroll_status = 'NOT_READY', ${columnSql} WHERE id = ?`,
      [toStatus, comments, versionNo, user.id, id]
    );
    await connection.query(`UPDATE payroll_ready SET status = 'NOT_READY' WHERE timesheet_id = ?`, [id]);
    await logAudit(connection, {
      actorId: user.id, action: `TIMESHEET_${toStatus}`, module: 'timesheets', recordType: 'weekly_timesheet', recordId: id,
      oldValue: { status: timesheet.status }, newValue: { status: toStatus, comments }, ...requestMeta(req)
    });
    await logActivity(connection, {
      module: 'timesheets', recordId: id, eventType: toStatus, message: comments, actorId: user.id
    });
    await createNotification(connection, {
      userId: timesheet.user_id, type: `TIMESHEET_${toStatus}`, title: toStatus === 'REJECTED' ? 'Timesheet rejected' : 'Timesheet correction required',
      message: comments, category: 'HR', priority: 'high', linkedModule: 'timesheets', linkedRecordId: id, actionUrl: '/dashboard?view=timesheets',
      dedupeKey: `timesheet:${id}:version:${versionNo}:status:${toStatus}:comment:${comments}`
    });
    await connection.commit();

    if (timesheet.staff_email && String(process.env.TIMESHEET_REVIEW_EMAIL_ENABLED || '').toLowerCase() === 'true') {
      const key = toStatus === 'REJECTED' ? 'timesheet_rejected' : 'timesheet_correction';
      const rendered = renderEmailTemplate(key, {
        staff_name: timesheet.staff_name || 'Team member', week_start: String(timesheet.week_start).slice(0, 10),
        week_end: String(timesheet.week_end).slice(0, 10), manager_comments: comments
      });
      await queueEmail({ to: timesheet.staff_email, ...rendered, relatedModule: 'timesheets', relatedRecordId: id, createdBy: user.id,
        idempotencyKey: `timesheet-${toStatus.toLowerCase()}-${id}-v${versionNo}` }).catch((error) => console.error('TIMESHEET REVIEW EMAIL QUEUE ERROR:', error.message));
    }
    return { id, status: toStatus, version_no: versionNo };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function amendApprovedTimesheet(id, user, options, req) {
  const reason = String(options.reason || '').trim();
  const approvedHours = Number(options.approvedHours);
  if (!reason) throw new WorkflowError('An amendment reason is required.');
  if (!Number.isFinite(approvedHours) || approvedHours < 0 || approvedHours > 168) throw new WorkflowError('Approved hours must be between 0 and 168.');

  await ensureWorkforceSchema();
  await ensureWeeklyTimesheetDeliverySchema();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const timesheet = await getLockedTimesheet(connection, id);
    if (!await canApproveTimesheet(user, timesheet, connection)) {
      throw new WorkflowError('You cannot amend a timesheet outside your authorised scope.', 403, 'TIMESHEET_AMEND_DENIED');
    }
    if (timesheet.status !== 'APPROVED') throw new WorkflowError('Only approved timesheets can be amended.', 409, 'TIMESHEET_NOT_APPROVED');
    assertDecisionVersion(timesheet,options);
    const calculated = await calculateTimesheet(connection, timesheet);
    verifiedAttendance.assertReviewResolved(calculated);
    const standardHours = Number(process.env.STANDARD_WEEKLY_HOURS || 38);
    const summary = { ...calculated, ordinaryHours: Math.min(approvedHours, standardHours), overtimeHours: Math.max(0, approvedHours - standardHours) };
    const versionNo = await createVersion(connection, timesheet, summary, 'APPROVED', user.id, reason);
    await recordTransition(connection, timesheet, 'AMENDED', 'APPROVED', user.id, reason);
    await connection.query(
      `UPDATE weekly_timesheets SET approved_hours = ?, ordinary_hours = ?, overtime_hours = ?, total_hours = ?, approved_by = ?, approved_at = NOW(), version_no = ?, manager_comments = ? WHERE id = ?`,
      [approvedHours, summary.ordinaryHours, summary.overtimeHours, summary.actualHours, user.id, versionNo, reason, id]
    );
    await connection.query(
      `UPDATE payroll_ready SET approved_hours = ?, ordinary_hours = ?, overtime_hours = ?, status = 'READY', updated_at = NOW() WHERE timesheet_id = ?`,
      [approvedHours, summary.ordinaryHours, summary.overtimeHours, id]
    );
    await logAudit(connection, {
      actorId: user.id, action: 'TIMESHEET_AMENDED', module: 'timesheets', recordType: 'weekly_timesheet', recordId: id,
      oldValue: { approved_hours: timesheet.approved_hours, version_no: timesheet.version_no },
      newValue: { approved_hours: approvedHours, version_no: versionNo, reason }, ...requestMeta(req)
    });
    await logActivity(connection, { module: 'timesheets', recordId: id, eventType: 'AMENDED', message: reason, actorId: user.id, metadata: { approved_hours: approvedHours, version_no: versionNo } });
    await connection.commit();
    return { id, status: 'APPROVED', approved_hours: approvedHours, version_no: versionNo };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function listPayrollReady() {
  await ensureWorkforceSchema();
  await ensureWeeklyTimesheetDeliverySchema();
  const [rows] = await pool.query(
    `
    SELECT pr.*, u.name, u.email, wt.version_no, wt.approved_at, approver.name AS approved_by_name
    FROM payroll_ready pr
    LEFT JOIN users u ON u.id = pr.user_id
    LEFT JOIN weekly_timesheets wt ON wt.id = pr.timesheet_id
    LEFT JOIN users approver ON approver.id = wt.approved_by
    ORDER BY pr.period_start ASC, u.name ASC
    `
  );
  return rows;
}

function canViewPayroll(user) {
  return hasPermission(user, 'VIEW_PAYROLL');
}

module.exports = {
  WorkflowError,
  canApprove,
  canViewPayroll,
  normalizeStatus,
  listTimesheets,
  getTimesheetDetail,
  submitTimesheet,
  approveTimesheet,
  reviewTimesheet,
  amendApprovedTimesheet,
  listPayrollReady
};
