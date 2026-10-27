'use strict';
const { DateTime } = require('luxon');
const pool = require('../config/db');
const { canAccessUserRecord } = require('../services/authorizationService');
const weekly = require('../services/weeklyTimesheetScheduler');
const policy = require('../services/weeklyTimesheetEligibility');
const pdfs = require('../services/timesheetPdfService');
const { restoreAttachments } = require('../services/emailQueue');

function error(message, code, statusCode = 409, issues) { return Object.assign(new Error(message), { code, statusCode, issues }); }
exports.download = async (req, res) => {
  let conn;
  try {
    const userId = req.query.user_id == null ? Number(req.user.id) : Number(req.query.user_id);
    if (!Number.isSafeInteger(userId) || userId < 1) throw error('Select a valid employee.', 'TIMESHEET_STAFF_INVALID', 422);
    const permitted = await canAccessUserRecord(req.user, userId, { own: 'VIEW_OWN_TIMESHEET', team: 'VIEW_TEAM_TIMESHEET', all: 'VIEW_ALL_TIMESHEETS' });
    if (!permitted) throw error('This employee timesheet is outside your access.', 'PERMISSION_DENIED', 403);
    const config = policy.configuration(), now = new Date();
    const start = DateTime.fromISO(String(req.query.week_start || ''), { zone: config.timezone }).startOf('day');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.week_start || '')) || !start.isValid || start.weekday !== 1) throw error('Choose the Monday starting the reporting week.', 'TIMESHEET_PERIOD_INVALID', 422);
    if (start > DateTime.fromJSDate(now, { zone: config.timezone }).startOf('week')) throw error('Future weeks have no recorded worked timesheet.', 'TIMESHEET_PERIOD_FUTURE', 422);
    const disposition = req.query.disposition || 'attachment';
    if (!['inline', 'attachment'].includes(disposition)) throw error('Choose preview or download.', 'PDF_DISPOSITION_INVALID', 422);
    const period = weekly.periodBounds(start.toISODate(), start.plus({ days: 6 }).toISODate(), config.timezone);
    await weekly.ensureWeeklyTimesheetDeliverySchema();
    conn = await pool.getConnection();
    await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await conn.beginTransaction();
    if (!await canAccessUserRecord(req.user, userId, { own: 'VIEW_OWN_TIMESHEET', team: 'VIEW_TEAM_TIMESHEET', all: 'VIEW_ALL_TIMESHEETS', connection: conn })) throw error('This employee timesheet is outside your current access.', 'PERMISSION_DENIED', 403);
    const staff = await weekly.loadDocumentStaff(conn, userId);
    if (!staff) throw error('Employee not found.', 'TIMESHEET_STAFF_NOT_FOUND', 404);
    const rows = await weekly.loadWorkedAttendance(conn, userId, period);
    const assessment = policy.assessWorkedAttendance(staff, rows, period, config, now);
    if (assessment.status === 'REVIEW_REQUIRED') throw error('Recorded attendance requires review before a complete timesheet PDF can be generated. Request a correction for the listed entries.', 'ATTENDANCE_REVIEW_REQUIRED', 409, assessment.issues);
    if (assessment.status !== 'ELIGIBLE') throw error('This employee has no eligible recorded worked time in this week.', 'NO_ELIGIBLE_WORK');
    const review = await weekly.loadDocumentReview(conn, userId, period);
    const [[delivery]] = await conn.query('SELECT * FROM weekly_timesheet_deliveries WHERE user_id=? AND period_start=? AND period_end=?', [userId, period.start, period.end]);
    let snapshot = await weekly.reviewedDocumentSnapshot(conn, staff, assessment, period, Number(delivery?.version || 1), review, config, now.toISOString());
    let retainedAttachment = null;
    if (delivery?.snapshot_json) {
      let saved;
      try { saved = JSON.parse(delivery.snapshot_json); } catch { throw error('The retained weekly document requires review.', 'TIMESHEET_PDF_SNAPSHOT_INVALID'); }
      if (policy.snapshotHash(saved) !== delivery.source_sha256) throw error('The retained weekly source hash requires review before downloading this document.', 'TIMESHEET_PDF_SNAPSHOT_INVALID');
      if (pdfs.sourceKey(saved) !== pdfs.sourceKey(snapshot)) throw error('The recorded attendance or review status changed after this weekly document was frozen. An authorised reviewer must reconcile the saved report and create an explicit corrected revision. The previous PDF and delivery remain unchanged.', 'SOURCE_CHANGED');
      if (pdfs.sourceKey(saved) === pdfs.sourceKey(snapshot)) {
        snapshot = saved;
        if (delivery.document_request_id) {
          const [[document]] = await conn.query(`SELECT r.pdf_sha256,q.attachments_json FROM document_delivery_requests r
            JOIN email_queue q ON q.id=r.email_queue_id WHERE r.id=? AND r.related_module='timesheets'`, [delivery.document_request_id]);
          if (document?.attachments_json) {
            const attachments = restoreAttachments(JSON.parse(document.attachments_json));
            if (attachments.length !== 1 || attachments[0].contentType !== 'application/pdf' || !/\.pdf$/.test(attachments[0].filename)) throw error('The retained weekly attachment requires review.', 'PDF_ATTACHMENT_INVALID');
            retainedAttachment = { ...attachments[0], sha256: document.pdf_sha256 };
          }
        }
      }
    }
    const sourceBeforeFreeze = policy.snapshotHash(snapshot);
    snapshot = await pdfs.freezeSnapshot(conn, snapshot);
    if (delivery?.snapshot_json && policy.snapshotHash(snapshot) !== sourceBeforeFreeze) throw error('The frozen app and delivery document timestamps differ. An authorised reviewer must reconcile this document version before it is downloaded or sent.', 'TIMESHEET_PDF_SNAPSHOT_INVALID');
    await conn.commit(); conn.release(); conn = null;
    const artifact = await pdfs.snapshotArtifact(pool, snapshot, retainedAttachment);
    return res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `${disposition}; filename="${artifact.filename}"`,
      'Content-Length': String(artifact.buffer.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'X-Document-SHA256': artifact.validation.sha256, 'X-Document-Source-SHA256': policy.snapshotHash(snapshot), 'X-Document-Version': String(snapshot.version) }).send(artifact.buffer);
  } catch (failure) {
    if (conn) { await conn.rollback().catch(() => {}); conn.release(); }
    if (!failure.statusCode && !failure.status) console.error('Staff timesheet PDF failed:', failure.code || failure.name);
    return res.status(failure.statusCode || failure.status || 500).json({ message: failure.statusCode || failure.status ? failure.message : 'The timesheet PDF could not be generated. No alternative file was returned. Review the failure and retry.', code: failure.code || 'TIMESHEET_PDF_FAILED', issues: failure.issues || undefined });
  }
};
