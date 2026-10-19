'use strict';
const crypto = require('node:crypto');
const { DateTime } = require('luxon');
const pool = require('../config/db');
const { queueDocumentEmail } = require('./documentDeliveryService');
const { timesheetDocumentData } = require('./timesheetDocumentService');
const { ensureWeeklyTimesheetDeliverySchema } = require('./weeklyTimesheetDeliverySchema');
const { backgroundJobService } = require('./backgroundJobService');
const { hasPermission, canAccessUserRecord } = require('./authorizationService');
const { logAudit } = require('./auditService');
const policy = require('./weeklyTimesheetEligibility');

function enabled() { return String(process.env.WEEKLY_TIMESHEET_EMAIL_ENABLED ?? 'true').toLowerCase() !== 'false'; }
function safetyError(reason, providerAccepted = false) {
  return Object.assign(new Error('This weekly timesheet requires review before delivery. No message was sent.'), {
    code: 'DELIVERY_REVIEW_REQUIRED', reasonCode: reason, providerAccepted, statusCode: 409
  });
}
function periodBounds(start, end, timezone) {
  const monday = DateTime.fromISO(String(start), { zone: timezone }).startOf('day');
  if (!monday.isValid || monday.weekday !== 1 || monday.plus({ days: 6 }).toISODate() !== String(end)) throw safetyError('PERIOD_INVALID');
  return { start: String(start), end: String(end), timezone, startUtc: monday.toUTC().toISO(), endExclusiveUtc: monday.plus({ days: 7 }).toUTC().toISO() };
}
function attendanceCandidateParameters(period) {
  // The margin admits unzoned legacy values for review without interpreting
  // them as worked UTC timestamps. Verified entries are filtered again using
  // their actual local shift start, before any PDF can be created.
  return [DateTime.fromISO(period.startUtc).minus({ hours: 14 }).toUTC().toFormat('yyyy-MM-dd HH:mm:ss'),
    DateTime.fromISO(period.endExclusiveUtc).plus({ hours: 14 }).toUTC().toFormat('yyyy-MM-dd HH:mm:ss'), period.start, period.end];
}
async function staffById(db, id, lock = false) {
  const [[staff]] = await db.query(`SELECT id,name,role,active,account_status,deleted_at,employee_number,timesheet_delivery_email
    FROM users WHERE id=?${lock ? ' FOR UPDATE' : ''}`, [id]);
  return staff;
}
async function attendanceForPeriod(db, staffId, period, lock = false) {
  const [rows] = await db.query(`SELECT a.*, DATE_FORMAT(a.clock_in,'%Y-%m-%d %H:%i:%s') AS clock_in_utc_text,
    DATE_FORMAT(a.clock_out,'%Y-%m-%d %H:%i:%s') AS clock_out_utc_text,
    DATE_FORMAT(a.manual_authorised_at,'%Y-%m-%d %H:%i:%s') AS manual_authorised_at_utc_text
    FROM staff_attendance a WHERE a.user_id=? AND
    ((a.clock_in>=? AND a.clock_in<?) OR (a.work_date BETWEEN ? AND ?))
    ORDER BY a.clock_in,a.id LIMIT 2001${lock ? ' FOR UPDATE' : ''}`, [staffId, ...attendanceCandidateParameters(period)]);
  if (rows.length > 2000) throw safetyError('ATTENDANCE_RECORD_LIMIT');
  return rows;
}
async function reviewStatus(db, staffId, period, lock = false) {
  const [[timesheet]] = await db.query(`SELECT id,status,total_hours,approved_hours,version_no,approved_by,approved_at FROM weekly_timesheets WHERE user_id=? AND week_start=? AND week_end=?${lock ? ' FOR UPDATE' : ''}`, [staffId, period.start, period.end]);
  return timesheet || { status: 'DRAFT' };
}
async function reviewProof(db, review, assessment, config) {
  const status = String(review.status || 'DRAFT').toUpperCase();
  const version = Number(review.version_no || 0);
  if (status !== 'APPROVED') return { status, version, verified: false };
  let verified = Number.isSafeInteger(version) && version > 0 && Number(review.approved_by) > 0 && Boolean(review.approved_at) &&
    Math.abs(Number(review.approved_hours) - Math.round(assessment.totalMinutes / 60 * 100) / 100) < 0.00001 &&
    Math.abs(Number(review.total_hours) - Math.round(assessment.totalMinutes / 60 * 100) / 100) < 0.00001;
  if (verified) {
    const [[record]] = await db.query("SELECT snapshot_json,created_by FROM timesheet_versions WHERE timesheet_id=? AND version_no=? AND status='APPROVED' LIMIT 1", [review.id, version]);
    try {
      const approved = JSON.parse(record?.snapshot_json), attendance = approved.attendance;
      verified = Number(record?.created_by) === Number(review.approved_by) && Array.isArray(attendance) &&
        new Set(attendance.map((entry) => Number(entry.id))).size === attendance.length &&
        attendance.length === assessment.rows.length && attendance.every((entry) => {
        const row = assessment.rows.find((current) => Number(current.id) === Number(entry.id));
        return row && Number(entry.user_id) === Number(row.user_id) && Number(entry.total_minutes) === row.total_minutes &&
          String(entry.work_date || '').slice(0, 10) === row.work_date && String(entry.notes || '') === row.notes &&
          (entry.break_minutes ?? null) === row.break_minutes &&
          (entry.timestamp_basis === 'UTC' || config.storageTimezone === 'UTC') &&
          String(entry.recorded_timezone || config.timezone) === row.recorded_timezone &&
          policy.utcInstant(entry.clock_in_utc_text ?? entry.clock_in, 'UTC')?.toMillis() === policy.utcInstant(row.clock_in, 'UTC')?.toMillis() &&
          policy.utcInstant(entry.clock_out_utc_text ?? entry.clock_out, 'UTC')?.toMillis() === policy.utcInstant(row.clock_out, 'UTC')?.toMillis() &&
          String(entry.entry_source || 'CLOCK').toUpperCase() === row.entry_source &&
          (row.entry_source !== 'MANUAL' || (Number(entry.manual_authorised_by) === row.manual_authorised_by &&
            policy.utcInstant(entry.manual_authorised_at_utc_text ?? entry.manual_authorised_at, 'UTC')?.toMillis() === policy.utcInstant(row.manual_authorised_at, 'UTC')?.toMillis()));
      });
    } catch { verified = false; }
  }
  return { status: verified ? 'APPROVED' : 'CORRECTION_REQUIRED', version, verified };
}
async function reviewedSnapshot(db, staff, assessment, period, version, review, config, generatedAt) {
  const proof = await reviewProof(db, review, assessment, config);
  const snapshot = policy.canonicalSnapshot(staff, assessment, period, version, proof.status);
  snapshot.review_version = proof.version; snapshot.approval_verified = proof.verified;
  if (generatedAt) snapshot.generated_at = generatedAt;
  return snapshot;
}
async function currentSnapshot(db, staff, delivery, config, now, lock = false) {
  const period = periodBounds(delivery.period_start, delivery.period_end, delivery.timezone);
  if (config.timezone !== period.timezone) throw safetyError('COMPANY_TIMEZONE_CHANGED');
  const attendance = await attendanceForPeriod(db, staff.id, period, lock);
  const assessment = policy.assessWorkedAttendance(staff, attendance, period, config, now);
  if (assessment.status !== 'ELIGIBLE') throw safetyError(assessment.status === 'REVIEW_REQUIRED' ? 'ATTENDANCE_REVIEW_REQUIRED' : 'NO_ELIGIBLE_WORK');
  const review = await reviewStatus(db, staff.id, period, lock);
  const snapshot = await reviewedSnapshot(db, staff, assessment, period, Number(delivery.version), review, config, frozenSnapshot(delivery).generated_at);
  return { snapshot, sourceHash: policy.snapshotHash(snapshot), assessment };
}
function outcomeLog(outcome, period) {
  console.log('Weekly timesheet eligibility', JSON.stringify({ staff_id: outcome.staff_id, period_start: period.start, period_end: period.end,
    status: outcome.status, version: outcome.version || null, source_sha256: outcome.source_sha256 || null, reason: outcome.reason || null, review_reasons: outcome.review_reasons || [],
    duplicates: outcome.duplicates || 0 }));
}
function generationClaimActive(delivery) { return Number(delivery.claim_active) === 1; }
async function reserveDelivery(staffId, period, config, now) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const staff = await staffById(conn, staffId, true);
    if (!policy.activeEmployee(staff)) { await conn.commit(); return { staff_id: staffId, status: 'INELIGIBLE_ACCOUNT' }; }
    await conn.query(`INSERT INTO weekly_timesheet_deliveries(user_id,period_start,period_end,timezone)
      VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id)`, [staffId, period.start, period.end, config.timezone]);
    const [[delivery]] = await conn.query('SELECT *, (claim_expires_at > NOW()) AS claim_active FROM weekly_timesheet_deliveries WHERE user_id=? AND period_start=? AND period_end=? FOR UPDATE', [staffId, period.start, period.end]);
    if (delivery.email_queue_id || ['SENT', 'PROVIDER_ACCEPTED'].includes(delivery.status) ||
      (delivery.status === 'REVIEW_REQUIRED' && (delivery.snapshot_json || delivery.source_sha256))) {
      await conn.commit(); return { staff_id: staffId, status: delivery.status, existing: true, version: delivery.version, source_sha256: delivery.source_sha256 };
    }
    if (delivery.status === 'PREPARING' && generationClaimActive(delivery)) {
      await conn.commit(); return { staff_id: staffId, status: 'PREPARING', existing: true, version: delivery.version };
    }
    const attendance = await attendanceForPeriod(conn, staffId, period, true);
    const assessment = policy.assessWorkedAttendance(staff, attendance, period, config, now);
    if (assessment.status !== 'ELIGIBLE') {
      await conn.query(`UPDATE weekly_timesheet_deliveries SET status=?,review_reasons_json=?,claim_token=NULL,claim_expires_at=NULL WHERE id=?`,
        [assessment.status, JSON.stringify(assessment.issues), delivery.id]);
      await conn.commit(); return { staff_id: staffId, status: assessment.status, duplicates: assessment.duplicates, review_reasons: assessment.issues };
    }
    const recipient = policy.emailAddress(staff.timesheet_delivery_email);
    if (!recipient) {
      await conn.query("UPDATE weekly_timesheet_deliveries SET status='NO_RECIPIENT',claim_token=NULL,claim_expires_at=NULL WHERE id=?", [delivery.id]);
      await conn.commit(); return { staff_id: staffId, status: 'NO_RECIPIENT', duplicates: assessment.duplicates };
    }
    let timesheet = await reviewStatus(conn, staffId, period, true);
    if (!timesheet.id) {
      const [created] = await conn.query(`INSERT INTO weekly_timesheets(user_id,week_start,week_end,total_hours,status) VALUES(?,?,?,?,'DRAFT')`,
        [staffId, period.start, period.end, Math.round(assessment.totalMinutes / 60 * 100) / 100]);
      timesheet = { id: created.insertId, status: 'DRAFT' };
    }
    // Legacy queue rows remain preserved. They cannot be automatically replaced,
    // repaired or resent by the new worked-only scheduler.
    const [[legacy]] = await conn.query(`SELECT id,status FROM email_queue WHERE related_module='timesheets' AND related_record_id=?
      AND idempotency_key LIKE 'weekly-timesheet:%' LIMIT 1 FOR UPDATE`, [String(timesheet.id)]);
    if (legacy) {
      const status = legacy.status === 'SENT' ? 'SENT' : 'REVIEW_REQUIRED';
      await conn.query('UPDATE weekly_timesheet_deliveries SET status=?,last_error_code=? WHERE id=?', [status, 'LEGACY_WEEKLY_DELIVERY_REVIEW', delivery.id]);
      await conn.commit(); return { staff_id: staffId, status, existing: true, reason: 'LEGACY_WEEKLY_DELIVERY_REVIEW' };
    }
    const snapshot = await reviewedSnapshot(conn, staff, assessment, period, Number(delivery.version), timesheet, config,
      delivery.snapshot_json ? frozenSnapshot(delivery).generated_at : now.toISOString());
    const sourceHash = policy.snapshotHash(snapshot);
    if (delivery.source_sha256 && delivery.source_sha256 !== sourceHash) {
      await conn.query("UPDATE weekly_timesheet_deliveries SET status='REVIEW_REQUIRED',last_error_code='SOURCE_CHANGED',claim_token=NULL,claim_expires_at=NULL WHERE id=?", [delivery.id]);
      await conn.commit(); return { staff_id: staffId, status: 'REVIEW_REQUIRED', reason: 'SOURCE_CHANGED', version: delivery.version };
    }
    const token = crypto.randomUUID();
    await conn.query(`UPDATE weekly_timesheet_deliveries SET status='PREPARING',recipient=?,source_sha256=?,snapshot_json=?,total_minutes=?,
      timesheet_id=?,claim_token=?,claim_expires_at=DATE_ADD(NOW(),INTERVAL 20 MINUTE),last_error_code=NULL,review_reasons_json=NULL WHERE id=?`,
      [recipient, sourceHash, JSON.stringify(snapshot), assessment.totalMinutes, timesheet.id, token, delivery.id]);
    await conn.commit();
    return { staff_id: staffId, status: 'RESERVED', delivery_id: delivery.id, timesheet_id: timesheet.id, recipient, snapshot, claim_token: token,
      version: delivery.version, source_sha256: sourceHash, duplicates: assessment.duplicates };
  } catch (error) { await conn.rollback().catch(() => {}); throw error; }
  finally { conn.release(); }
}
async function checkReservedDelivery(conn, reservation, config, now) {
  const staff = await staffById(conn, reservation.staff_id, true);
  const [[delivery]] = await conn.query('SELECT * FROM weekly_timesheet_deliveries WHERE id=? FOR UPDATE', [reservation.delivery_id]);
  if (!delivery || delivery.claim_token !== reservation.claim_token || delivery.status !== 'PREPARING' || delivery.email_queue_id) throw safetyError('DELIVERY_CLAIM_CHANGED');
  if (!policy.activeEmployee(staff) || policy.emailAddress(staff.timesheet_delivery_email) !== reservation.recipient) throw safetyError('STAFF_OR_RECIPIENT_CHANGED');
  const current = await currentSnapshot(conn, staff, delivery, config, now, true);
  if (current.sourceHash !== reservation.source_sha256 || policy.snapshotHash(JSON.parse(delivery.snapshot_json)) !== reservation.source_sha256) throw safetyError('SOURCE_CHANGED');
}
async function queueReservedDelivery(reservation, config, now) {
  const snapshot = reservation.snapshot;
  const data = documentDataForSnapshot(snapshot);
  const result = await queueDocumentEmail({ module: 'timesheets', recordId: reservation.timesheet_id, data, to: [reservation.recipient],
    deliveryPolicy: { type: 'WEEKLY_TIMESHEET', deliveryId: reservation.delivery_id, staffId: snapshot.staff_id,
      fromDate: snapshot.period_start, toDate: snapshot.period_end, revision: snapshot.version,
      sourceHash: reservation.source_sha256, recipient: reservation.recipient },
    subject: `Voxel Veda weekly timesheet${snapshot.version > 1 ? ` | Correction v${snapshot.version}` : ''} | ${snapshot.period_start} to ${snapshot.period_end}`,
    text: 'Your validated weekly timesheet PDF is attached. Review status is shown in the document and application.',
    html: '<p>Your validated weekly timesheet PDF is attached.</p><p>Review status is shown in the document and application.</p>',
    idempotencyKey: `weekly-timesheet:${snapshot.staff_id}:${snapshot.period_start}:${snapshot.period_end}:v${snapshot.version}`,
    beforeQueue: (conn) => checkReservedDelivery(conn, reservation, config, now),
    afterQueue: async (conn, queueId, requestId) => {
      if (!Number.isSafeInteger(Number(requestId)) || Number(requestId) < 1) throw safetyError('DELIVERY_DOCUMENT_LINK_INVALID');
      const [saved] = await conn.query(`UPDATE weekly_timesheet_deliveries SET status='QUEUED',email_queue_id=?,document_request_id=?,claim_token=NULL,claim_expires_at=NULL
        WHERE id=? AND claim_token=? AND status='PREPARING' AND email_queue_id IS NULL`, [queueId, requestId, reservation.delivery_id, reservation.claim_token]);
      if (saved.affectedRows !== 1) throw safetyError('DELIVERY_CLAIM_CHANGED');
      const [[delivery]] = await conn.query('SELECT * FROM weekly_timesheet_deliveries WHERE id=? FOR UPDATE', [reservation.delivery_id]);
      await retainDeliveryVersion(conn, delivery);
    } });
  if (!result.email_queue_id) throw safetyError('PDF_GENERATION_PENDING');
  const [[linked]] = await pool.query('SELECT email_queue_id,status FROM weekly_timesheet_deliveries WHERE id=?', [reservation.delivery_id]);
  if (Number(linked?.email_queue_id) !== Number(result.email_queue_id)) throw safetyError('DELIVERY_QUEUE_LINK_INVALID');
  return { staff_id: reservation.staff_id, status: 'QUEUED', queue_id: result.email_queue_id, version: snapshot.version,
    request_id: result.request_id, document_pdf_url: result.document_pdf_url, delivery_status_url: result.delivery_status_url,
    source_sha256: reservation.source_sha256, duplicates: reservation.duplicates, provider_accepted: false, recipient_verified: false };
}
async function retainDeliveryVersion(db, delivery) {
  if (!delivery.snapshot_json || !delivery.source_sha256) return;
  await db.query(`INSERT INTO weekly_timesheet_delivery_versions
    (delivery_id,version,user_id,period_start,period_end,recipient,source_sha256,snapshot_json,total_minutes,email_queue_id,document_request_id,status,created_by,reason)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE
      status=IF(source_sha256=VALUES(source_sha256) AND (email_queue_id IS NULL OR email_queue_id=VALUES(email_queue_id)),VALUES(status),status),
      email_queue_id=IF(source_sha256=VALUES(source_sha256) AND email_queue_id IS NULL,VALUES(email_queue_id),email_queue_id),
      document_request_id=IF(source_sha256=VALUES(source_sha256) AND document_request_id IS NULL,VALUES(document_request_id),document_request_id)`, [delivery.id, delivery.version, delivery.user_id, delivery.period_start, delivery.period_end,
    delivery.recipient, delivery.source_sha256, delivery.snapshot_json, delivery.total_minutes, delivery.email_queue_id || null,
    delivery.document_request_id || null, delivery.status, delivery.revision_authorised_by || null, delivery.revision_reason || null]);
}
function documentDataForSnapshot(snapshot) {
  return timesheetDocumentData({ rows: snapshot.rows, fromDate: snapshot.period_start, toDate: snapshot.period_end,
    staffName: snapshot.staff_name, employeeReference: snapshot.employee_reference, totalHours: snapshot.total_minutes / 60,
    staffId: snapshot.staff_id, totalMinutes: snapshot.total_minutes, status: snapshot.review_status, timezone: snapshot.timezone,
    version: snapshot.version, generatedAt: snapshot.generated_at });
}

