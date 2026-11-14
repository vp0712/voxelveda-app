'use strict';
// Automatic finalization is a source snapshot, never a manager approval or a
// payroll posting. All writers serialize on the existing employee row.
const { DateTime } = require('luxon');
const pool = require('../config/db');
const policy = require('./weeklyTimesheetEligibility');
const verified = require('./attendanceVerifiedSummaryService');
const { hasPermission, canAccessUserRecord } = require('./authorizationService');
const { logAudit, logActivity } = require('./auditService');
const { dateOnly } = require('../utils/dateOnly');
const FINALIZATION_POLICY = 'AUTOMATIC_WEEK_FINAL_V1';
const LOCKED = new Set(['APPROVED', 'PAYROLL_PROCESSED', 'LOCKED']);
function fail(message, code, statusCode = 409) { return Object.assign(new Error(message), { code, statusCode }); }
function periodFor(weekStart, weekEnd, timezone = policy.configuration().timezone) {
  weekStart = dateOnly(weekStart); weekEnd = dateOnly(weekEnd);
  const start = DateTime.fromISO(String(weekStart), { zone: timezone }).startOf('day');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(weekStart)) || !start.isValid || start.weekday !== 1 || start.plus({ days: 6 }).toISODate() !== String(weekEnd)) throw fail('Choose one Monday–Sunday reporting week.', 'TIMESHEET_WEEK_INVALID', 422);
  return { start: start.toISODate(), end: start.plus({ days: 6 }).toISODate(), timezone,
    startUtc: start.toUTC().toISO(), endExclusiveUtc: start.plus({ weeks: 1 }).toUTC().toISO() };
}
function completed(period, now = new Date()) { return DateTime.fromJSDate(now).toMillis() >= DateTime.fromISO(period.endExclusiveUtc).toMillis(); }
function sourceHash(staffId, assessment, period) {
  return policy.snapshotHash({ policy: FINALIZATION_POLICY, staff_id: Number(staffId), period_start: period.start,
    period_end: period.end, timezone: period.timezone, total_minutes: assessment.totalMinutes, rows: assessment.rows });
}
function summaryFor(staff, records, period, now) {
  const summary = verified.assessVerifiedAttendance({ staff, records, fromDate: period.start, toDate: period.end, now });
  const standard = Number(process.env.STANDARD_WEEKLY_HOURS || 38);
  return { records, eligibleRecords: summary.eligibleRecords, actualHours: summary.actualHours,
    ordinaryHours: Math.round(Math.min(summary.actualHours, standard) * 100) / 100,
    overtimeHours: Math.round(Math.max(0, summary.actualHours - standard) * 100) / 100,
    reviewRequired: summary.reviewRequired, reviewIssues: summary.reviewIssues, ...verified.diagnostics(summary) };
}
function present(timesheet, assessment, period, now, extra = {}) {
  const status = String(timesheet.status || 'DRAFT').toUpperCase();
  return { ...timesheet, approval_required: false, lifecycle_status: status,
    recorded_hours: Math.round(assessment.totalMinutes / 60 * 100) / 100, recorded_minutes: assessment.totalMinutes,
    final_hours: status === 'FINAL' ? Math.round(assessment.totalMinutes / 60 * 100) / 100 : null,
    final_minutes: status === 'FINAL' ? assessment.totalMinutes : null,
    reporting_complete: completed(period, now), source_review_required: assessment.status === 'REVIEW_REQUIRED',
    company_timezone: period.timezone, ...extra };
}
async function verifyFinalization(db, review, assessment, period, now = new Date()) {
  const version = Number(review.version_no || 0);
  if (String(review.status).toUpperCase() !== 'FINAL') return { verified: false, status: review.status || 'IN_PROGRESS', version };
  let valid = completed(period, now) && assessment.status === 'ELIGIBLE' && assessment.totalMinutes > 0 && Number.isSafeInteger(version) && version > 0;
  let proof;
  if (valid) {
    const [[record]] = await db.query("SELECT snapshot_json,created_by,reason FROM timesheet_versions WHERE timesheet_id=? AND version_no=? AND status='FINAL' LIMIT 1", [review.id, version]);
    try {
      proof = JSON.parse(record?.snapshot_json).automatic_finalization;
      const at = DateTime.fromISO(String(proof.finalized_at));
      valid = proof.policy === FINALIZATION_POLICY && Number(review.user_id) > 0 && proof.staff_id === Number(review.user_id) &&
        proof.period_start === period.start && proof.period_end === period.end && proof.timezone === period.timezone &&
        proof.total_minutes === assessment.totalMinutes && proof.source_sha256 === sourceHash(proof.staff_id, assessment, period) &&
        policy.snapshotHash(proof.rows) === policy.snapshotHash(assessment.rows) && at.isValid &&
        at.toMillis() >= DateTime.fromISO(period.endExclusiveUtc).toMillis() && at.toMillis() <= now.getTime() &&
        Math.abs(Number(review.total_hours) - Math.round(assessment.totalMinutes / 60 * 100) / 100) < 0.00001;
    } catch { valid = false; }
  }
  return { verified: Boolean(valid), status: valid ? 'FINAL' : 'REVIEW_REQUIRED', version,
    ...(valid ? { policy: FINALIZATION_POLICY, finalizedAt: proof.finalized_at, totalMinutes: assessment.totalMinutes } : {}) };
}
async function syncWeek({ db, userId, weekStart, weekEnd, now = new Date(), actorId = null, reason = null, sourceEdited = false, allowFrozenRevision = false }) {
  const config = policy.configuration(), period = periodFor(weekStart, weekEnd, config.timezone);
  if (DateTime.fromISO(period.startUtc).toMillis() > now.getTime()) throw fail('A future timesheet cannot be finalized.', 'TIMESHEET_WEEK_FUTURE', 422);
  const [[staff]] = await db.query('SELECT id,name,role,active,account_status,deleted_at,employee_number,email FROM users WHERE id=? FOR UPDATE', [userId]);
  if (!staff) throw fail('Staff member not found.', 'TIMESHEET_STAFF_NOT_FOUND', 404);
  const records = await require('./weeklyTimesheetScheduler').loadWorkedAttendance(db, Number(userId), period, true);
  const assessment = policy.assessWorkedAttendance(staff, records, period, config, now), summary = summaryFor(staff, records, period, now);
  let [[timesheet]] = await db.query('SELECT * FROM weekly_timesheets WHERE user_id=? AND week_start=? AND week_end=? FOR UPDATE', [userId, period.start, period.end]);
  const hours = Math.round(assessment.totalMinutes / 60 * 100) / 100;
  let status = !completed(period, now) ? 'IN_PROGRESS' : assessment.status === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : assessment.totalMinutes > 0 && assessment.status === 'ELIGIBLE' ? 'FINAL' : 'NO_WORK';
  if (timesheet && assessment.status === 'INELIGIBLE_ACCOUNT') {
    if (sourceEdited) throw fail('This employee account is inactive. Its historical timesheet was preserved.', 'TIMESHEET_ACCOUNT_INELIGIBLE');
    return { timesheet: { ...timesheet, approval_required: false, lifecycle_status: timesheet.status,
      account_ineligible: true, recorded_hours: null, recorded_minutes: null, reporting_complete: completed(period, now),
      historical_saved_hours: Number(timesheet.total_hours), company_timezone: period.timezone },
    summary: { ...summary, actualHours: null, verified_total_hours: null, verified_total_minutes: null,
      reviewRequired: true, reviewIssues: [{ code: 'INELIGIBLE_ACCOUNT' }], review_required: true,
      review_issues: [{ code: 'INELIGIBLE_ACCOUNT' }], historical_saved_hours: Number(timesheet.total_hours) }, assessment };
  }
  if (!timesheet && (assessment.status === 'NO_WORK' || assessment.status === 'INELIGIBLE_ACCOUNT')) return { timesheet: present({ id: null, user_id: Number(userId), week_start: period.start, week_end: period.end, status, total_hours: hours, version_no: 0 }, assessment, period, now), summary, assessment };
  if (!timesheet) {
    const [created] = await db.query('INSERT INTO weekly_timesheets(user_id,week_start,week_end,total_hours,status) VALUES(?,?,?,?,?)', [userId, period.start, period.end, hours, status]);
    timesheet = { id: created.insertId, user_id: Number(userId), week_start: period.start, week_end: period.end, total_hours: hours, status, version_no: 0 };
  }
  if (!Number.isSafeInteger(Number(timesheet.version_no || 0)) || Number(timesheet.version_no || 0) < 0) throw fail('The saved timesheet version requires administrator review.', 'TIMESHEET_VERSION_INVALID');
  const [[payroll]] = await db.query('SELECT status,locked_at,processed_at,exported_at FROM payroll_ready WHERE timesheet_id=? FOR UPDATE', [timesheet.id]);
  const locked = LOCKED.has(String(timesheet.status).toUpperCase()) || ['PROCESSED', 'LOCKED', 'EXPORTED'].includes(String(payroll?.status || timesheet.payroll_status).toUpperCase()) || payroll?.locked_at || payroll?.processed_at || payroll?.exported_at;
  if (locked) {
    if (sourceEdited) throw fail('This historical period is approved or payroll locked. Use its separately authorized amendment process.', 'ATTENDANCE_PERIOD_LOCKED');
    return { timesheet: present(timesheet, assessment, period, now, { historical_locked: true }), summary, assessment };
  }
  const [[delivery]] = await db.query('SELECT id,status,snapshot_json,source_sha256,email_queue_id FROM weekly_timesheet_deliveries WHERE user_id=? AND period_start=? AND period_end=? FOR UPDATE', [userId, period.start, period.end]);
  let legacyQueue = null;
  if (!delivery?.snapshot_json) {
    [[legacyQueue]] = await db.query("SELECT id,status FROM email_queue WHERE related_module='timesheets' AND related_record_id=? AND idempotency_key LIKE 'weekly-timesheet:%' LIMIT 1 FOR UPDATE", [String(timesheet.id)]);
  }
  // A deployed policy change must not alter an already frozen/accepted/uncertain
  // report, its source hash, or its original recipient. Corrections are explicit.
  const frozenLegacy = delivery?.snapshot_json && !['FINAL', 'IN_PROGRESS', 'REVIEW_REQUIRED', 'NO_WORK'].includes(String(timesheet.status).toUpperCase());
  if ((frozenLegacy || legacyQueue) && !sourceEdited && !allowFrozenRevision) return { timesheet: present(timesheet, assessment, period, now, { delivery_snapshot_preserved: true }), summary, assessment };
  const hash = sourceHash(userId, assessment, period);
  const [[latest]] = Number(timesheet.version_no) > 0 ? await db.query('SELECT snapshot_json FROM timesheet_versions WHERE timesheet_id=? AND version_no=? LIMIT 1', [timesheet.id, timesheet.version_no]) : [[]];
  let previous;
  try { previous = JSON.parse(latest?.snapshot_json).automatic_timesheet; } catch { previous = null; }
  if (!sourceEdited && timesheet.status === status && previous?.source_sha256 === hash) {
    const established = status !== 'FINAL' || (await verifyFinalization(db, timesheet, assessment, period, now)).verified;
    if (established) return { timesheet: present(timesheet, assessment, period, now, { finalization_policy: status === 'FINAL' ? FINALIZATION_POLICY : null }), summary, assessment };
  }
  const version = Number(timesheet.version_no || 0) + 1;
  const proof = { policy: FINALIZATION_POLICY, staff_id: Number(userId), period_start: period.start, period_end: period.end,
    timezone: period.timezone, source_sha256: hash, total_minutes: assessment.totalMinutes, rows: assessment.rows,
    finalized_at: status === 'FINAL' ? now.toISOString() : null };
  const snapshot = { automatic_timesheet: proof, ...(status === 'FINAL' ? { automatic_finalization: proof } : {}),
    attendance: assessment.rows, source_attendance: records, verification: verified.diagnostics(verified.assessVerifiedAttendance({ staff, records, fromDate: period.start, toDate: period.end, now })),
    calculated: { actual_hours: hours, ordinary_hours: summary.ordinaryHours, overtime_hours: summary.overtimeHours } };
  await db.query('INSERT INTO timesheet_versions(timesheet_id,version_no,status,snapshot_json,reason,created_by) VALUES(?,?,?,?,?,?)', [timesheet.id, version, status, JSON.stringify(snapshot), reason, actorId]);
  await db.query('UPDATE weekly_timesheets SET status=?,total_hours=?,ordinary_hours=?,overtime_hours=?,version_no=? WHERE id=?', [status, hours, summary.ordinaryHours, summary.overtimeHours, version, timesheet.id]);
  const action = sourceEdited ? 'SOURCE_EDITED' : status === 'FINAL' ? 'AUTO_FINALIZED' : 'SOURCE_REFRESHED';
  await db.query('INSERT INTO timesheet_approvals(timesheet_id,action,from_status,to_status,comments,acted_by) VALUES(?,?,?,?,?,?)', [timesheet.id, action, timesheet.status, status, reason, actorId]);
  await logAudit(db, { actorId, action: `TIMESHEET_${action}`, module: 'timesheets', recordType: 'weekly_timesheet', recordId: timesheet.id,
    oldValue: { status: timesheet.status, total_hours: timesheet.total_hours, version_no: Number(timesheet.version_no || 0) },
    newValue: { status, total_hours: hours, version_no: version, source_sha256: hash, policy: FINALIZATION_POLICY, ...(reason ? { reason } : {}) } });
  await logActivity(db, { module: 'timesheets', recordId: timesheet.id, eventType: action, actorId,
    message: sourceEdited ? 'Authorised source attendance correction saved.' : status === 'FINAL' ? 'Completed verified week finalized automatically; no approval required.' : 'Timesheet refreshed from recorded attendance.', metadata: { version_no: version, source_sha256: hash } });
  timesheet = { ...timesheet, status, total_hours: hours, ordinary_hours: summary.ordinaryHours, overtime_hours: summary.overtimeHours, version_no: version };
  return { timesheet: present(timesheet, assessment, period, now, { finalization_policy: status === 'FINAL' ? FINALIZATION_POLICY : null,
    ...(sourceEdited && (delivery?.snapshot_json || legacyQueue) ? { delivery_revision_required: true } : {}) }), summary, assessment };
}
async function syncWeekTransaction(options) {
  await require('./workforceSchema').ensureWorkforceSchema();
  await require('./weeklyTimesheetDeliverySchema').ensureWeeklyTimesheetDeliverySchema();
  const db = await pool.getConnection();
  try { await db.beginTransaction(); const result = await syncWeek({ ...options, db }); await db.commit(); return result; }
  catch (error) { await db.rollback(); throw error; } finally { db.release(); }
}
async function discoverWeeks({ user, now = new Date(), completedOnly = false } = {}) {
  await require('./workforceSchema').ensureWorkforceSchema();
  await require('./weeklyTimesheetDeliverySchema').ensureWeeklyTimesheetDeliverySchema();
  const config = policy.configuration(), last = policy.latestCompletedWeek(now, config.timezone);
  const currentStart = DateTime.fromJSDate(now, { zone: config.timezone }).startOf('week');
  const periods = completedOnly ? [last] : [last, periodFor(currentStart.toISODate(), currentStart.plus({ days: 6 }).toISODate(), config.timezone)];
  const scopes = [], params = [];
  if (user) {
    if (hasPermission(user, 'VIEW_ALL_TIMESHEETS')) scopes.push('1=1');
    else {
      if (hasPermission(user, 'VIEW_OWN_TIMESHEET')) { scopes.push('u.id=?'); params.push(user.id); }
      if (hasPermission(user, 'VIEW_TEAM_TIMESHEET')) { scopes.push('u.manager_id=? AND u.id<>?'); params.push(user.id, user.id); }
    }
    if (!scopes.length) throw fail('Timesheet access is not enabled.', 'TIMESHEET_ACCESS_DENIED', 403);
  } else scopes.push('1=1');
  const outcomes = [];
  for (const period of periods) {
    const marginStart = DateTime.fromISO(period.startUtc).minus({ hours: 14 }).toUTC().toFormat('yyyy-MM-dd HH:mm:ss');
    const marginEnd = DateTime.fromISO(period.endExclusiveUtc).plus({ hours: 14 }).toUTC().toFormat('yyyy-MM-dd HH:mm:ss');
    // Keyset pages cover every matching employee without silently capping the
    // register or blocking all delivery at an arbitrary total staff count.
    let afterId = 0;
    while (true) {
      const [candidates] = await pool.query(`SELECT DISTINCT u.id FROM users u JOIN staff_attendance a ON a.user_id=u.id WHERE u.active=1 AND u.deleted_at IS NULL AND (${scopes.map(s => `(${s})`).join(' OR ')}) AND IFNULL(a.deleted,0)=0 AND ((a.clock_in>=? AND a.clock_in<?) OR (a.work_date BETWEEN ? AND ?)) AND u.id>? ORDER BY u.id LIMIT 200`, [...params, marginStart, marginEnd, period.start, period.end, afterId]);
      if (!candidates.length) break;
      for (const candidate of candidates) {
      // Recheck current authority before any scoped read-triggered refresh.
      if (user && !await canAccessUserRecord(user, candidate.id, { own: 'VIEW_OWN_TIMESHEET', team: 'VIEW_TEAM_TIMESHEET', all: 'VIEW_ALL_TIMESHEETS' })) continue;
      try {
        const result = await syncWeekTransaction({ userId: candidate.id, weekStart: period.start, weekEnd: period.end, now });
        outcomes.push({ staff_id: candidate.id, period_start: period.start, status: result.timesheet.lifecycle_status, version: result.timesheet.version_no });
      } catch (error) {
        const code = String(error.code || 'TIMESHEET_FINALIZATION_FAILED').slice(0, 100);
        outcomes.push({ staff_id: candidate.id, period_start: period.start, status: 'FINALIZATION_FAILED', code });
        console.warn('Timesheet finalization blocked', JSON.stringify({ staff_id: candidate.id, period_start: period.start, code }));
      }
    }
      const nextId = Number(candidates[candidates.length - 1].id);
      if (!Number.isSafeInteger(nextId) || nextId <= afterId) throw fail('The automatic finalization cursor requires review.', 'TIMESHEET_BATCH_CURSOR_INVALID', 503);
      afterId = nextId;
      if (candidates.length < 200) break;
    }
  }
  return { periods: periods.map(p => ({ start: p.start, end: p.end, timezone: p.timezone })), outcomes };
}
module.exports = { FINALIZATION_POLICY, periodFor, completed, sourceHash, verifyFinalization, syncWeek, syncWeekTransaction,
  syncVisibleWeeks: (user, options = {}) => discoverWeeks({ ...options, user }),
  finalizeLatestCompletedWeek: (options = {}) => discoverWeeks({ ...options, completedOnly: true }) };
