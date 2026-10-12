'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const policy = require('../services/weeklyTimesheetEligibility');
const { DateTime } = require('luxon');
const attendanceTime=require('../services/attendanceTimeService');
const ENV = { WEEKLY_TIMESHEET_EMAIL_ENABLED: 'true', WEEKLY_TIMESHEET_EMAIL_TIMEZONE: 'Australia/Sydney', ATTENDANCE_STORAGE_TIMEZONE: 'UTC' };
const CONFIG = policy.configuration(ENV), NOW = new Date('2026-10-11T20:00:00Z'), PERIOD = policy.latestCompletedWeek(NOW, CONFIG.timezone);
const staff = (id, extra = {}) => ({ id, name: `Fixture employee ${id}`, employee_number: `FIXTURE-${id}`, role: 'staff', manager_id: 10, active: 1, account_status: 'ACTIVE', deleted_at: null, email: 'login-only@example.invalid', timesheet_delivery_email: `delivery-${id}@example.invalid`, ...extra });
const worked = (id, userId, start = '2026-10-05T22:00:00Z', end = '2026-10-06T06:00:00Z', minutes = 480, extra = {}) => ({ id, user_id: userId, clock_in: start, clock_out: end, total_minutes: minutes, total_hours: Math.round(minutes / 60 * 100) / 100, work_date: '2026-10-06', deleted: 0, notes: '', break_minutes: null, ...extra });
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function assess(rows, employee = staff(1), period = PERIOD, config = CONFIG, now = NOW) { return policy.assessWorkedAttendance(employee, rows, period, config, now); }
function pureEligibility() {
  assert.deepEqual([PERIOD.start, PERIOD.end], ['2026-10-05', '2026-10-11']);
  assert.equal(policy.scheduleWindow(NOW, CONFIG).eligible, true);
  for (const now of ['2026-10-10T20:00:00Z', '2026-10-11T19:59:00Z', '2026-10-11T22:00:00Z', '2026-10-12T20:00:00Z']) assert.equal(policy.scheduleWindow(new Date(now), CONFIG).eligible, false, 'only the bounded Monday window may enqueue the latest completed week');
  assert.throws(() => policy.configuration({ ...ENV, WEEKLY_TIMESHEET_EMAIL_TIMEZONE: 'Not/A_Zone' }), /timezone/);
  assert.throws(() => policy.configuration({ ...ENV, WEEKLY_TIMESHEET_EMAIL_HOUR: 'NaN' }), /integer/);
  assert.throws(() => policy.configuration({ ...ENV, WEEKLY_TIMESHEET_EMAIL_HOUR: 23 }), /end on the configured send day/);
  assert.equal(assess([worked(1, 1)]).status, 'ELIGIBLE'); assert.equal(assess([worked(1, 1)]).totalMinutes, 480);
  assert.equal(assess([]).status, 'NO_WORK');
  for (const status of ['planned', 'scheduled', 'cancelled', 'rejected']) assert.equal(assess([worked(1, 1, undefined, undefined, undefined, { attendance_status: status })]).status, 'NO_WORK');
  assert.equal(assess([worked(1, 1, undefined, undefined, undefined, { deleted: 1 })]).status, 'NO_WORK');
  assert.equal(assess([worked(1, 1, undefined, undefined, 0)]).status, 'NO_WORK');
  assert.equal(assess([worked(1, 1, undefined, null)]).status, 'REVIEW_REQUIRED');
  assert.equal(assess([worked(1, 1, undefined, undefined, undefined, { total_hours: 7.99 })]).status, 'REVIEW_REQUIRED');
  assert.equal(assess([worked(1, 1, undefined, undefined, 450, { break_minutes: 30 })]).totalMinutes, 450);
  assert.equal(assess([worked(1, 1, undefined, undefined, 480, { break_minutes: 30 })]).status, 'REVIEW_REQUIRED');
  const manual = worked(1, 1, null, null, 75, { entry_source: 'MANUAL', manual_authorised_by: 99, manual_authorised_at: '2026-10-06T10:00:00Z', break_minutes: 10 });
  assert.equal(assess([manual]).status, 'ELIGIBLE'); assert.equal(assess([{ ...manual, manual_authorised_by: null }]).status, 'REVIEW_REQUIRED');
  assert.equal(assess([worked(1, 1, '2026-10-05T21:00:00Z', '2026-10-06T09:00:00Z', 720, { notes: 'A' })]).status, 'REVIEW_REQUIRED');assert.equal(assess([worked(1,1,'2026-10-05T21:00:00Z','2026-10-06T09:00:00Z',720,{notes:'Original job A'})]).status,'REVIEW_REQUIRED','legacy A markers appended to existing notes also require review');assert.equal(assess([worked(1,1,'2026-10-05T21:00:00Z','2026-10-06T09:00:00Z',720,{notes:'Original job A',entry_source:'MANUAL',timestamp_basis:'UTC',recorded_timezone:'Australia/Sydney',manual_authorised_by:99,manual_authorised_at:'2026-10-07T01:00:00Z'})]).status,'ELIGIBLE','an explicitly authorised UTC manual correction may establish actual work while preserving original notes');
  assert.equal(assess([worked(1,1,'invalid-clock')]).status,'REVIEW_REQUIRED','invalid saved clock data must be reviewed, not silently treated as no work');
  assert.equal(assess([worked(1, 1)], staff(1, { active: 0 })).status, 'INELIGIBLE_ACCOUNT');
  assert.equal(assess([worked(1, 1)], staff(1, { role: 'customer' })).status, 'INELIGIBLE_ACCOUNT');
  assert.equal(assess([worked(1, 1)], staff(1, { role: 'manager' })).status, 'ELIGIBLE', 'managers may receive their own worked record, never an automatic staff copy');
  const duplicate = assess([worked(1, 1), worked(2, 1)]); assert.equal(duplicate.status, 'ELIGIBLE'); assert.equal(duplicate.totalMinutes, 480); assert.equal(duplicate.duplicates, 1); assert.equal(duplicate.rows.length, 1);
  assert.equal(assess([worked(1, 1), worked(2, 1, '2026-10-05T23:00:00Z', '2026-10-06T07:00:00Z')]).status, 'REVIEW_REQUIRED');
  assert.equal(assess([worked(1, 2)]).status, 'REVIEW_REQUIRED');
  const overnight = assess([worked(1, 1, '2026-10-11T11:00:00Z', '2026-10-11T19:00:00Z')]); assert.equal(overnight.status, 'ELIGIBLE'); assert.equal(overnight.rows[0].work_date, '2026-10-11'); assert.equal(overnight.totalMinutes, 480);
  assert.equal(assess([worked(1, 1, '2026-10-11T13:30:00Z', '2026-10-11T19:30:00Z', 360)]).status, 'NO_WORK', 'a Monday local shift must not enter the prior week merely because its UTC date is Sunday');
  const springNow = new Date('2026-10-04T20:00:00Z'), spring = policy.latestCompletedWeek(springNow, CONFIG.timezone);
  assert.equal((Date.parse(spring.endExclusiveUtc) - Date.parse(spring.startUtc)) / 3600000, 167);
  assert.equal(assess([worked(1, 1, '2026-10-03T15:30:00Z', '2026-10-03T17:30:00Z', 120)], staff(1), spring, CONFIG, springNow).totalMinutes, 120);
  const autumnNow = new Date('2026-04-05T21:00:00Z'), autumn = policy.latestCompletedWeek(autumnNow, CONFIG.timezone);
  assert.equal((Date.parse(autumn.endExclusiveUtc) - Date.parse(autumn.startUtc)) / 3600000, 169);
  assert.equal(assess([worked(1, 1, '2026-04-04T14:30:00Z', '2026-04-04T18:30:00Z', 240)], staff(1), autumn, CONFIG, autumnNow).totalMinutes, 240);
  assert.equal(assess([worked(1, 1)], staff(1), PERIOD, { ...CONFIG, storageTimezone: '' }).status, 'REVIEW_REQUIRED');
  for (const recipient of ['', 'bad', 'one@example.invalid,two@example.invalid', 'Name <one@example.invalid>', 'one@example.invalid\r\nBcc:x@example.invalid']) assert.equal(policy.emailAddress(recipient), '');
  const canonical = policy.canonicalSnapshot(staff(1), overnight, PERIOD); assert.equal(policy.snapshotHash(canonical), policy.snapshotHash(plain(canonical))); assert.equal(canonical.total_minutes, 480);
  assert(!JSON.stringify(canonical).includes('login-only@example.invalid'));
}

