'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DateTime } = require('luxon');
const auth = require('../services/authorizationService');
const verified = require('../services/attendanceVerifiedSummaryService');
const plain = value => JSON.parse(JSON.stringify(value));
const now = new Date('2026-11-09T01:00:00Z');
const original = () => ({ id: 41, user_id: 4, work_date: '2026-11-03', clock_in: '2026-11-02 22:00:00', clock_out: '2026-11-03 06:00:00', total_minutes: 480, total_hours: 8, break_minutes: 0, revision: 1, deleted: 0, timestamp_basis: 'UTC', clock_out_timestamp_basis: 'UTC', recorded_timezone: 'Australia/Sydney', attendance_status: 'WORKED', entry_source: 'CLOCK', review_required: 0, notes: 'Original shift note' });
const state = {};
function reset() { Object.assign(state, { sheet: { id: 1, user_id: 4, week_start: '2026-11-02', week_end: '2026-11-08', status: 'IN_PROGRESS', version_no: 0, total_hours: 8, payroll_status: 'NOT_READY' }, attendance: [original()], receipts: [], audits: [], activities: [], versions: [], transitions: [], breaks: [], superseded: [], queries: [], failAudit: false, failFinalAudit: false, locked: false, overlap: false, authorityChanged: false, revokeOnBegin: false, staffActive: 1, staffDeleted: null }); }
reset();
function rows() { return state.attendance.map(row => ({ ...plain(row), clock_in_utc_text: row.clock_in, clock_out_utc_text: row.clock_out, manual_authorised_at_utc_text: row.manual_authorised_at })); }
function summary() { return verified.assessVerifiedAttendance({ staff: { id: 4, name: 'Fixture employee', role: 'staff', active: 1, account_status: 'ACTIVE', deleted_at: null }, records: rows(), fromDate: '2026-11-02', toDate: '2026-11-08', now, env: { TIMESHEET_TIMEZONE: 'Australia/Sydney' } }); }
async function query(sql, params = []) {
  const text = sql.replace(/\s+/g, ' ').trim(); state.queries.push(text);
  if (text.startsWith('SELECT id,name,role,active,account_status,deleted_at,employee_number,email FROM users')) return [[{ id: 4, name: 'Fixture employee', email: 'fixture@example.invalid', role: 'staff', active: 1, account_status: 'ACTIVE', deleted_at: null }]];
  if (text.startsWith('SELECT * FROM weekly_timesheets WHERE user_id=')) return [[plain(state.sheet)]];
  if (text.startsWith('SELECT status,locked_at,processed_at,exported_at FROM payroll_ready')) return [[]];
  if (text.startsWith('SELECT id,status,snapshot_json,source_sha256,email_queue_id FROM weekly_timesheet_deliveries')) return [[]];
  if (text.startsWith('SELECT id,status FROM email_queue WHERE related_module=')) return [[]];
  if (text.startsWith('SELECT snapshot_json FROM timesheet_versions')) return [[...state.versions.filter(row => row.timesheet_id === params[0] && row.version_no === params[1]).map(plain)]];
  if (text.startsWith('INSERT INTO timesheet_versions')) { state.versions.push({ timesheet_id: params[0], version_no: params[1], status: params[2], snapshot_json: params[3], reason: params[4], created_by: params[5] }); return [{ affectedRows: 1 }]; }
  if (text.startsWith('UPDATE weekly_timesheets SET status=')) { Object.assign(state.sheet, { status: params[0], total_hours: params[1], ordinary_hours: params[2], overtime_hours: params[3], version_no: params[4] }); return [{ affectedRows: 1 }]; }
  if (text.startsWith('INSERT INTO timesheet_approvals')) { state.transitions.push({ timesheet_id: params[0], action: params[1], from_status: params[2], to_status: params[3], reason: params[4], actor_id: params[5] }); return [{ affectedRows: 1 }]; }
  if (text.startsWith('SELECT wt.id,wt.user_id,wt.week_start,wt.week_end')) return [[{ ...plain(state.sheet), staff_active: state.staffActive, staff_role: 'staff', staff_account_status: 'ACTIVE', staff_deleted_at: state.staffDeleted }]];
  if (text === 'SELECT id,role,active,account_status,deleted_at,employee_number FROM users WHERE id=? FOR UPDATE') return [[{ id: 4, role: 'staff', active: state.staffActive, account_status: 'ACTIVE', deleted_at: state.staffDeleted }]];
  if (text.startsWith('SELECT id FROM users WHERE id = ? AND manager_id')) return [[...(Number(params[0]) === 4 && Number(params[1]) === 10 && !state.authorityChanged ? [{ id: 4 }] : [])]];
  if (text === 'SELECT * FROM weekly_timesheets WHERE id=? FOR UPDATE') return [[plain(state.sheet)]];
  if (text.startsWith('SELECT timesheet_id,request_id,payload_sha256')) return [[]];
  if (text.startsWith('SHOW INDEX FROM timesheet_edit_receipts')) return [[{ Seq_in_index: 1, Column_name: 'timesheet_id' }, { Seq_in_index: 2, Column_name: 'request_id' }]];
  if (text.startsWith('SELECT payload_sha256,response_json,created_by FROM timesheet_edit_receipts')) return [[...state.receipts.filter(row => row.timesheet_id === params[0] && row.request_id === params[1]).map(plain)]];
  if (text.startsWith('SELECT a.*') && text.includes('FROM staff_attendance a')) return [[...rows().filter(row => row.id === params[0] && row.user_id === params[1] && (!text.includes('IFNULL(a.deleted,0)=0') || !row.deleted))]];
  if (text.startsWith('SELECT id FROM staff_attendance')) return [[...(state.overlap ? [{ id: 900 }] : [])]];
  if (text.startsWith('UPDATE staff_attendance SET')) {
    const fields = ['clock_in', 'clock_out', 'work_date', 'total_minutes', 'total_hours', 'break_minutes', 'entry_source', 'timestamp_basis', 'clock_out_timestamp_basis', 'recorded_timezone', 'manual_authorised_by', 'manual_authorised_at', 'attendance_status', 'review_required', 'review_reason'];
    const row = state.attendance.find(row => row.id === params[16] && row.user_id === params[17] && row.revision === params[18]);
    if (!row) return [{ affectedRows: 0 }];
    Object.assign(row, Object.fromEntries(fields.map((field, index) => [field, params[index]])), { notes: params[15], revision: row.revision + 1, break_tracking_base_minutes: null });
    return [{ affectedRows: 1 }];
  }
  if (text.startsWith('INSERT INTO timesheet_edit_receipts')) { state.receipts.push({ timesheet_id: params[0], request_id: params[1], payload_sha256: params[2], response_json: params[3], created_by: params[4], version_no: params[5] }); return [{ affectedRows: 1 }]; }
  throw new Error('Unexpected authorised edit fixture query: ' + text);
}
let serial = Promise.resolve();
const db = { query, async getConnection() { let active = false, snapshot, unlock; return { query, async beginTransaction() { const prior = serial; serial = new Promise(resolve => { unlock = resolve; }); await prior; active = true; snapshot = plain(state); if (state.revokeOnBegin) state.authorityChanged = true; }, async commit() { active = false; unlock(); }, async rollback() { if (active) { Object.assign(state, snapshot); active = false; unlock(); } }, release() { assert.equal(active, false); } }; } };
const corrections = {
  async assertMutablePeriod() { if (state.locked || state.sheet.status === 'APPROVED') throw Object.assign(new Error('Historical payroll period locked'), { code: 'ATTENDANCE_PERIOD_LOCKED', statusCode: 409 }); },
  effectiveBreaks: async () => plain(state.breaks),
  async supersedeBreaks(_db, input) { state.superseded.push({ ...input, ids: state.breaks.map(row => row.id) }); }
};
const dependencies = {
  '../config/db': db, luxon: { DateTime }, './workforceSchema': { ensureWorkforceSchema: async () => {} }, './weeklyTimesheetDeliverySchema': { ensureWeeklyTimesheetDeliverySchema: async () => {} },
  './authorizationService': auth, './attendanceVerifiedSummaryService': { loadVerifiedSummary: async () => summary() }, './attendanceTimeService': require('../services/attendanceTimeService'), './attendanceMobilePolicy': require('../services/attendanceMobilePolicy'),
  './attendanceCorrectionService': corrections, './weeklyTimesheetEligibility': require('../services/weeklyTimesheetEligibility'), '../utils/dateOnly': require('../utils/dateOnly'),
  './auditService': { async logAudit(_db, value) { if (state.failAudit || state.failFinalAudit && value.action === 'TIMESHEET_SOURCE_EDITED') throw new Error('Fixture audit failure'); state.audits.push(plain(value)); }, async logActivity(_db, value) { state.activities.push(plain(value)); } },
  './weeklyTimesheetScheduler': { loadWorkedAttendance: async () => rows() }
};
const finalizerModule = { exports: {} }, finalizerFilename = path.join(__dirname, '../services/timesheetFinalizationService.js');
const finalizerDependencies = { ...dependencies, './attendanceVerifiedSummaryService': verified };
new vm.Script(fs.readFileSync(finalizerFilename, 'utf8'), { filename: finalizerFilename }).runInNewContext({ module: finalizerModule, exports: finalizerModule.exports, process, Date, Object, Number, String, JSON, Set, console, require(name) { assert(Object.hasOwn(finalizerDependencies, name), 'Unexpected finalizer dependency ' + name); return finalizerDependencies[name]; } });
dependencies['./timesheetFinalizationService'] = finalizerModule.exports;
const loaded = { exports: {} }, filename = path.join(__dirname, '../services/timesheetEditService.js');
new vm.Script(fs.readFileSync(filename, 'utf8'), { filename }).runInNewContext({ module: loaded, exports: loaded.exports, process, Date, Object, Number, String, JSON, console, require(name) { assert(Object.hasOwn(dependencies, name), 'Unexpected dependency ' + name); return dependencies[name]; } });
const service = loaded.exports;
const manager = { id: 10, role: 'viewer', permissions: ['VIEW_TEAM_TIMESHEET', 'EDIT_TEAM_TIMESHEET'] };
const admin = { id: 99, role: 'viewer', permissions: ['VIEW_ALL_TIMESHEETS', 'EDIT_ALL_TIMESHEETS'] };
const input = (overrides = {}) => ({ attendance_id: 41, expected_version: 0, expected_revision: 1, expected_source_minutes: 480, request_id: 'ea69c23f-603a-49ae-ae07-7798e7ceea61', clock_in: '2026-11-03T09:00:00+11:00', clock_out: '2026-11-03T16:30:00+11:00', reason: 'Corrected actual checkout using the saved site record.', ...overrides });
const edit = (user = manager, overrides = {}) => service.editTimesheet({ id: 1, user, input: input(overrides), now });
async function main() {
  for (const user of [{ id: 4, role: 'staff' }, { id: 11, ...manager, id: 11 }, { id: 12, role: 'viewer', permissions: ['VIEW_ALL_TIMESHEETS'] }, { ...admin, id: 4 }]) await assert.rejects(() => edit(user), error => error.code === 'TIMESHEET_EDIT_DENIED');
  assert.equal(state.audits.length, 0);
  state.staffActive = 0; await assert.rejects(() => edit(admin), error => error.code === 'TIMESHEET_EDIT_DENIED'); state.staffActive = 1;
  state.staffDeleted = '2026-11-08T01:00:00Z'; await assert.rejects(() => edit(admin), error => error.code === 'TIMESHEET_EDIT_DENIED'); state.staffDeleted = null;
  state.revokeOnBegin = true; await assert.rejects(() => edit(), error => error.code === 'TIMESHEET_EDIT_DENIED'); state.revokeOnBegin = false;
  state.attendance[0].attendance_status = 'PLANNED'; await assert.rejects(() => edit(), error => error.code === 'TIMESHEET_SHIFT_NOT_EDITABLE'); state.attendance[0].attendance_status = 'WORKED';
  await assert.rejects(() => edit(manager, { reason: ' ' }), error => error.statusCode === 422);
  await assert.rejects(() => edit(manager, { expected_version: 1 }), error => error.code === 'TIMESHEET_VERSION_CONFLICT');
  await assert.rejects(() => edit(manager, { expected_revision: 2 }), error => error.code === 'ATTENDANCE_REVISION_CONFLICT');
  await assert.rejects(() => edit(manager, { expected_source_minutes: 479 }), error => error.code === 'TIMESHEET_SOURCE_CONFLICT');
  await assert.rejects(() => edit(manager, { attendance_id: 999 }), error => error.code === 'TIMESHEET_SHIFT_NOT_FOUND');
  await assert.rejects(() => edit(manager, { clock_in: '2026-11-09T09:00:00+11:00', clock_out: '2026-11-09T10:00:00+11:00' }), error => error.code === 'TIMESHEET_SHIFT_OUTSIDE_PERIOD');
  state.overlap = true; await assert.rejects(() => edit(), error => error.code === 'ATTENDANCE_CORRECTION_OVERLAP'); state.overlap = false;
  state.breaks = [{ id: 7, ended_at: null }]; await assert.rejects(() => edit(), error => error.code === 'ATTENDANCE_BREAK_PENDING'); state.breaks = [{ id: 7, ended_at: '2026-11-03 01:30:00' }];
  state.locked = true; await assert.rejects(() => edit(), error => error.code === 'ATTENDANCE_PERIOD_LOCKED'); state.locked = false;
  state.sheet.status = 'APPROVED'; await assert.rejects(() => edit(), error => error.code === 'ATTENDANCE_PERIOD_LOCKED'); state.sheet.status = 'IN_PROGRESS';
  state.failAudit = true; const originalState = plain({ sheet: state.sheet, attendance: state.attendance, receipts: state.receipts, audits: state.audits, superseded: state.superseded });
  await assert.rejects(() => edit(), /Fixture audit failure/);
  assert.deepEqual(plain({ sheet: state.sheet, attendance: state.attendance, receipts: state.receipts, audits: state.audits, superseded: state.superseded }), originalState, 'source, break history, weekly version and durable receipt roll back with failed audit'); state.failAudit = false;
  state.failFinalAudit = true; const beforeVersionFailure = plain({ sheet: state.sheet, attendance: state.attendance, receipts: state.receipts, audits: state.audits, versions: state.versions, transitions: state.transitions, activities: state.activities, superseded: state.superseded });
  await assert.rejects(() => edit(), /Fixture audit failure/);
  assert.deepEqual(plain({ sheet: state.sheet, attendance: state.attendance, receipts: state.receipts, audits: state.audits, versions: state.versions, transitions: state.transitions, activities: state.activities, superseded: state.superseded }), beforeVersionFailure, 'a finalizer audit failure rolls back the authoritative shift and its source audit/version transition together'); state.failFinalAudit = false;
  const outcomes = await Promise.all([edit(), edit()]);
  assert.equal(outcomes.filter(result => result.existing).length, 1);
  assert.equal(state.attendance[0].total_minutes, 450); assert.equal(state.attendance[0].total_hours, 7.5); assert.equal(state.attendance[0].revision, 2); assert.equal(state.attendance[0].user_id, 4);
  assert.equal(state.attendance[0].notes, 'Original shift note'); assert.equal(state.sheet.version_no, 1); assert.equal(state.sheet.status, 'FINAL');
  assert.equal(state.receipts.length, 1); assert.equal(state.audits.length, 2); assert.equal(state.activities.length, 2); assert.equal(state.superseded.length, 1);
  assert.equal(state.audits[0].oldValue.total_minutes, 480); assert.equal(state.audits[0].newValue.attendance.total_minutes, 450); assert.equal(state.audits[0].actorId, 10);
  assert.equal(state.versions.length, 1); assert.equal(state.transitions.length, 1); const finalProof = JSON.parse(state.versions[0].snapshot_json).automatic_finalization; assert.equal(finalProof.total_minutes, 450); assert.equal(finalProof.rows[0].total_minutes, 450); assert.equal(finalProof.policy, 'AUTOMATIC_WEEK_FINAL_V1'); assert.equal(state.sheet.approved_by, undefined, 'source correction/finalization never fabricates a manager approval');
  assert.equal(outcomes[0].timesheet.last_edit_request_id, input().request_id); assert.equal(outcomes[0].request_id, input().request_id);
  await assert.rejects(() => edit(manager, { clock_out: '2026-11-03T16:00:00+11:00' }), error => error.code === 'TIMESHEET_EDIT_IDEMPOTENCY_CONFLICT');
  await assert.rejects(() => edit(admin), error => error.code === 'TIMESHEET_EDIT_IDEMPOTENCY_CONFLICT');
  state.receipts[0].response_json = JSON.stringify({ outcome: 'COMMITTED', request_id: input().request_id, timesheet: { id: 1, user_id: 999 }, attendance: { id: 41 } }); await assert.rejects(() => edit(), error => error.code === 'TIMESHEET_EDIT_RECEIPT_INVALID');
  reset(); state.attendance[0].review_required = 1; state.attendance[0].review_reason = 'RECORDED_DURATION_INCONSISTENT';
  const corrected = await edit(manager, { expected_source_minutes: 0 }); assert.equal(corrected.timesheet.status, 'FINAL'); assert.equal(corrected.summary.verified_total_minutes, 450);
  reset(); state.attendance.push({ ...original(), id: 42, work_date: '2026-11-04', clock_in: '2026-11-03 22:00:00', clock_out: '2026-11-04 06:00:00', review_required: 1, review_reason: 'RECORDED_DURATION_INCONSISTENT' });
  const partlyCorrected = await edit(); assert.equal(partlyCorrected.timesheet.status, 'REVIEW_REQUIRED'); assert.equal(partlyCorrected.summary.review_required, true); assert.equal(partlyCorrected.attendance.total_minutes, 450, 'one bad source shift can be corrected without silently clearing another integrity blocker');
  const controller = { exports: {} }; new vm.Script(fs.readFileSync(path.join(__dirname, '../controllers/timesheetWorkflowController.js'), 'utf8')).runInNewContext({ module: controller, exports: controller.exports, console, Number, require(name) { assert.equal(name, '../services/timesheetWorkflowService'); return {}; } });
  for (const action of ['submit', 'approve', 'reject', 'requestCorrection', 'amend', 'legacyStatus']) { let status, body; controller.exports[action]({}, { status(value) { status = value; return this; }, json(value) { body = value; return this; } }); assert.equal(status, 410); assert.equal(body.code, 'TIMESHEET_APPROVAL_REMOVED'); }
  assert(!state.queries.some(sql => /^(?:CREATE|ALTER|DROP|DELETE|TRUNCATE)\b/.test(sql)), 'request-time edit path never writes schema or deletes originals');
  console.log('Authorised timesheet source-edit tests passed: view-only/self/team isolation, exact period/source/revision guards, real completed timestamps, overlap/break/payroll locks, audit rollback, concurrent durable retry, request-key conflict, retained originals/notes, review-required corrections and retired routine approval APIs. Fixtures only; no staff email.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
