'use strict';
const pool = require('../config/db');
const policy = require('./weeklyTimesheetEligibility');
const { hasPermission, canAccessUserRecord } = require('./authorizationService');
const REASONS = Object.freeze({
  INCOMPLETE_SHIFT: 'A shift has no confirmed checkout. Confirm the actual finish time and request an attendance correction.',
  INCOMPLETE_SHIFT_REQUIRES_REVIEW: 'A saved shift requires review. Confirm its actual start, finish and unpaid breaks with an authorised reviewer.',
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
  SOURCE_CHANGED: 'Attendance changed after this report snapshot. Review and authorise a labelled correction.',
  LEGACY_WEEKLY_DELIVERY_REVIEW: 'A previous delivery exists. Reconcile its provider outcome before authorising another version.',
  WORKER_TRANSPORT_UNCERTAIN: 'The worker stopped during transport. Check the provider result before considering another delivery.',
  PDF_RELAY_CONTRACT_REQUIRED: 'The configured mail relay has not verified PDF attachment support. An administrator must repair the relay.',
  WEEKLY_HTML_RELAY_CONTRACT_REQUIRED: 'The configured mail relay has not verified private HTML timesheet delivery. An administrator must repair its HTML and recipient contract.',
  WEEKLY_HTML_CONTENT_INVALID: 'The saved email report content failed its integrity check. An authorised reviewer must inspect the retained report before retry.',
  WEEKLY_HTML_RELAY_VALIDATION_FAILED: 'The relay rejected the HTML timesheet contract before sending. An administrator must review its receiver configuration.',
  WEEKLY_HTML_CONTENT_HASH_MISMATCH: 'The saved email report no longer matches its immutable content hash. Review this retained version before retry.',
  WEEKLY_HTML_SNAPSHOT_MISMATCH: 'The queued email report does not match its retained version. Review the saved report before retry.',
  WEEKLY_HTML_ACCEPTANCE_UNCONFIRMED: 'The relay may have accepted this message without confirming its exact content. Review provider evidence; do not resend automatically.',
  WEEKLY_HTML_ATTACHMENT_UNEXPECTED: 'This HTML-only report has an unexpected attachment. Review the queued version before retry.',
  TIMESHEET_REPORT_GENERATION_FAILED: 'The timesheet email report could not be prepared. Review the rendering failure before an authorised controlled retry.',
  EMAIL_HTTPS_RELAY_FAILED: 'The configured mail relay failed. An administrator must review the transport diagnostics.',
  NO_WORK: 'There is no verified completed work in this reporting period.',
  INELIGIBLE_ACCOUNT: 'This account is not an active eligible employee.',
  MISSING_DELIVERY: 'Eligible completed work has no weekly delivery record yet.',
  GENERATION_RETRY_LIMIT: 'Automatic report preparation has reached its retry limit. An authorised reviewer must inspect the failure before a controlled retry.',
  CONTROLLED_RECOVERY_REQUIRED: 'The automatic recovery window for this week has ended. Reconcile previous queue and provider outcomes before authorising a labelled recovery.',
  SCHEDULER_DISABLED: 'Automatic weekly delivery is disabled. An administrator must review the company scheduling configuration.'
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
function reportMetadata(delivery, document) {
  const frozen = Boolean(delivery?.snapshot_json || delivery?.source_sha256 || delivery?.content_snapshot_json || delivery?.content_sha256 || delivery?.email_queue_id || delivery?.provider_accepted_at || delivery?.sent_at || ['SENT','PROVIDER_ACCEPTED'].includes(delivery?.status));
  // The migration labels historical rows PDF. An untouched eligibility/address
  // placeholder has no old report to preserve and the next routine send is HTML.
  const format = String(frozen ? delivery?.delivery_format || 'PDF' : 'HTML').toUpperCase();
  if (format === 'PDF') return { format, status: document?.generation_status || (delivery?.status === 'GENERATION_FAILED' ? 'GENERATION_FAILED' : 'NOT_GENERATED'), version: delivery?.version || null };
  if (format !== 'HTML') return { format: 'UNKNOWN', status: 'UNSUPPORTED', version: delivery?.version || null };
  if (!delivery?.content_snapshot_json && !delivery?.content_sha256) return { format, status: delivery?.status === 'GENERATION_FAILED' ? 'GENERATION_FAILED' : 'NOT_RENDERED', version: delivery?.version || null };
  try {
    const { assertWeeklyTimesheetEmailContent } = require('./weeklyTimesheetEmailService');
    const content = assertWeeklyTimesheetEmailContent(JSON.parse(delivery.content_snapshot_json), { expectedHash: delivery.content_sha256 });
    return { format, status: 'PREPARED', version: delivery.version, content_sha256: content.contentHash, layout_version: content.layoutVersion };
  } catch {
    return { format, status: 'INVALID', version: delivery?.version || null };
  }
}
function nextAction(row, dispatch) {
  if (row.recipient_verified) return { code: 'NONE', message: 'Recipient receipt has been verified.' };
  if (row.provider_accepted) return { code: 'CHECK_RECEIPT', message: 'The provider accepted this message. Recipient receipt remains unverified; do not resend automatically.' };
  if (['DELIVERY_UNKNOWN', 'SENDING', 'LEGACY_WEEKLY_DELIVERY_REVIEW'].includes(row.status)) return { code: 'REVIEW_PROVIDER', message: 'Reconcile the previous transport outcome before considering another message.' };
  if (row.eligibility === 'INELIGIBLE_ACCOUNT') return { code: 'NONE', message: 'No automatic email is sent to an ineligible account.' };
  if (row.eligibility === 'NO_WORK') return { code: 'NONE', message: 'No weekly email is sent without eligible actual worked time.' };
  if (row.eligibility === 'REVIEW_REQUIRED') return { code: 'REVIEW_SOURCE', message: 'Resolve the identified attendance issues through the authorised correction workflow.' };
  if (!row.recipient_configured) return { code: 'SET_DELIVERY_EMAIL', message: REASONS.NO_RECIPIENT };
  if (row.status === 'REVIEW_REQUIRED' || ['INVALID','UNSUPPORTED'].includes(row.report?.status)) return { code: 'REVIEW_SNAPSHOT', message: 'Review this retained report snapshot and its recorded blocker before an authorised correction or retry.' };
  if (row.status === 'GENERATION_FAILED' || (row.delivery_format === 'PDF' && row.pdf.status === 'GENERATION_FAILED')) return { code: 'RETRY_GENERATION', message: row.delivery_format === 'HTML' ? 'Review the email report preparation failure, then request an authorised controlled retry. Optional PDF generation is separate.' : 'Review the PDF generation failure, then request an authorised controlled retry. No substitute attachment will be sent.' };
  if (row.status === 'FAILED') return { code: 'REVIEW_FAILURE', message: 'Review the recorded transport failure and attempt budget before an authorised recovery. Failed delivery is not approval failure.' };
  if (row.status === 'RETRYING') return { code: 'WAIT_FOR_RETRY', message: 'The durable worker will retry within its attempt budget. Opening the application is not required.' };
  if (['QUEUED', 'PREPARING'].includes(row.status)) return { code: 'WAIT_FOR_WORKER', message: 'The background worker is processing this individual report. Opening the application is not required.' };
  if (dispatch.state === 'NOT_DUE') return { code: 'WAIT_FOR_SCHEDULE', message: 'This report is not due before its configured company send time.' };
  if (dispatch.state === 'DISABLED') return { code: 'REVIEW_SCHEDULE', message: REASONS.SCHEDULER_DISABLED };
  if (dispatch.state === 'CONTROLLED_RECOVERY_REQUIRED') return { code: 'CONTROLLED_RECONCILIATION', message: REASONS.CONTROLLED_RECOVERY_REQUIRED };
  return { code: 'WAIT_FOR_WORKER', message: 'Eligible completed work is waiting for the scheduled background worker. No browser session or approval comment is required.' };
}
async function reconcileWeek(options = {}) {
  const db = options.db || pool, now = options.now || new Date(), config = policy.configuration(options.env || process.env);
  const weekly = require('./weeklyTimesheetScheduler');
  const latest = policy.latestCompletedWeek(now, config.timezone);
  const period = options.start ? weekly.periodBounds(options.start, options.end, config.timezone) : latest;
  const dispatch = policy.reportingDispatch(period, config, now);
  if (period.end > latest.end) throw Object.assign(new Error('Select a completed reporting week.'), { statusCode: 422 });
  const params=[],clauses=[];
  if(options.actor&&!hasPermission(options.actor,'VIEW_ALL_TIMESHEETS')){
    if(hasPermission(options.actor,'VIEW_TEAM_TIMESHEET')){clauses.push(hasPermission(options.actor,'VIEW_OWN_TIMESHEET')?'(manager_id=? OR id=?)':'(manager_id=? AND id<>?)');params.push(options.actor.id,options.actor.id);}
    else if(hasPermission(options.actor,'VIEW_OWN_TIMESHEET')){clauses.push('id=?');params.push(options.actor.id);}
    else return {period:{start:period.start,end:period.end,timezone:period.timezone},outcomes:[],counts:{},recipient_verified:false};
  }
  const [employees] = await db.query(`SELECT id,name,role,active,account_status,deleted_at,employee_number,timesheet_delivery_email FROM users ${clauses.length?'WHERE '+clauses.join(' AND '):''} ORDER BY id LIMIT 10001`,params);
  if (employees.length > 10000) throw Object.assign(new Error('Narrow this reconciliation before processing more than 10,000 accounts.'), { statusCode: 422 });
  const outcomes = [];
  for (const staff of employees) {
    if (options.actor && !await canAccessUserRecord(options.actor, staff.id, { own:'VIEW_OWN_TIMESHEET',team:'VIEW_TEAM_TIMESHEET',all:'VIEW_ALL_TIMESHEETS',connection:db })) continue;
    const attendance = await weekly.loadWorkedAttendance(db, staff.id, period);
    if (!policy.isEmployee(staff) && !attendance.length) continue;
    const assessment = policy.assessWorkedAttendance(staff, attendance, period, config, now);
    const [[delivery]] = await db.query('SELECT * FROM weekly_timesheet_deliveries WHERE user_id=? AND period_start=? AND period_end=?', [staff.id,period.start,period.end]);
    const [[sheet]]=await db.query('SELECT id,status,total_hours,approved_hours,version_no FROM weekly_timesheets WHERE user_id=? AND week_start=? AND week_end=?',[staff.id,period.start,period.end]);
    const [priorQueues]=await db.query(`SELECT id,status,attempts,max_attempts,provider_accepted_at,recipient_verified_at FROM email_queue WHERE related_module='timesheets'
      AND (idempotency_key LIKE ? OR (related_record_id=? AND idempotency_key LIKE 'weekly-timesheet:%')) ORDER BY id DESC LIMIT 101`,[`weekly-timesheet:${staff.id}:${period.start}:${period.end}:%`,String(sheet?.id || delivery?.timesheet_id || 'no-timesheet')]);
    const [documents]=sheet?.id?await db.query("SELECT id,generation_status,pdf_sha256,pdf_pages,email_queue_id FROM document_delivery_requests WHERE related_module='timesheets' AND related_record_id=? ORDER BY id DESC LIMIT 101",[String(sheet.id)]):[[]];

    let queue, document;
    if (delivery?.email_queue_id) [[queue]] = await db.query('SELECT id,status,attempts,max_attempts,next_attempt_at,claimed_at,provider_accepted_at,recipient_verified_at FROM email_queue WHERE id=?',[delivery.email_queue_id]);
    if (delivery?.document_request_id) [[document]] = await db.query('SELECT id,generation_status,pdf_sha256,pdf_pages,email_queue_id FROM document_delivery_requests WHERE id=?',[delivery.document_request_id]);
    const report = reportMetadata(delivery, document);
    const stored = reasons(delivery?.review_reasons_json), current = reasons(assessment.issues);
    const distinct = new Map(current.map(issue => [issue.code+':'+(issue.attendance_id||''),issue]));
    if (delivery?.last_error_code && ['REVIEW_REQUIRED','GENERATION_FAILED','FAILED','RETRY'].includes(delivery.status)) for (const issue of reasons([delivery.last_error_code])) distinct.set(issue.code,issue);
    const recipientValid = Boolean(policy.emailAddress(staff.timesheet_delivery_email));
    if ((assessment.totalMinutes>0||assessment.issues.length>0) && !recipientValid) distinct.set('NO_RECIPIENT',reasons(['NO_RECIPIENT'])[0]);
    const row = { user_id:Number(staff.id), staff_name:staff.name, period_start:period.start,period_end:period.end,
      eligibility:assessment.status, account_evidence:{active:Number(staff.active)===1,status:String(staff.account_status||'ACTIVE'),archived:Boolean(staff.deleted_at),employee:policy.isEmployee(staff)}, verified_minutes:assessment.totalMinutes, eligible_record_ids:assessment.rows.map(entry=>entry.id),
      candidate_record_count:attendance.length, duplicate_records:assessment.duplicates,
      attendance_review_evidence:assessment.issues.map(issue=>{const record=attendance.find(item=>Number(item.id)===Number(issue.attendance_id));return record?{attendance_id:Number(record.id),clock_in_present:Boolean(record.clock_in),clock_out_present:Boolean(record.clock_out),timestamp_basis:record.timestamp_basis,clock_out_timestamp_basis:record.clock_out_timestamp_basis,entry_source:record.entry_source,recorded_timezone:record.recorded_timezone,total_minutes:record.total_minutes,total_hours:record.total_hours,break_minutes:record.break_minutes,review_required:Boolean(Number(record.review_required)),review_reason:record.review_reason}:null;}).filter(Boolean), recipient_configured:recipientValid,
      timesheet_id:sheet?.id || delivery?.timesheet_id || null, timesheet_status:sheet?.status || 'NOT_CREATED',
      previous_queue_outcomes:priorQueues.filter(item=>Number(item.id)!==Number(delivery?.email_queue_id)).map(item=>({id:item.id,status:queueOutcome(null,item),recipient_verified:Boolean(item.recipient_verified_at)})),
      generation_attempts:documents.map(item=>({id:item.id,status:item.generation_status,pages:item.pdf_pages,queue_id:item.email_queue_id})),
      delivery_id:delivery?.id || null, version:delivery?.version || null, status:delivery || queue ? queueOutcome(delivery,queue) : assessment.status==='ELIGIBLE' ? recipientValid?'MISSING_DELIVERY':'NO_RECIPIENT' : assessment.status,
      review_reasons:[...distinct.values()], previous_review_reasons:stored, last_error_code:delivery?.last_error_code || null,
      delivery_format:report.format, report,
      pdf:document ? { status:document.generation_status,pages:document.pdf_pages,sha256:document.pdf_sha256,required_for_email:report.format==='PDF' } : {status:'NOT_GENERATED',required_for_email:report.format==='PDF'},
      last_attempt_at:queue?.claimed_at || null, generation_attempt_count:Number(delivery?.generation_attempts || 0),
      provider_accepted_at:queue?.provider_accepted_at || delivery?.provider_accepted_at || null,
      queue:queue ? { id:queue.id,status:queue.status,attempts:queue.attempts,max_attempts:queue.max_attempts,next_attempt_at:queue.next_attempt_at } : null,
      document_request_id:document?.id || null, provider_accepted:queueOutcome(delivery,queue)==='PROVIDER_ACCEPTED',recipient_verified:Boolean(queue?.recipient_verified_at) };
    if(!delivery?.email_queue_id&&priorQueues.length){row.status='LEGACY_WEEKLY_DELIVERY_REVIEW';row.review_reasons.push(reasons(['LEGACY_WEEKLY_DELIVERY_REVIEW'])[0]);}
    if(!document&&documents[0]?.generation_status==='GENERATION_FAILED')row.pdf={status:'GENERATION_FAILED',required_for_email:report.format==='PDF'};
    // A resolved, unsnapshotted eligibility blocker must not remain the
    // current diagnosis solely because the scheduler has not run again yet.
    if (!delivery?.email_queue_id && !delivery?.snapshot_json && !delivery?.source_sha256 && !priorQueues.length &&
      (!delivery || ['NO_RECIPIENT','NO_WORK','REVIEW_REQUIRED','PENDING'].includes(delivery.status))) {
      row.status = assessment.status === 'ELIGIBLE' ? recipientValid ? 'MISSING_DELIVERY' : 'NO_RECIPIENT' : assessment.status;
    }
    if (row.status === 'MISSING_DELIVERY') row.status = dispatch.state === 'NOT_DUE' ? 'NOT_DUE' : dispatch.state === 'DISABLED' ? 'SCHEDULER_DISABLED' : dispatch.state === 'CONTROLLED_RECOVERY_REQUIRED' ? 'CONTROLLED_RECOVERY_REQUIRED' : row.status;
    row.delivery_record_status = delivery?.status || null;
    row.next_action = nextAction(row, dispatch);

    if (options.actor && !hasPermission(options.actor,'VIEW_ALL_TIMESHEETS') && !hasPermission(options.actor,'VIEW_TEAM_TIMESHEET')) {
      delete row.last_error_code; delete row.queue;delete row.previous_queue_outcomes;delete row.generation_attempts;delete row.attendance_review_evidence;delete row.previous_review_reasons;delete row.account_evidence;
      row.review_reasons = row.review_reasons.map(({message,attendance_id})=>({message,...(attendance_id?{attendance_id}:{})}));
    }
    outcomes.push(row);
  }
  const counts = {};
  for (const row of outcomes) { counts[row.eligibility]=(counts[row.eligibility]||0)+1; counts['delivery_'+row.status]=(counts['delivery_'+row.status]||0)+1; }
  return { period:{start:period.start,end:period.end,timezone:period.timezone},outcomes,counts,dispatch,recipient_verified:false,generated_at:now.toISOString() };
}
let lastObservation = '';
async function logLatestWeek(options = {}) {
  const now=options.now||new Date(),hour=now.toISOString().slice(0,13);
  if(lastObservation===hour)return;
  const result=await reconcileWeek(options);
  for(const row of result.outcomes) console.log('Weekly timesheet reconciliation',JSON.stringify({...row,staff_name:undefined}));
  console.log('Weekly timesheet reconciliation totals',JSON.stringify({period:result.period,counts:result.counts,dispatch:result.dispatch,recipient_verified:false}));
  lastObservation=hour;
}
module.exports={reconcileWeek,logLatestWeek,reasons,queueOutcome,nextAction,reportMetadata,REASONS};
