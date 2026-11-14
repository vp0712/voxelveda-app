'use strict';
const pool = require('../config/db');
const { DateTime } = require('luxon');
const { ensureWorkforceSchema } = require('./workforceSchema');
const { ensureWeeklyTimesheetDeliverySchema } = require('./weeklyTimesheetDeliverySchema');
const { canAccessUserRecord, canEditTimesheetRecord } = require('./authorizationService');
const verifiedAttendance = require('./attendanceVerifiedSummaryService');
const attendanceTime = require('./attendanceTimeService');
const attendancePolicy = require('./attendanceMobilePolicy');
const corrections = require('./attendanceCorrectionService');
const eligibility = require('./weeklyTimesheetEligibility');
const { dateOnly } = require('../utils/dateOnly');
const { logAudit, logActivity } = require('./auditService');

function fail(message, code, statusCode = 422, fields) {
  return Object.assign(new Error(message), { code, statusCode, ...(fields ? { fields } : {}) });
}
async function canView(user, timesheet, db = pool) {
  return canAccessUserRecord(user, timesheet.user_id, { own: 'VIEW_OWN_TIMESHEET', team: 'VIEW_TEAM_TIMESHEET', all: 'VIEW_ALL_TIMESHEETS', connection: db });
}
async function canEdit(user, timesheet, db = pool) {
  if (timesheet.account_ineligible) return false;
  if (Object.hasOwn(timesheet, 'staff_active') && !eligibility.activeEmployee({ id: timesheet.user_id,
    role: timesheet.staff_role, active: timesheet.staff_active, account_status: timesheet.staff_account_status,
    deleted_at: timesheet.staff_deleted_at, employee_number: timesheet.staff_employee_number })) return false;
  return await canView(user, timesheet, db) && await canEditTimesheetRecord(user, timesheet.user_id, db);
}
async function assertReceiptSchema(db) {
  // The ordered migration owns creation. Request handlers only assert its contract.
  try {
    await db.query('SELECT timesheet_id,request_id,payload_sha256,response_json,created_by,version_no FROM timesheet_edit_receipts WHERE 1=0');
    const [indexes] = await db.query('SHOW INDEX FROM timesheet_edit_receipts WHERE Key_name=\'PRIMARY\'');
    const primary = indexes.sort((a, b) => Number(a.Seq_in_index) - Number(b.Seq_in_index)).map(row => row.Column_name);
    if (primary.join(',') !== 'timesheet_id,request_id') throw new Error('Unexpected receipt identity');
  } catch {
    throw fail('Timesheet editing is unavailable until the current database migration is applied. Please contact an administrator.', 'TIMESHEET_EDIT_SCHEMA_REQUIRED', 503);
  }
}
function integer(value, field, minimum = 0) {
  if (value === '' || value === null || value === undefined || !Number.isSafeInteger(Number(value)) || Number(value) < minimum) {
    throw fail('Refresh this timesheet before saving a correction.', 'TIMESHEET_EDIT_VERSION_REQUIRED', 422, { [field]: 'Use the current saved version' });
  }
  return Number(value);
}
function periodFor(timesheet, timezone) {
  const start = dateOnly(timesheet.week_start), end = dateOnly(timesheet.week_end);
  const local = DateTime.fromISO(start || '', { zone: timezone });
  if (!local.isValid || local.weekday !== 1 || local.plus({ days: 6 }).toISODate() !== end) throw fail('This record does not have a valid reporting week.', 'TIMESHEET_PERIOD_INVALID', 409);
  return { start, end, timezone };
}
function allocatedDate(row, timezone) {
  if (row.timestamp_basis === 'UTC') {
    const instant = eligibility.utcInstant(row.clock_in_utc_text ?? row.clock_in, 'UTC');
    if (instant) return instant.setZone(timezone).toISODate();
  }
  return dateOnly(row.work_date);
}
function summaryMinutes(summary) { return Number(summary.verified_total_minutes ?? summary.totalMinutes ?? 0); }