function manualTimeAndSchedule() {
  const totalRows=Array.from({length:12},()=>({timestamp_basis:'UTC',total_minutes:50,total_hours:0.83}));assert.equal(require('../services/attendanceRecordedTotals').attendanceRecordedHours(totalRows),10);assert.throws(()=>require('../services/attendanceRecordedTotals').attendanceRecordedHours([{timestamp_basis:'UTC',total_minutes:50,total_hours:8}]),{code:'ATTENDANCE_DURATION_INVALID'});assert.equal(totalRows.reduce((sum,row)=>sum+row.total_hours,0).toFixed(2),'9.96');assert.equal(require('../services/attendanceRecordedTotals').attendanceRecordedHours([{total_hours:9.96}]),9.96,'historical saved totals stay unmodified until authorised review');
  const now=new Date('2026-10-12T02:00:00Z');
  const actual=attendanceTime.manualWorkedEntry({clock_in:'2026-10-04T01:30',clock_out:'2026-10-04T04:30',break_minutes:15},99,now,ENV);
  assert.equal(actual.clock_in,'2026-10-03 15:30:00');assert.equal(actual.clock_out,'2026-10-03 17:30:00');assert.equal(actual.total_minutes,105,'spring-forward elapsed hours, not local clock subtraction');assert.equal(actual.total_hours,1.75);assert.equal(actual.manual_authorised_by,99);assert.equal(actual.timestamp_basis,'UTC');assert.equal(actual.work_date,'2026-10-04');
  assert.throws(()=>attendanceTime.manualWorkedEntry({clock_in:'2026-10-04T02:30',clock_out:'2026-10-04T04:30'},99,now,ENV),(error)=>error.fields.clock_in.includes('does not exist'));
  assert.throws(()=>attendanceTime.manualWorkedEntry({clock_in:'2026-04-05T02:30',clock_out:'2026-04-05T04:30'},99,now,ENV),(error)=>error.fields.clock_in.includes('ambiguous'));
  const autumn=attendanceTime.manualWorkedEntry({clock_in:'2026-04-05T02:30+11:00',clock_out:'2026-04-05T04:30+10:00'},99,now,ENV);assert.equal(autumn.total_minutes,180);
  const incomplete=attendanceTime.manualWorkedEntry({clock_in:'2026-10-11T08:00'},99,now,ENV);assert.equal(incomplete.review_required,1);assert.equal(incomplete.clock_out,null);assert.equal(incomplete.total_minutes,0);
  assert.throws(()=>attendanceTime.manualWorkedEntry({clock_in:'2026-10-11T08:00',clock_out:'2026-10-11T09:00',break_minutes:60},99,now,ENV),(error)=>Boolean(error.fields.break_minutes));
  assert.throws(()=>policy.configuration({...ENV,WEEKLY_TIMESHEET_EMAIL_TIMEZONE:'UTC'}),(error)=>error.code==='WEEKLY_TIMESHEET_POLICY_INVALID');
  assert.throws(()=>policy.configuration({...ENV,TIMESHEET_TIMEZONE:'Australia/Perth'}),(error)=>error.code==='WEEKLY_TIMESHEET_POLICY_INVALID');
  const schedule=policy.scheduleDetails(new Date('2026-10-12T00:00:00Z'),ENV);assert.equal(schedule.next_due_local,'2026-10-19T07:00:00.000+11:00');assert.equal(schedule.timezone,'Australia/Sydney');assert.equal(schedule.weekday,1);
  const wednesday=policy.configuration({...ENV,WEEKLY_TIMESHEET_EMAIL_WEEKDAY:'3'});assert(policy.scheduleWindow(new Date('2026-10-13T20:00:00Z'),wednesday).eligible);assert(!policy.scheduleWindow(NOW,wednesday).eligible);
  const withoutGlobal={...CONFIG,storageTimezone:''};assert.equal(assess([worked(1,1)],staff(1),PERIOD,withoutGlobal).status,'REVIEW_REQUIRED');assert.equal(assess([worked(1,1,undefined,undefined,undefined,{timestamp_basis:'UTC',recorded_timezone:'Australia/Sydney',entry_source:'CLOCK'})],staff(1),PERIOD,withoutGlobal).status,'ELIGIBLE');
}