async function queueClosedWeekTimesheets(options = {}) {
  const config = policy.configuration(options.env || process.env), now = options.now || new Date(), window = policy.scheduleWindow(now, config), period = window.period;
  console.log('Weekly timesheet schedule', JSON.stringify({ timezone: config.timezone, weekday: config.weekday, hour: config.hour,
    minute: config.minute, window_minutes: config.windowMinutes, period_start: period.start, period_end: period.end, reason: window.reason }));
  if (!window.eligible) return { skipped: true, reason: window.reason, queued: 0, period };
  await ensureWeeklyTimesheetDeliverySchema();
  const [candidates] = await pool.query(`SELECT DISTINCT u.id FROM users u JOIN staff_attendance a ON a.user_id=u.id
    WHERE ((a.clock_in>=? AND a.clock_in<?) OR (a.work_date BETWEEN ? AND ?))
    ORDER BY u.id`, attendanceCandidateParameters(period));
  const outcomes = [];
  for (const candidate of candidates) {
    let reservation;
    try {
      reservation = await reserveDelivery(candidate.id, period, config, now);
      const outcome = reservation.status === 'RESERVED' ? await queueReservedDelivery(reservation, config, now) : reservation;
      // Recipient addresses and PDF source content never enter operational logs.
      const publicOutcome = { staff_id: outcome.staff_id, status: outcome.status, version: outcome.version, source_sha256: outcome.source_sha256,
        reason: outcome.reason, review_reasons: outcome.review_reasons, duplicates: outcome.duplicates, existing: outcome.existing, queue_id: outcome.queue_id };
      outcomes.push(publicOutcome); outcomeLog(publicOutcome, period);
    } catch (error) {
      if (reservation?.delivery_id) await pool.query(`UPDATE weekly_timesheet_deliveries SET status=?,last_error_code=?,claim_token=NULL,claim_expires_at=NULL
        WHERE id=? AND claim_token=? AND email_queue_id IS NULL`, [error.code === 'DELIVERY_REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : 'GENERATION_FAILED', String(error.reasonCode || error.code || 'PDF_GENERATION_FAILED').slice(0, 100), reservation.delivery_id, reservation.claim_token]);
      const outcome = { staff_id: candidate.id, status: error.code === 'DELIVERY_REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : 'GENERATION_FAILED', reason: error.reasonCode || error.code || 'PDF_GENERATION_FAILED' };
      outcomes.push(outcome); outcomeLog(outcome, period);
    }
  }
  return { skipped: false, queued: outcomes.filter((row) => row.status === 'QUEUED' && !row.existing).length, existing: outcomes.filter((row) => row.existing).length,
    review: outcomes.filter((row) => row.status === 'REVIEW_REQUIRED').length, invalid: outcomes.filter((row) => row.status === 'NO_RECIPIENT').length,
    failed: outcomes.filter((row) => row.status === 'GENERATION_FAILED').length, staff: candidates.length, period, outcomes };
}
function parsedAddresses(value) { try { const parsed = JSON.parse(value || '[]'); if (!Array.isArray(parsed)) throw new Error(); return parsed; } catch { throw safetyError('RECIPIENT_METADATA_INVALID'); } }
function frozenSnapshot(delivery) {
  try {
    const snapshot = JSON.parse(delivery.snapshot_json);
    if (!snapshot || Array.isArray(snapshot) || snapshot.staff_id !== Number(delivery.user_id) || snapshot.version !== Number(delivery.version) ||
      snapshot.period_start !== delivery.period_start || snapshot.period_end !== delivery.period_end || snapshot.timezone !== delivery.timezone) throw new Error();
    return snapshot;
  } catch { throw safetyError('SNAPSHOT_IDENTITY_INVALID'); }
}
async function validateQueuedWeeklyDelivery(queueRow, db = pool, options = {}) {
  const key = String(queueRow.idempotency_key || queueRow.idempotencyKey || '');
  if (!key.startsWith('weekly-timesheet:')) return null;
  await ensureWeeklyTimesheetDeliverySchema();
  const [[identity]] = await db.query('SELECT user_id FROM weekly_timesheet_deliveries WHERE email_queue_id=?', [queueRow.id]);
  if (!identity) throw safetyError('UNMANAGED_LEGACY_WEEKLY_DELIVERY');
  // Match the reservation/attendance writer lock order: employee, delivery,
  // attendance, review. Keep this transaction open through transport.
  const staff = await staffById(db, identity.user_id, true);
  const [[delivery]] = await db.query('SELECT * FROM weekly_timesheet_deliveries WHERE email_queue_id=? FOR UPDATE', [queueRow.id]);
  if (!delivery) throw safetyError('UNMANAGED_LEGACY_WEEKLY_DELIVERY');
  if (Number(delivery.user_id) !== Number(identity.user_id) || !Number.isSafeInteger(Number(delivery.version)) || Number(delivery.version) < 1) throw safetyError('DELIVERY_IDENTITY_MISMATCH');
  if (['SENT', 'PROVIDER_ACCEPTED'].includes(delivery.status) || delivery.provider_accepted_at) throw safetyError('WEEKLY_DELIVERY_ALREADY_ACCEPTED', true);
  if (!['QUEUED', 'RETRY', 'FAILED'].includes(delivery.status)) throw safetyError('WEEKLY_DELIVERY_STATE_INVALID');
  if (key !== `weekly-timesheet:${delivery.user_id}:${delivery.period_start}:${delivery.period_end}:v${delivery.version}` || String(queueRow.related_record_id) !== String(delivery.timesheet_id)) throw safetyError('DELIVERY_IDENTITY_MISMATCH');
  const to = parsedAddresses(queueRow.to_json), cc = parsedAddresses(queueRow.cc_json), bcc = parsedAddresses(queueRow.bcc_json);
  if (to.length !== 1 || cc.length || bcc.length || to[0] !== delivery.recipient || !policy.emailAddress(to[0])) throw safetyError('RECIPIENT_METADATA_INVALID');
  let transportPolicy;
  try { transportPolicy = JSON.parse(queueRow.delivery_policy_json || 'null'); } catch { throw safetyError('DELIVERY_POLICY_INVALID'); }
  if (!transportPolicy || transportPolicy.type !== 'WEEKLY_TIMESHEET' || Number(transportPolicy.deliveryId) !== Number(delivery.id) ||
    Number(transportPolicy.staffId) !== Number(delivery.user_id) || transportPolicy.fromDate !== delivery.period_start ||
    transportPolicy.toDate !== delivery.period_end || Number(transportPolicy.revision) !== Number(delivery.version) ||
    transportPolicy.sourceHash !== delivery.source_sha256 || transportPolicy.recipient !== delivery.recipient) throw safetyError('DELIVERY_POLICY_INVALID');
  if (!policy.activeEmployee(staff) || policy.emailAddress(staff.timesheet_delivery_email) !== delivery.recipient) throw safetyError('STAFF_OR_RECIPIENT_CHANGED');
  const config = policy.configuration(options.env || process.env);
  const mostRecent = policy.latestCompletedWeek(options.now || new Date(), config.timezone);
  const explicitRevision = Number(delivery.version) > 1 && Number(delivery.revision_authorised_by) > 0 && Boolean(delivery.revision_authorised_at);
  if ((delivery.period_start !== mostRecent.start || delivery.period_end !== mostRecent.end) && !explicitRevision) throw safetyError('HISTORICAL_PERIOD_REQUIRES_AUTHORISED_REVISION');
  const current = await currentSnapshot(db, staff, delivery, config, options.now || new Date(), true);
  const snapshot = frozenSnapshot(delivery);
  if (current.sourceHash !== delivery.source_sha256 || policy.snapshotHash(snapshot) !== delivery.source_sha256) throw safetyError('SOURCE_CHANGED');
  return { delivery_id: delivery.id, staff_id: delivery.user_id, version: delivery.version, source_sha256: delivery.source_sha256,
    snapshot, documentData: documentDataForSnapshot(snapshot) };
}
async function markWeeklyDeliveryResult(db, queueRow, status, metadata = {}) {
  if (!String(queueRow.idempotency_key || '').startsWith('weekly-timesheet:')) return;
  if (!['SENT', 'RETRY', 'FAILED', 'REVIEW_REQUIRED'].includes(status)) throw safetyError('WEEKLY_DELIVERY_STATE_INVALID');
  await db.query(`UPDATE weekly_timesheet_deliveries SET status=?,last_error_code=?,
    provider_accepted_at=CASE WHEN ?=1 THEN COALESCE(provider_accepted_at,NOW()) ELSE provider_accepted_at END,
    sent_at=CASE WHEN ?='SENT' THEN COALESCE(sent_at,NOW()) ELSE sent_at END WHERE email_queue_id=?`,
    [status, metadata.reasonCode || metadata.code || null, status === 'SENT' || metadata.providerAccepted ? 1 : 0, status, queueRow.id]);
  await db.query('UPDATE weekly_timesheet_delivery_versions SET status=? WHERE email_queue_id=?', [status, queueRow.id]);
  const [[delivery]] = await db.query('SELECT user_id,period_start,period_end,version,source_sha256 FROM weekly_timesheet_deliveries WHERE email_queue_id=?', [queueRow.id]);
  if (delivery) outcomeLog({ staff_id: delivery.user_id, status, version: delivery.version, source_sha256: delivery.source_sha256 }, { start: delivery.period_start, end: delivery.period_end });
}
async function queueWeeklyTimesheetRevision(options = {}) {
  const actor = options.actor, id = Number(options.deliveryId), expectedVersion = Number(options.expectedVersion);
  const reason = typeof options.reason === 'string' ? options.reason.trim() : '';
  if (!actor || !hasPermission(actor, 'SEND_COMPANY_EMAIL')) throw Object.assign(new Error('Company document sending is not permitted.'), { code: 'PERMISSION_DENIED', statusCode: 403 });
  if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || !reason || reason.length > 1000) throw Object.assign(new Error('Select a delivery, its current version and a reason for the controlled correction.'), { code: 'REVISION_REQUEST_INVALID', statusCode: 422 });
  const config = policy.configuration(options.env || process.env), now = options.now || new Date();
  await ensureWeeklyTimesheetDeliverySchema();
  const [[identity]] = await pool.query('SELECT user_id FROM weekly_timesheet_deliveries WHERE id=?', [id]);
  if (!identity) throw Object.assign(new Error('Weekly delivery not found.'), { code: 'WEEKLY_DELIVERY_NOT_FOUND', statusCode: 404 });
  const conn = await pool.getConnection(); let reservation;
  try {
    await conn.beginTransaction();
    const staff = await staffById(conn, identity.user_id, true);
    const permitted = (hasPermission(actor, 'MANAGE_COMPANY_EMAIL') && hasPermission(actor, 'VIEW_ALL_TIMESHEETS')) ||
      await canAccessUserRecord(actor, identity.user_id, { team: 'APPROVE_TEAM_TIMESHEET', all: 'APPROVE_ALL_TIMESHEETS', connection: conn });
    if (!permitted) throw Object.assign(new Error('This employee correction is outside your review authority.'), { code: 'PERMISSION_DENIED', statusCode: 403 });
    const [[delivery]] = await conn.query('SELECT *, (claim_expires_at > NOW()) AS claim_active FROM weekly_timesheet_deliveries WHERE id=? FOR UPDATE', [id]);
    if (!delivery || delivery.user_id !== identity.user_id || Number(delivery.version) !== expectedVersion) throw safetyError('REVISION_VERSION_CHANGED');
    if (delivery.status === 'PREPARING' && generationClaimActive(delivery)) throw safetyError('DELIVERY_GENERATION_ACTIVE');
    if (!policy.activeEmployee(staff)) throw safetyError('STAFF_INACTIVE');
    const recipient = policy.emailAddress(staff.timesheet_delivery_email);
    if (!recipient) throw safetyError('NO_DESIGNATED_RECIPIENT');
    const period = periodBounds(delivery.period_start, delivery.period_end, config.timezone);
    const latest = policy.latestCompletedWeek(now, config.timezone);
    if (period.end > latest.end) throw safetyError('PERIOD_NOT_COMPLETED');
    const assessment = policy.assessWorkedAttendance(staff, await attendanceForPeriod(conn, staff.id, period, true), period, config, now);
    if (assessment.status !== 'ELIGIBLE') throw safetyError('ATTENDANCE_REVIEW_REQUIRED');
    let review = await reviewStatus(conn, staff.id, period, true);
    if (!review.id) {
      const [created] = await conn.query("INSERT INTO weekly_timesheets(user_id,week_start,week_end,total_hours,status) VALUES(?,?,?,?,'DRAFT')", [staff.id, period.start, period.end, Math.round(assessment.totalMinutes / 60 * 100) / 100]);
      review = { id: created.insertId, status: 'DRAFT' };
    }
    const retry = options.retryGeneration === true;
    if (retry && (delivery.status !== 'GENERATION_FAILED' || delivery.email_queue_id || !delivery.snapshot_json)) throw safetyError('GENERATION_RETRY_NOT_AVAILABLE');
    const version = retry ? expectedVersion : expectedVersion + 1;
    if (!Number.isSafeInteger(version) || version > 2147483647) throw safetyError('REVISION_VERSION_INVALID');
    const snapshot = await reviewedSnapshot(conn, staff, assessment, period, version, review, config,
      retry ? frozenSnapshot(delivery).generated_at : now.toISOString());
    const hash = policy.snapshotHash(snapshot);
    if (retry && (hash !== delivery.source_sha256 || recipient !== delivery.recipient)) throw safetyError('SOURCE_CHANGED');
    await retainDeliveryVersion(conn, delivery);
    if (delivery.email_queue_id) {
      const [[oldQueue]] = await conn.query('SELECT id,status FROM email_queue WHERE id=? FOR UPDATE', [delivery.email_queue_id]);
      if (oldQueue?.status === 'SENDING') throw safetyError('PREVIOUS_PROVIDER_OUTCOME_REQUIRES_REVIEW');
      if (oldQueue?.status === 'REVIEW_REQUIRED' && options.confirmPossiblePreviousDelivery !== true) throw safetyError('ACKNOWLEDGE_POSSIBLE_PREVIOUS_DELIVERY');
      if (oldQueue && !['SENT','REVIEW_REQUIRED'].includes(oldQueue.status)) await conn.query("UPDATE email_queue SET status='REVIEW_REQUIRED',next_attempt_at=NULL,last_error='Superseded by an explicitly authorised weekly timesheet correction.' WHERE id=? AND status<>'SENT'", [oldQueue.id]);
    }
    const token = crypto.randomUUID();
    await conn.query(`UPDATE weekly_timesheet_deliveries SET version=?,timezone=?,status='PREPARING',recipient=?,source_sha256=?,snapshot_json=?,total_minutes=?,
      timesheet_id=?,email_queue_id=NULL,document_request_id=NULL,provider_accepted_at=NULL,sent_at=NULL,
      revision_authorised_by=?,revision_authorised_at=NOW(),revision_reason=?,claim_token=?,claim_expires_at=DATE_ADD(NOW(),INTERVAL 20 MINUTE),last_error_code=NULL WHERE id=?`,
      [version, config.timezone, recipient, hash, JSON.stringify(snapshot), assessment.totalMinutes, review.id, actor.id, reason, token, id]);
    await logAudit(conn, { actorId: actor.id, action: retry ? 'WEEKLY_TIMESHEET_GENERATION_RETRY' : 'WEEKLY_TIMESHEET_REVISION_AUTHORISED', module: 'timesheets', recordType: 'weekly_delivery', recordId: id,
      oldValue: { version: expectedVersion, source_sha256: delivery.source_sha256, status: delivery.status }, newValue: { version, source_sha256: hash, staff_id: staff.id, period_start: period.start, period_end: period.end, reason } });
    await conn.commit();
    reservation = { staff_id: staff.id, delivery_id: id, timesheet_id: review.id, recipient, snapshot, claim_token: token, version, source_sha256: hash, duplicates: assessment.duplicates };
  } catch (error) { await conn.rollback().catch(() => {}); throw error; }
  finally { conn.release(); }
  try { return await queueReservedDelivery(reservation, config, now); }
  catch (error) {
    await pool.query(`UPDATE weekly_timesheet_deliveries SET status=?,last_error_code=?,claim_token=NULL,claim_expires_at=NULL
      WHERE id=? AND claim_token=? AND email_queue_id IS NULL`, [error.code === 'DELIVERY_REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : 'GENERATION_FAILED', String(error.reasonCode || error.code || 'PDF_GENERATION_FAILED').slice(0,100), id, reservation.claim_token]);
    error.delivery_id = id; error.version = reservation.version;
    throw error;
  }
}
async function processScheduledWeeklyTimesheetEmails() {
  const result = await queueClosedWeekTimesheets();
  await ensureWeeklyTimesheetDeliverySchema();
  try { await require('./weeklyTimesheetReconciliation').logLatestWeek(); }
  catch(error) { console.warn('Weekly reconciliation unavailable', String(error.code || 'RECONCILIATION_FAILED').slice(0,100)); }
  return result;
}
const scheduler = backgroundJobService.createScheduler({ jobKey: 'weekly_timesheet_email',
  description: 'Queue one validated PDF for each employee with verified worked attendance in the most recently completed week',
  handler: processScheduledWeeklyTimesheetEmails, enabled,
  intervalMs: () => Math.max(60000, Number(process.env.WEEKLY_TIMESHEET_EMAIL_INTERVAL_MS || 900000)), initialDelayMs: 10000,
  leaseMs: Number(process.env.WEEKLY_TIMESHEET_LEASE_MS || 15 * 60 * 1000) });
module.exports = { latestCompletedWeek: policy.latestCompletedWeek, queueClosedWeekTimesheets, processScheduledWeeklyTimesheetEmails,
  runScheduledWeeklyTimesheetEmails: (options = {}) => scheduler.run(options), startWeeklyTimesheetScheduler: () => scheduler.start(),
  stopWeeklyTimesheetScheduler: () => scheduler.stop(), validateQueuedWeeklyDelivery, markWeeklyDeliveryResult,
  queueWeeklyTimesheetRevision,
  ensureWeeklyTimesheetDeliverySchema, periodBounds,
  loadWorkedAttendance:attendanceForPeriod,
  getWeeklyTimesheetSchedule: policy.scheduleDetails,
  documentDataForSnapshot,
  _test: { reserveDelivery, checkReservedDelivery, queueReservedDelivery, attendanceForPeriod, currentSnapshot, reviewProof } };
