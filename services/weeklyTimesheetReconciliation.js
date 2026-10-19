'use strict';
const pool = require('../config/db');
const policy = require('./weeklyTimesheetEligibility');
const { hasPermission, canAccessUserRecord } = require('./authorizationService');
const REASONS = Object.freeze({
  INCOMPLETE_SHIFT: 'A shift has no confirmed checkout. Confirm the actual finish time and request an attendance correction.',
  INCOMPLETE_SHIFT_REQUIRES_REVIEW: 'An incomplete shift needs an authorised correction with the actual finish time.',
  ATTENDANCE_TIMEZONE_UNVERIFIED: 'The original timestamp timezone is unverified. A reviewer must confirm the actual local start and finish.',
  ATTENDANCE_REVIEW_REQUIRED: 'An attendance record is flagged for review. Open the related session and review its evidence.',
  RECORDED_DURATION_INCONSISTENT: 'Saved minutes and hours disagree. Review the recorded start, finish and breaks.',
  WORK_AND_BREAK_INCONSISTENT: 'Worked minutes do not agree with the recorded shift and unpaid breaks.',
  OVERLAPPING_WORKED_ENTRIES: 'Two recorded shifts overlap. Confirm which work periods are valid without deleting the original evidence.',
  AMBIGUOUS_MANUAL_WORKED_ENTRIES: 'Manual entries cannot be distinguished from another shift on the same date.',
  MANUAL_AUTHORISATION_REQUIRED: 'A manual work entry needs an authorised reviewer and correction reason.',
  UNVERIFIED_AUTO_CLOSURE: 'An earlier automatic shift closure does not establish the actual finish time.',
  CLOCK_INTERVAL_INVALID: 'The finish is before the start or in the future. Confirm the actual local times.',
  CLOCK_TIMESTAMP_INVALID: 'A saved attendance timestamp cannot be read. Confirm the actual local times.',
  RECORDED_BREAK_INVALID: 'The recorded unpaid break is invalid. Confirm its actual duration.',
  RECORDED_TIMEZONE_INVALID: 'The recorded workplace timezone needs correction.',
  ATTENDANCE_SOURCE_UNVERIFIED: 'The source of this attendance entry needs authorised review.',
  NO_RECIPIENT: 'Save a valid designated timesheet-delivery email in the employee profile. Login email is not used as a fallback.',
  SOURCE_CHANGED: 'Attendance changed after this PDF snapshot. Review and authorise a labelled correction.',
  LEGACY_WEEKLY_DELIVERY_REVIEW: 'A previous delivery exists. Reconcile its provider outcome before authorising another version.',
  WORKER_TRANSPORT_UNCERTAIN: 'The worker stopped during transport. Check the provider result before considering another delivery.',
  PDF_RELAY_CONTRACT_REQUIRED: 'The configured mail relay has not verified PDF attachment support. An administrator must repair the relay.',
  EMAIL_HTTPS_RELAY_FAILED: 'The configured mail relay failed. An administrator must review the transport diagnostics.',
  NO_WORK: 'There is no verified completed work in this reporting period.',
  INELIGIBLE_ACCOUNT: 'This account is not an active eligible employee.',
  MISSING_DELIVERY: 'Eligible completed work has no weekly delivery record yet.'
});
function reasons(value) {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { value = []; } }
  return (Array.isArray(value) ? value : []).filter(Boolean).map(item => {
    const code = String(typeof item === 'object' ? item.code || 'ATTENDANCE_REVIEW_REQUIRED' : item);
    return { code, ...(Number(item?.attendance_id) > 0 ? { attendance_id: Number(item.attendance_id) } : {}),
      message: REASONS[code] || 'This record needs authorised review. Open its history for the recorded evidence.' };
  });
}
function queueOutcome(delivery, queue) {
  if (queue?.provider_accepted_at || delivery?.provider_accepted_at || ['SENT','PROVIDER_ACCEPTED'].includes(queue?.status) || ['SENT','PROVIDER_ACCEPTED'].includes(delivery?.status)) return 'PROVIDER_ACCEPTED';
  if (queue?.status === 'REVIEW_REQUIRED') return 'DELIVERY_UNKNOWN';
  if (queue?.status === 'SENDING') return 'SENDING';
  if (queue?.status === 'RETRY') return 'RETRYING';
  if (queue?.status === 'PENDING') return 'QUEUED';
  if (queue?.status === 'FAILED') return 'FAILED';
  return delivery?.status || 'MISSING_DELIVERY';
}
async function reconcileWeek(options = {}) {
  const db = options.db || pool, now = options.now || new Date(), config = policy.configuration(options.env || process.env);
  const weekly = require('./weeklyTimesheetScheduler');
  const latest = policy.latestCompletedWeek(now, config.timezone);
  const period = options.start ? weekly.periodBounds(options.start, options.end, config.timezone) : latest;
  if (period.end > latest.end) throw Object.assign(new Error('Select a completed reporting week.'), { statusCode: 422 });
  const [employees] = await db.query(`SELECT id,name,role,active,account_status,deleted_at,employee_number,timesheet_delivery_email FROM users ORDER BY id LIMIT 10001`);
  if (employees.length > 10000) throw Object.assign(new Error('Narrow this reconciliation before processing more than 10,000 accounts.'), { statusCode: 422 });
  const outcomes = [];
  for (const staff of employees) {
    if (options.actor && !await canAccessUserRecord(options.actor, staff.id, { own:'VIEW_OWN_TIMESHEET',team:'VIEW_TEAM_TIMESHEET',all:'VIEW_ALL_TIMESHEETS',connection:db })) continue;
    if (!policy.isEmployee(staff)) continue;
    const attendance = await weekly.loadWorkedAttendance(db, staff.id, period);
    const assessment = policy.assessWorkedAttendance(staff, attendance, period, config, now);
    const [[delivery]] = await db.query('SELECT * FROM weekly_timesheet_deliveries WHERE user_id=? AND period_start=? AND period_end=?', [staff.id,period.start,period.end]);
    let queue, document;
    if (delivery?.email_queue_id) [[queue]] = await db.query('SELECT id,status,attempts,max_attempts,next_attempt_at,provider_accepted_at FROM email_queue WHERE id=?',[delivery.email_queue_id]);
    if (delivery?.document_request_id) [[document]] = await db.query('SELECT id,generation_status,pdf_sha256,pdf_pages,email_queue_id FROM document_delivery_requests WHERE id=?',[delivery.document_request_id]);
    const stored = reasons(delivery?.review_reasons_json), current = reasons(assessment.issues);
    const distinct = new Map([...current,...stored].map(issue => [issue.code+':'+(issue.attendance_id||''),issue]));
    if (delivery?.last_error_code) for (const issue of reasons([delivery.last_error_code])) distinct.set(issue.code,issue);
    const recipientValid = Boolean(policy.emailAddress(staff.timesheet_delivery_email));
    if (assessment.status === 'ELIGIBLE' && !recipientValid) distinct.set('NO_RECIPIENT',reasons(['NO_RECIPIENT'])[0]);
    const row = { user_id:Number(staff.id), staff_name:staff.name, period_start:period.start,period_end:period.end,
      eligibility:assessment.status, verified_minutes:assessment.totalMinutes, eligible_record_ids:assessment.rows.map(entry=>entry.id),
      candidate_record_count:attendance.length, duplicate_records:assessment.duplicates, recipient_configured:recipientValid,
      delivery_id:delivery?.id || null, version:delivery?.version || null, status:queueOutcome(delivery,queue),
      review_reasons:[...distinct.values()], last_error_code:delivery?.last_error_code || null,
      pdf:document ? { status:document.generation_status,pages:document.pdf_pages,sha256:document.pdf_sha256 } : {status:'NOT_GENERATED'},
      queue:queue ? { id:queue.id,status:queue.status,attempts:queue.attempts,max_attempts:queue.max_attempts,next_attempt_at:queue.next_attempt_at } : null,
      document_request_id:document?.id || null, provider_accepted:Boolean(queue?.provider_accepted_at||delivery?.provider_accepted_at||queue?.status==='SENT'||delivery?.status==='SENT'),recipient_verified:false };
    if (options.actor && !hasPermission(options.actor,'VIEW_ALL_TIMESHEETS') && !hasPermission(options.actor,'VIEW_TEAM_TIMESHEET')) {
      delete row.last_error_code; delete row.queue;
      row.review_reasons = row.review_reasons.map(({message,attendance_id})=>({message,...(attendance_id?{attendance_id}:{})}));
    }
    outcomes.push(row);
  }
  const counts = {};
  for (const row of outcomes) { counts[row.eligibility]=(counts[row.eligibility]||0)+1; counts['delivery_'+row.status]=(counts['delivery_'+row.status]||0)+1; }
  return { period:{start:period.start,end:period.end,timezone:period.timezone},outcomes,counts,recipient_verified:false,generated_at:now.toISOString() };
}
let lastObservation = '';
async function logLatestWeek(options = {}) {
  const now=options.now||new Date(),hour=now.toISOString().slice(0,13);
  if(lastObservation===hour)return;
  const result=await reconcileWeek(options);
  for(const row of result.outcomes) console.log('Weekly timesheet reconciliation',JSON.stringify({...row,staff_name:undefined}));
  console.log('Weekly timesheet reconciliation totals',JSON.stringify({period:result.period,counts:result.counts,recipient_verified:false}));
  lastObservation=hour;
}
module.exports={reconcileWeek,logLatestWeek,reasons,queueOutcome,REASONS};