function schedulerFixture(initial = {}) {
  const state = { staff: [staff(1), staff(2), staff(3), staff(4, { timesheet_delivery_email: null }), staff(5), staff(6, { role: 'manager' })],
    attendance: [worked(1, 1), worked(3, 3, undefined, undefined, undefined, { attendance_status: 'PLANNED' }), worked(4, 4), worked(5, 5, undefined, null), worked(6, 6)],
    deliveries: [], history: [], audits: [], timesheets: [], queues: [], sources: [], logs: [], failPdf: false, beforeQueueMutation: null, ...initial };
  let pending = Promise.resolve();
  async function query(sql, params = [], conn = null) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (/^SELECT DISTINCT u.id/.test(normalized)) return [[...new Set(state.attendance.filter((row) => {
      const timestamp = row.clock_in && Date.parse(row.clock_in); return (timestamp >= Date.parse(params[0].replace(' ', 'T') + 'Z') && timestamp < Date.parse(params[1].replace(' ', 'T') + 'Z')) || (row.entry_source === 'MANUAL' && !row.clock_in && row.work_date >= params[2] && row.work_date <= params[3]);
    }).map((row) => row.user_id))].map((id) => ({ id }))];
    if (/FROM users WHERE id=/.test(normalized)) return [[...state.staff.filter((row) => row.id === params[0]).map(plain)]];
    if (/SELECT id FROM users WHERE id =/.test(normalized)) return [[...state.staff.filter((row)=>row.id===params[0]&&row.manager_id===params[1]&&row.active&&!row.deleted_at).map((row)=>({id:row.id}))]];
    if (/FROM staff_attendance a WHERE a.user_id/.test(normalized)) return [[...state.attendance.filter((row) => row.user_id === params[0] && (row.clock_in ? Date.parse(row.clock_in) >= Date.parse(params[1].replace(' ', 'T')+'Z') && Date.parse(row.clock_in) < Date.parse(params[2].replace(' ', 'T')+'Z') : row.entry_source === 'MANUAL' && row.work_date >= params[3] && row.work_date <= params[4])).map(plain)]];
    if (/INSERT INTO weekly_timesheet_deliveries/.test(normalized)) { if (!state.deliveries.some((row) => row.user_id === params[0] && row.period_start === params[1] && row.period_end === params[2])) state.deliveries.push({ id: state.deliveries.length + 1, user_id: params[0], period_start: params[1], period_end: params[2], timezone: params[3], version: 1, status: 'PENDING', email_queue_id: null }); return [{ affectedRows: 1 }]; }
    if (/SELECT \*(?:, \(claim_expires_at > NOW\(\)\) AS claim_active)? FROM weekly_timesheet_deliveries WHERE user_id=/.test(normalized)) return [[...state.deliveries.filter((row) => row.user_id === params[0] && row.period_start === params[1] && row.period_end === params[2]).map(row=>({...plain(row),claim_active:row.claim_expires_at&&Date.parse(row.claim_expires_at)>NOW.getTime()?1:0}))]];
    if (/SELECT \*(?:, \(claim_expires_at > NOW\(\)\) AS claim_active)? FROM weekly_timesheet_deliveries WHERE id=/.test(normalized)) return [[...state.deliveries.filter((row) => row.id === params[0]).map(row=>({...plain(row),claim_active:row.claim_expires_at&&Date.parse(row.claim_expires_at)>NOW.getTime()?1:0}))]];
    if (/SELECT \* FROM weekly_timesheet_deliveries WHERE email_queue_id=/.test(normalized)) return [[...state.deliveries.filter((row) => row.email_queue_id === params[0]).map(plain)]];
    if (/SELECT user_id FROM weekly_timesheet_deliveries WHERE email_queue_id=/.test(normalized)) return [[...state.deliveries.filter((row) => row.email_queue_id === params[0]).map((row) => ({ user_id: row.user_id }))]];
    if (/SELECT user_id FROM weekly_timesheet_deliveries WHERE id=/.test(normalized)) return [[...state.deliveries.filter((row) => row.id === params[0]).map((row) => ({ user_id: row.user_id }))]];
    if (/SELECT email_queue_id,status FROM weekly_timesheet_deliveries WHERE id=/.test(normalized)) return [[...state.deliveries.filter((row)=>row.id===params[0]).map(plain)]];
    if (/FROM weekly_timesheets WHERE user_id=/.test(normalized)) return [[...state.timesheets.filter((row) => row.user_id === params[0] && row.week_start === params[1] && row.week_end === params[2]).map(plain)]];
    if (/SELECT user_id,period_start,period_end,version,source_sha256 FROM weekly_timesheet_deliveries/.test(normalized)) return [[...state.deliveries.filter((row) => row.email_queue_id === params[0]).map(plain)]];
    if (/INSERT INTO weekly_timesheets/.test(normalized)) { state.timesheets.push({ id: state.timesheets.length + 1, user_id: params[0], week_start: params[1], week_end: params[2], total_hours: params[3], status: 'DRAFT' }); return [{ insertId: state.timesheets.length }]; }
    if (/SELECT id,status FROM email_queue WHERE id=/.test(normalized)) return [[...state.queues.filter((row)=>row.id===params[0]).map(plain)]];
    if (/SELECT id,status FROM email_queue/.test(normalized)) return [[...state.queues.filter((row) => row.related_record_id === params[0]).map(plain)]];
    if (/INSERT INTO weekly_timesheet_delivery_versions/.test(normalized)) { const existing=state.history.find((row)=>row.delivery_id===params[0]&&row.version===params[1]);if(existing&&existing.source_sha256===params[6]&&(!existing.email_queue_id||existing.email_queue_id===params[9])){existing.status=params[11];existing.email_queue_id=existing.email_queue_id||params[9];existing.document_request_id=existing.document_request_id||params[10];}if(!existing)state.history.push({delivery_id:params[0],version:params[1],user_id:params[2],period_start:params[3],period_end:params[4],recipient:params[5],source_sha256:params[6],snapshot_json:params[7],total_minutes:params[8],email_queue_id:params[9],document_request_id:params[10],status:params[11],created_by:params[12],reason:params[13]});return[{affectedRows:1}]; }
    if (/UPDATE weekly_timesheet_delivery_versions SET status=/.test(normalized)){state.history.filter((row)=>row.email_queue_id===params[1]).forEach((row)=>row.status=params[0]);return[{affectedRows:1}];}
    if (/UPDATE email_queue SET status='REVIEW_REQUIRED'/.test(normalized)){state.queues.find((row)=>row.id===params[0]).status='REVIEW_REQUIRED';return[{affectedRows:1}];}
    if (/UPDATE weekly_timesheet_deliveries SET version=/.test(normalized)){const row=state.deliveries.find((row)=>row.id===params[10]);Object.assign(row,{version:params[0],timezone:params[1],status:'PREPARING',recipient:params[2],source_sha256:params[3],snapshot_json:params[4],total_minutes:params[5],timesheet_id:params[6],email_queue_id:null,document_request_id:null,provider_accepted_at:null,sent_at:null,revision_authorised_by:params[7],revision_authorised_at:NOW.toISOString(),revision_reason:params[8],claim_token:params[9],claim_expires_at:new Date(NOW.getTime()+1200000).toISOString()});return[{affectedRows:1}];}
    if (/UPDATE weekly_timesheet_deliveries SET status='PREPARING'/.test(normalized)) {
      const row = state.deliveries.find((row) => row.id === params[6]); Object.assign(row, { status: 'PREPARING', recipient: params[0], source_sha256: params[1], snapshot_json: params[2], total_minutes: params[3], timesheet_id: params[4], claim_token: params[5], claim_expires_at: new Date(NOW.getTime() + 1200000).toISOString() }); return [{ affectedRows: 1 }];
    }
    if (/UPDATE weekly_timesheet_deliveries SET status='QUEUED'/.test(normalized)) { const row = state.deliveries.find((row) => row.id === params[2] && row.claim_token === params[3] && !row.email_queue_id); if (row) Object.assign(row, { status: 'QUEUED', email_queue_id: params[0],document_request_id:params[1], claim_token: null }); return [{ affectedRows: row ? 1 : 0 }]; }
    if (/UPDATE weekly_timesheet_deliveries SET status='NO_RECIPIENT'/.test(normalized)) { state.deliveries.find((row) => row.id === params[0]).status = 'NO_RECIPIENT'; return [{ affectedRows: 1 }]; }
    if (/UPDATE weekly_timesheet_deliveries SET status=\?,review_reasons_json=/.test(normalized)) { Object.assign(state.deliveries.find((row) => row.id === params[2]), { status: params[0], review_reasons_json: params[1], claim_token: null }); return [{ affectedRows: 1 }]; }
    if (/UPDATE weekly_timesheet_deliveries SET status='REVIEW_REQUIRED'/.test(normalized)) { Object.assign(state.deliveries.find((row) => row.id === params[0]), { status: 'REVIEW_REQUIRED', claim_token: null }); return [{ affectedRows: 1 }]; }
    if (/UPDATE weekly_timesheet_deliveries SET status=\?,last_error_code=\?,claim_token=NULL/.test(normalized)) { const row = state.deliveries.find((row) => row.id === params[2] && row.claim_token === params[3] && !row.email_queue_id); if (row) Object.assign(row, { status: params[0], last_error_code: params[1], claim_token: null }); return [{ affectedRows: row ? 1 : 0 }]; }
    if (/UPDATE weekly_timesheet_deliveries SET status=\?,last_error_code=\?, provider_accepted_at/.test(normalized)) { const row = state.deliveries.find((row) => row.email_queue_id === params[4]); Object.assign(row, { status: params[0], provider_accepted_at: params[2] ? NOW.toISOString() : null }); return [{ affectedRows: 1 }]; }
    throw new Error('Unexpected weekly fixture query: ' + normalized + ' params=' + JSON.stringify(params));
  }
  const db = { query: (sql, params) => query(sql, params), async getConnection() {
    let releaseLock, saved, held = false;
    const conn = { async beginTransaction() { const previous = pending; pending = new Promise((resolve) => { releaseLock = resolve; }); await previous; held = true; saved = plain({ deliveries: state.deliveries, timesheets: state.timesheets, queues: state.queues }); },
      query: (sql, params) => query(sql, params, conn), async commit() { held = false; releaseLock(); }, async rollback() { if (held) { state.deliveries = saved.deliveries; state.timesheets = saved.timesheets; state.queues = saved.queues; held = false; releaseLock(); } }, release() { assert(!held); } }; return conn;
  } };
  const dependencies = { '../config/db': db, luxon: require('luxon'), 'node:crypto': require('node:crypto'),
    './weeklyTimesheetEligibility': policy, './weeklyTimesheetDeliverySchema': { ensureWeeklyTimesheetDeliverySchema: async () => {} },
    './authorizationService':require('../services/authorizationService'),'./auditService':{logAudit:async(_db,entry)=>state.audits.push(plain(entry))},
    './timesheetDocumentService': { timesheetDocumentData: (data) => ({ title: 'Fixture timesheet', reference: `${data.fromDate}-${data.toDate}`, party: data.staffName, fixture_data: data }) },
    './backgroundJobService': { backgroundJobService: { createScheduler: () => ({ run() {}, start() {}, stop() {} }) } },
    './documentDeliveryService': { async queueDocumentEmail(message) {
      state.sources.push({ to: plain(message.to), key: message.idempotencyKey, data: plain(message.data), policy:plain(message.deliveryPolicy),cc: message.cc, bcc: message.bcc });
      if (state.failPdf) throw Object.assign(new Error('Fixture PDF generation failed'), { code: 'PDF_PARSE_FAILED' });
      if (state.beforeQueueMutation) { state.beforeQueueMutation(state); state.beforeQueueMutation = null; }
      const conn = await db.getConnection(); await conn.beginTransaction();
      try {
        await message.beforeQueue(conn);
        const existing = state.queues.find((row) => row.idempotency_key === message.idempotencyKey);
        const row = existing || { id: state.queues.length + 1, idempotency_key: message.idempotencyKey, to_json: JSON.stringify(message.to), cc_json: '[]', bcc_json: '[]', related_module: message.module, related_record_id: String(message.recordId), delivery_policy_json:JSON.stringify(message.deliveryPolicy),status: 'PENDING' };
        if (!existing) state.queues.push(row);
        await message.afterQueue(conn, row.id,1000+row.id); await conn.commit(); return { email_queue_id: row.id, request_id:1000+row.id,document_pdf_url:`/api/email/documents/${1000+row.id}/pdf`,generation_status: 'VALIDATED' };
      } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
    } } };
  function reload() {
    const module = { exports: {} };
    const filename = path.join(__dirname, '../services/weeklyTimesheetScheduler.js');
    new vm.Script(fs.readFileSync(filename, 'utf8'), { filename }).runInNewContext({ module, exports: module.exports, Date, console: { log: (...args) => state.logs.push(args.join(' ')) }, process: { env: ENV }, require: (name) => { if (!Object.hasOwn(dependencies, name)) throw new Error('Unexpected dependency: '+name); return dependencies[name]; } });
    return module.exports;
  }
  return { state, db, reload, service: reload() };
}
async function schedulerSafety() {
  const fixture = schedulerFixture(), { state, service, db } = fixture;
  const options = { now: NOW, env: ENV };
  const runs = await Promise.all([service.queueClosedWeekTimesheets(options), service.queueClosedWeekTimesheets(options)]);
  assert(state.deliveries.filter(row=>row.status==='QUEUED').every(row=>row.document_request_id===1000+row.email_queue_id),'weekly preview must reference the same validated queued PDF');
  assert.equal(state.queues.length, 2, 'concurrent workers must queue one PDF only for worked staff A and worked manager own record');
  assert.deepEqual(state.queues.map((row) => JSON.parse(row.to_json)[0]).sort(), ['delivery-1@example.invalid', 'delivery-6@example.invalid']);
  assert(!state.timesheets.some((row) => [2,3,4,5].includes(row.user_id)), 'zero/no-work/missing-recipient/incomplete staff cannot receive a fabricated draft PDF');
  assert(state.deliveries.some((row) => row.user_id === 3 && row.status === 'NO_WORK')); assert(state.deliveries.some((row) => row.user_id === 4 && row.status === 'NO_RECIPIENT')); assert(state.deliveries.some((row) => row.user_id === 5 && row.status === 'REVIEW_REQUIRED'));
  assert(!state.deliveries.some((row) => row.user_id === 2), 'no-work staff are not enumerated from all active users');
  for (const source of state.sources) { assert.equal(source.to.length, 1); assert.equal(source.cc, undefined); assert.equal(source.bcc, undefined); assert(!JSON.stringify(source.data).includes('login-only')); assert(source.data.fixture_data.rows.every((row) => row.user_id === Number(source.key.split(':')[1]))); }
  assert(state.logs.every((line) => !line.includes('@') && !line.includes('Fixture employee')), 'operational proof must not log addresses or PDF source content');
  const restarted = fixture.reload(); await restarted.queueClosedWeekTimesheets(options); assert.equal(state.queues.length, 2, 'restart must preserve staff-period deduplication');
  const queue = state.queues[0];
  const valid = await restarted.validateQueuedWeeklyDelivery(queue, db, options); assert.equal(valid.staff_id, 1); assert.equal(valid.snapshot.total_minutes, 480);
  await assert.rejects(() => restarted.validateQueuedWeeklyDelivery(queue, db, { ...options, now: new Date('2026-10-18T20:00:00Z') }), (error) => error.reasonCode === 'HISTORICAL_PERIOD_REQUIRES_AUTHORISED_REVISION');
  await assert.rejects(()=>restarted.validateQueuedWeeklyDelivery({...queue,delivery_policy_json:JSON.stringify({...JSON.parse(queue.delivery_policy_json),staffId:2})},db,options),(error)=>error.reasonCode==='DELIVERY_POLICY_INVALID');
  await assert.rejects(() => restarted.validateQueuedWeeklyDelivery({ ...queue, cc_json: '["copy@example.invalid"]' }, db, options), (error) => error.reasonCode === 'RECIPIENT_METADATA_INVALID');
  await assert.rejects(() => restarted.validateQueuedWeeklyDelivery({ ...queue, to_json: '["delivery-1@example.invalid","other@example.invalid"]' }, db, options), (error) => error.reasonCode === 'RECIPIENT_METADATA_INVALID');
  state.staff[0].timesheet_delivery_email = 'new-designated@example.invalid';
  await assert.rejects(() => restarted.validateQueuedWeeklyDelivery(queue, db, options), (error) => error.reasonCode === 'STAFF_OR_RECIPIENT_CHANGED');
  state.staff[0].timesheet_delivery_email = 'delivery-1@example.invalid';
  state.staff[0].active=0;await assert.rejects(()=>restarted.validateQueuedWeeklyDelivery(queue,db,options),(error)=>error.reasonCode==='STAFF_OR_RECIPIENT_CHANGED');state.staff[0].active=1;
  state.attendance[0].deleted=1;await assert.rejects(()=>restarted.validateQueuedWeeklyDelivery(queue,db,options),(error)=>error.reasonCode==='NO_ELIGIBLE_WORK');state.attendance[0].deleted=0;
  state.attendance[0].notes = 'Explicit corrected note';
  await assert.rejects(() => restarted.validateQueuedWeeklyDelivery(queue, db, options), (error) => error.reasonCode === 'SOURCE_CHANGED');
  await restarted.queueClosedWeekTimesheets(options); assert.equal(state.queues.length, 2, 'corrections cannot automatically create another version or email');
  state.attendance[0].notes = '';
  await restarted.markWeeklyDeliveryResult(db, queue, 'SENT', { providerAccepted: true });
  await assert.rejects(() => restarted.validateQueuedWeeklyDelivery(queue, db, options), (error) => error.reasonCode === 'WEEKLY_DELIVERY_ALREADY_ACCEPTED' && error.providerAccepted);
  await restarted.queueClosedWeekTimesheets(options); assert.equal(state.queues.length, 2, 'SENT periods must never automatically resend');
  const originalSnapshot=state.deliveries[0].snapshot_json;state.queues[0].status='SENT';
  state.attendance[0].notes='Authorised corrected actual-work description';
  await assert.rejects(()=>restarted.queueWeeklyTimesheetRevision({deliveryId:1,expectedVersion:1,reason:'Correct recorded work',actor:{id:20,role:'viewer',permissions:['SEND_COMPANY_EMAIL']},...options}),(error)=>error.code==='PERMISSION_DENIED');
  await assert.rejects(()=>restarted.queueWeeklyTimesheetRevision({deliveryId:1,expectedVersion:99,reason:'Correct recorded work',actor:{id:99,role:'admin'},...options}),(error)=>error.reasonCode==='REVISION_VERSION_CHANGED');
  const revision=await restarted.queueWeeklyTimesheetRevision({deliveryId:1,expectedVersion:1,reason:'Correct recorded work',actor:{id:99,role:'admin'},...options});
  assert.equal(revision.version,2);assert.equal(state.queues.length,3);assert.equal(state.history.find((row)=>row.delivery_id===1&&row.version===1).snapshot_json,originalSnapshot,'explicit revision must preserve original snapshot identity and PDF queue');
  assert.equal(state.history.find((row)=>row.delivery_id===1&&row.version===1).status,'SENT');
  assert.equal(state.history.find((row)=>row.delivery_id===1&&row.version===2).status,'QUEUED');
  assert.equal(state.audits.at(-1).action,'WEEKLY_TIMESHEET_REVISION_AUTHORISED');assert.equal(state.audits.at(-1).actorId,99);
  const revisedQueue=state.queues[2];assert.equal((await restarted.validateQueuedWeeklyDelivery(revisedQueue,db,{...options,now:new Date('2026-10-18T20:00:00Z')})).version,2,'explicitly authorised historical correction is permitted while an old pending routine version is held');
  await assert.rejects(()=>restarted.validateQueuedWeeklyDelivery(queue,db,options),(error)=>error.reasonCode==='UNMANAGED_LEGACY_WEEKLY_DELIVERY','old accepted source cannot silently be attached to the new version');
  await restarted.queueClosedWeekTimesheets(options);assert.equal(state.queues.length,3,'corrected version cannot automatically resend again');
  const outside = await service.queueClosedWeekTimesheets({ ...options, now: new Date('2026-10-10T20:00:00Z'), force: true }); assert.equal(outside.skipped, true); assert.equal(state.queues.length, 3, 'force must not backfill old weeks or bypass the weekly window');
  const missingStorage=schedulerFixture({staff:[staff(1)],attendance:[worked(1,1)]});const uncertain=await missingStorage.service.queueClosedWeekTimesheets({...options,env:{...ENV,ATTENDANCE_STORAGE_TIMEZONE:''}});assert.equal(uncertain.review,1);assert.equal(missingStorage.state.queues.length,0,'legacy unzoned records never receive guessed UTC eligibility');const explicit=schedulerFixture({staff:[staff(1)],attendance:[worked(1,1,undefined,undefined,undefined,{timestamp_basis:'UTC',recorded_timezone:'Australia/Sydney',entry_source:'CLOCK'})]});assert.equal((await explicit.service.queueClosedWeekTimesheets({...options,env:{...ENV,ATTENDANCE_STORAGE_TIMEZONE:''}})).queued,1,'new per-row auditable UTC writes work without asserting legacy timestamps');
  const endedLater=schedulerFixture({staff:[staff(1)],attendance:[worked(1,1,'2026-10-11T12:00:00Z',null,0)]});assert.equal((await endedLater.service.queueClosedWeekTimesheets(options)).review,1);Object.assign(endedLater.state.attendance[0],{clock_out:'2026-10-11T21:00:00Z',total_minutes:540,total_hours:9});assert.equal((await endedLater.service.queueClosedWeekTimesheets({...options,now:new Date('2026-10-11T21:30:00Z')})).queued,1,'an actual staff clock-out within the window can resolve an initial unsnapshotted incomplete diagnostic without payroll approval');assert.equal(endedLater.state.queues.length,1);assert.equal(endedLater.state.deliveries[0].version,1);
  const invalidRecipient=schedulerFixture({staff:[staff(1,{timesheet_delivery_email:'not-an-address'})],attendance:[worked(1,1)]});assert.equal((await invalidRecipient.service.queueClosedWeekTimesheets(options)).invalid,1);assert.equal(invalidRecipient.state.queues.length,0,'invalid designation never falls back to the saved login address');
  const failure = schedulerFixture({ staff: [staff(1)], attendance: [worked(1, 1)], failPdf: true });
  const failed = await failure.service.queueClosedWeekTimesheets(options); assert.equal(failed.failed, 1); assert.equal(failure.state.queues.length, 0); assert.equal(failure.state.deliveries[0].status, 'GENERATION_FAILED');
  failure.state.failPdf = false; await failure.reload().queueClosedWeekTimesheets(options); assert.equal(failure.state.queues.length, 1, 'same immutable generation request may retry safely after a genuine parser failure');
  const revisionFailure=schedulerFixture({staff:[staff(1)],attendance:[worked(1,1)]});await revisionFailure.service.queueClosedWeekTimesheets(options);await revisionFailure.service.markWeeklyDeliveryResult(revisionFailure.db,revisionFailure.state.queues[0],'SENT',{providerAccepted:true});revisionFailure.state.queues[0].status='SENT';revisionFailure.state.attendance[0].notes='An authorised corrected shift description';revisionFailure.state.failPdf=true;await assert.rejects(()=>revisionFailure.service.queueWeeklyTimesheetRevision({...options,deliveryId:1,expectedVersion:1,reason:'Correct actual attendance',actor:{id:99,role:'admin'}}),{code:'PDF_PARSE_FAILED'});assert.equal(revisionFailure.state.deliveries[0].version,2);assert.equal(revisionFailure.state.deliveries[0].status,'GENERATION_FAILED');revisionFailure.state.failPdf=false;const controlled=await revisionFailure.service.queueWeeklyTimesheetRevision({...options,deliveryId:1,expectedVersion:2,reason:'Retry parser repair without changing the snapshot',retryGeneration:true,actor:{id:99,role:'admin'}});assert.equal(controlled.version,2);assert.equal(revisionFailure.state.queues.length,2);const retainedRetry=revisionFailure.state.history.find(row=>row.delivery_id===1&&row.version===2);assert.equal(retainedRetry.status,'QUEUED');assert.equal(retainedRetry.email_queue_id,2);assert.equal(retainedRetry.document_request_id,1002,'same-version generation retry links successful PDF metadata without replacing immutable history');
  const changed = schedulerFixture({ staff: [staff(1)], attendance: [worked(1, 1)], beforeQueueMutation: (state) => { state.staff[0].timesheet_delivery_email = 'changed@example.invalid'; } });
  const stale = await changed.service.queueClosedWeekTimesheets(options); assert.equal(stale.review, 1); assert.equal(changed.state.queues.length, 0, 'actual staff recipient must be rechecked under locks immediately before queue insertion');
  const incomplete = schedulerFixture({ staff: [staff(1)], attendance: [worked(1,1)], beforeQueueMutation: (state) => { state.attendance[0].clock_out = null; } });
  assert.equal((await incomplete.service.queueClosedWeekTimesheets(options)).review,1); assert.equal(incomplete.state.queues.length,0,'eligibility change during rendering cannot send stale PDF');
  const approved = { id: 1, status: 'APPROVED', total_hours: 8, approved_hours: 8, version_no: 2, approved_by: 99, approved_at: '2026-10-07T01:00:00Z' };
  const approvedDb = { query: async () => [[{ created_by:99,snapshot_json: JSON.stringify({ attendance: [worked(1,1)] }) }]] };
  assert.equal((await service._test.reviewProof(approvedDb, approved, assess([worked(1,1)]), CONFIG)).status, 'APPROVED');
  assert.equal((await service._test.reviewProof({query:async()=>[[{created_by:98,snapshot_json:JSON.stringify({attendance:[worked(1,1)]})}]]},approved,assess([worked(1,1)]),CONFIG)).status,'CORRECTION_REQUIRED','approval snapshot must be attributed to the saved approving actor');
  assert.equal((await service._test.reviewProof(approvedDb, approved, assess([worked(1,1,undefined,undefined,450,{break_minutes:30})]), CONFIG)).status, 'CORRECTION_REQUIRED', 'an old approved total cannot approve newly changed actual work');
  assert.equal((await service._test.reviewProof(approvedDb, approved, assess([worked(1,1,undefined,undefined,undefined,{notes:'Changed after approval'})]), CONFIG)).verified, false, 'matching hours alone cannot prove an unchanged approved attendance snapshot');
}
async function genuinePdfAndSchema() {
  const { timesheetDocumentData } = require('../services/timesheetDocumentService');
  const { createDocumentPdf, validatePdf } = require('../services/documentPdfService');
  const assessment = assess([worked(1,1), worked(2,1,'2026-10-06T22:00:00Z','2026-10-07T06:00:00Z',450,{break_minutes:30})]);
  const snapshot = policy.canonicalSnapshot(staff(1), assessment, PERIOD);
  const data = timesheetDocumentData({ rows:snapshot.rows,fromDate:snapshot.period_start,toDate:snapshot.period_end,
    staffName:snapshot.staff_name,employeeReference:snapshot.employee_reference,totalHours:snapshot.total_minutes/60,
    totalMinutes:snapshot.total_minutes,status:snapshot.review_status,timezone:snapshot.timezone,version:snapshot.version });
  const artifact = await createDocumentPdf(data);
  const parsed = await validatePdf(artifact.buffer,{expectedText:['Fixture employee 1','15.50']});
  assert(parsed.pages>=1);assert.match(artifact.filename,/\.pdf$/);assert.equal(artifact.contentType,'application/pdf');
  assert.doesNotMatch(parsed.text,/Fixture employee [2-6]|login-only|delivery-[2-6]|Ordinary|Overtime|hourly rate|pay rate|salary/i);
  await assert.rejects(()=>validatePdf(Buffer.from('<html>timesheet fallback</html>')),{code:'PDF_DOCUMENT_INVALID'});
  await assert.rejects(()=>validatePdf(artifact.buffer,{expectedText:['Fixture employee 2']}),{code:'PDF_CONTENT_MISMATCH'});
  const directory='/tmp/voxel-pdf-evidence';fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'worked-weekly-timesheet-fixture.pdf'),artifact.buffer);
  const queries=[];const module={exports:{}};
  const dependencies={'../config/db':{query:async(sql)=>{queries.push(sql);return[[]];}},'./workforceSchema':{ensureWorkforceSchema:async()=>{}},'./userLifecycleService':{ensureUserLifecycleSchema:async()=>{}},'./hrAdministrationSchema':{ensureHrAdministrationSchema:async()=>{}}};
  const filename=path.join(__dirname,'../services/weeklyTimesheetDeliverySchema.js');
  new vm.Script(fs.readFileSync(filename,'utf8'),{filename}).runInNewContext({module,exports:module.exports,require:(name)=>dependencies[name]});
  await module.exports.ensureWeeklyTimesheetDeliverySchema();
  assert(queries.some((sql)=>/UNIQUE KEY uniq_weekly_staff_period \(user_id, period_start, period_end\)/.test(sql)));
  assert(queries.some((sql)=>/snapshot_json LONGTEXT/.test(sql)&&/claim_token CHAR\(36\)/.test(sql)));
  assert(!queries.some((sql)=>/^\s*(?:UPDATE|DELETE|DROP|TRUNCATE)\b/i.test(sql)),'schema setup must never manufacture or erase attendance/history');
}
async function main() {
  pureEligibility();manualTimeAndSchedule(); await schedulerSafety(); await genuinePdfAndSchema();
  console.log('Weekly timesheet eligibility tests passed: worked-only A/no-work B/planned C; explicit designated recipient only; incomplete/invalid/manual/break review; positive finite minutes and exact saved-hour consistency; no fabricated closures; whole overnight shift/local week boundaries; 167/169-hour DST weeks; duplicate/overlap isolation; Monday bounded latest-week scheduling; staff-period unique claim/atomic queue; concurrent and restarted workers; PDF failure safe retry; stale recipients/data blocked before queue and send; SENT/corrections never auto-resend; genuine PDF/parser identity validation and additive history-preserving schema. Fixtures only; no real staff or transport messages.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