async function editTimesheet({ id, user, input = {}, req, now = new Date() }) {
  const timesheetId = attendancePolicy.positiveId(id, 'timesheet_id');
  const attendanceId = attendancePolicy.positiveId(input.attendance_id);
  const requestId = attendancePolicy.requestId(input.request_id);
  const expectedVersion = integer(input.expected_version, 'expected_version');
  const expectedSourceMinutes = integer(input.expected_source_minutes, 'expected_source_minutes');
  const expectedRevision = integer(input.expected_revision, 'expected_revision', 1);
  const reason = attendancePolicy.text(input.reason, 'reason', 1000, true);
  if (reason.length < 3) throw fail('Explain the source-time correction for the audit history.', 'TIMESHEET_EDIT_REASON_REQUIRED', 422, { reason: 'Enter at least three characters' });
  const notes = Object.hasOwn(input, 'notes') ? attendancePolicy.text(input.notes, 'notes', 10000) : undefined;
  const parsed = attendanceTime.manualWorkedEntry(input, user?.id, now);
  if (!parsed.clock_out) throw fail('Enter the actual completed checkout. An open or unknown shift must remain under review.', 'TIMESHEET_EDIT_CHECKOUT_REQUIRED', 422, { clock_out: 'Enter the actual checkout time' });
  const hash = attendancePolicy.hash({ timesheet_id: timesheetId, attendance_id: attendanceId, actor_id: Number(user?.id), expected_version: expectedVersion,
    expected_source_minutes: expectedSourceMinutes, expected_revision: expectedRevision, clock_in: parsed.clock_in, clock_out: parsed.clock_out,
    break_minutes: Object.hasOwn(input, 'break_minutes') ? parsed.break_minutes : 'PRESERVE', notes: notes === undefined ? 'PRESERVE' : notes, reason });
  await ensureWorkforceSchema();
  await ensureWeeklyTimesheetDeliverySchema();
  const [[identity]] = await pool.query('SELECT wt.id,wt.user_id,wt.week_start,wt.week_end,u.active AS staff_active,u.role AS staff_role,u.account_status AS staff_account_status,u.deleted_at AS staff_deleted_at,u.employee_number AS staff_employee_number FROM weekly_timesheets wt JOIN users u ON u.id=wt.user_id WHERE wt.id=?', [timesheetId]);
  if (!identity || !await canEdit(user, identity)) throw fail('This timesheet is unavailable within your editing authority.', 'TIMESHEET_EDIT_DENIED', 403);
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[account]] = await db.query('SELECT id,role,active,account_status,deleted_at,employee_number FROM users WHERE id=? FOR UPDATE', [identity.user_id]);
    const [[sheet]] = await db.query('SELECT * FROM weekly_timesheets WHERE id=? FOR UPDATE', [timesheetId]);
    if (!sheet || Number(sheet.user_id) !== Number(identity.user_id) || !account || !eligibility.activeEmployee(account) ||
      !await canEdit(user, sheet, db)) throw fail('Your access, employee account or this timesheet changed. Refresh before retrying.', 'TIMESHEET_EDIT_DENIED', 403);
    await assertReceiptSchema(db);
    const [[receipt]] = await db.query('SELECT payload_sha256,response_json,created_by FROM timesheet_edit_receipts WHERE timesheet_id=? AND request_id=?', [timesheetId, requestId]);
    if (receipt) {
      if (receipt.payload_sha256 !== hash || Number(receipt.created_by) !== Number(user.id)) throw fail('This request ID was already used for different correction values.', 'TIMESHEET_EDIT_IDEMPOTENCY_CONFLICT', 409);
      let response;
      try { response = JSON.parse(receipt.response_json); } catch { throw fail('The saved edit result is unavailable. Do not submit a new correction; contact an administrator.', 'TIMESHEET_EDIT_RECEIPT_INVALID', 503); }
      if (response?.outcome !== 'COMMITTED' || response.request_id !== requestId || Number(response.timesheet?.id) !== timesheetId ||
        Number(response.timesheet?.user_id) !== Number(sheet.user_id) || Number(response.attendance?.id) !== attendanceId) {
        throw fail('The saved edit receipt does not match this correction. Contact an administrator before retrying.', 'TIMESHEET_EDIT_RECEIPT_INVALID', 503);
      }
      await db.commit();
      return { ...response, existing: true };
    }
    if (Number(sheet.version_no || 0) !== expectedVersion) throw fail('This timesheet changed after it was opened. Refresh before saving.', 'TIMESHEET_VERSION_CONFLICT', 409);
    const timezone = eligibility.configuration().timezone;
    const period = periodFor(sheet, timezone);
    const [[before]] = await db.query(`SELECT ${attendancePolicy.SELECT} FROM staff_attendance a WHERE a.id=? AND a.user_id=? AND IFNULL(a.deleted,0)=0 FOR UPDATE`, [attendanceId, sheet.user_id]);
    if (!before) throw fail('This shift is unavailable within the selected employee timesheet.', 'TIMESHEET_SHIFT_NOT_FOUND', 404);
    if (['PLANNED', 'SCHEDULED', 'CANCELLED', 'CANCELED', 'REJECTED', 'DUPLICATE', 'DELETED', 'VOID', 'VOIDED'].includes(String(before.attendance_status || before.status || '').toUpperCase())) {
      throw fail('This is an excluded or unworked entry. Use the authorised attendance management workflow rather than turning it into worked time through a timesheet edit.', 'TIMESHEET_SHIFT_NOT_EDITABLE', 409);
    }
    attendancePolicy.revision(expectedRevision, before.revision);
    const originalDate = allocatedDate(before, timezone);
    if (!originalDate || originalDate < period.start || originalDate > period.end || parsed.work_date < period.start || parsed.work_date > period.end) {
      throw fail('A correction must stay within this employee’s selected reporting week. Use the authorised attendance correction workflow for a different period.', 'TIMESHEET_SHIFT_OUTSIDE_PERIOD', 409);
    }
    const summaryBefore = await verifiedAttendance.loadVerifiedSummary({ db, userId: sheet.user_id, fromDate: period.start, toDate: period.end, lock: true, now });
    if (summaryMinutes(summaryBefore) !== expectedSourceMinutes) throw fail('Attendance changed after this timesheet was opened. Refresh the source records.', 'TIMESHEET_SOURCE_CONFLICT', 409);
    await corrections.assertMutablePeriod(db, sheet.user_id, [originalDate, parsed.work_date]);
    const breaks = await corrections.effectiveBreaks(db, attendanceId);
    if (breaks.some(interval => !interval.ended_at)) throw fail('End the active break or use a supervised attendance correction request before changing this session.', 'ATTENDANCE_BREAK_PENDING', 409);
    const entry = Object.hasOwn(input, 'break_minutes') ? parsed : attendanceTime.manualWorkedEntry({ ...input, break_minutes: before.break_minutes }, user.id, now);
    const [overlaps] = await db.query('SELECT id FROM staff_attendance WHERE user_id=? AND IFNULL(deleted,0)=0 AND id<>? AND clock_in<? AND (clock_out IS NULL OR clock_out>?) FOR UPDATE', [sheet.user_id, attendanceId, entry.clock_out, entry.clock_in]);
    if (overlaps.length) throw fail('The corrected interval overlaps another retained session. Review both records before saving.', 'ATTENDANCE_CORRECTION_OVERLAP', 409);
    const fields = ['clock_in', 'clock_out', 'work_date', 'total_minutes', 'total_hours', 'break_minutes', 'entry_source', 'timestamp_basis', 'clock_out_timestamp_basis', 'recorded_timezone', 'manual_authorised_by', 'manual_authorised_at', 'attendance_status', 'review_required', 'review_reason'];
    await corrections.supersedeBreaks(db, { attendanceId, actorId: user.id, attendanceRevision: Number(before.revision) + 1, now });
    const savedNotes = notes === undefined ? before.notes ?? null : notes;
    const [updated] = await db.query(`UPDATE staff_attendance SET ${fields.map(field => field + '=?').join(',')},notes=?,break_tracking_base_minutes=NULL,revision=revision+1 WHERE id=? AND user_id=? AND revision=? AND IFNULL(deleted,0)=0`, [...fields.map(field => entry[field]), savedNotes, attendanceId, sheet.user_id, expectedRevision]);
    if (Number(updated.affectedRows) !== 1) throw fail('This shift changed before it could be saved. Refresh before retrying.', 'ATTENDANCE_REVISION_CONFLICT', 409);
    const [[after]] = await db.query(`SELECT ${attendancePolicy.SELECT} FROM staff_attendance a WHERE a.id=? AND a.user_id=?`, [attendanceId, sheet.user_id]);
    await logAudit(db, { actorId: user.id, action: 'TIMESHEET_SOURCE_SHIFT_EDITED', module: 'timesheets', recordType: 'staff_attendance', recordId: attendanceId,
      oldValue: { ...attendancePolicy.publicAttendance(before), break_intervals: breaks },
      newValue: { attendance: attendancePolicy.publicAttendance(after), timesheet_id: timesheetId, reason, superseded_break_ids: breaks.map(row => row.id) },
      requestId, ipAddress: req?.ip || null, userAgent: req?.get?.('user-agent') || req?.headers?.['user-agent'] || null });
    const synchronized = await require('./timesheetFinalizationService').syncWeek({ db, userId: sheet.user_id, weekStart: period.start, weekEnd: period.end, now, actorId: user.id, reason, sourceEdited: true });
    if (Number(synchronized.timesheet?.id) !== timesheetId || Number(synchronized.timesheet?.user_id) !== Number(sheet.user_id) ||
      !Number.isSafeInteger(Number(synchronized.timesheet?.version_no)) || Number(synchronized.timesheet.version_no) <= expectedVersion) {
      throw fail('The corrected shift could not be recorded as a new timesheet version. No changes were saved.', 'TIMESHEET_EDIT_FINALIZATION_FAILED', 503);
    }
    const resultSheet = { ...synchronized.timesheet, can_edit: true, last_edit_request_id: requestId };
    await logActivity(db, { module: 'timesheets', recordId: timesheetId, eventType: 'SOURCE_SHIFT_EDITED', message: reason, actorId: user.id,
      metadata: { attendance_id: attendanceId, attendance_revision: Number(after.revision), version_no: Number(resultSheet.version_no), request_id: requestId } });
    const result = { outcome: 'COMMITTED', message: 'Timesheet source correction saved.', request_id: requestId, timesheet: resultSheet, summary: synchronized.summary,
      attendance: attendancePolicy.publicAttendance(after), existing: false };
    await db.query('INSERT INTO timesheet_edit_receipts(timesheet_id,request_id,payload_sha256,response_json,created_by,version_no) VALUES(?,?,?,?,?,?)', [timesheetId, requestId, hash, JSON.stringify(result), user.id, Number(resultSheet.version_no)]);
    await db.commit();
    return result;
  } catch (error) { await db.rollback(); throw error; }
  finally { db.release(); }
}

module.exports = { editTimesheet, canEdit, canView, assertReceiptSchema, _test: { periodFor, allocatedDate } };
