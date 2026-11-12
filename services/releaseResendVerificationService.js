'use strict';
// Explicit release fixtures only. This never reserves a staff/week delivery,
// reads attendance, edits an employee address or retries an existing message.
const crypto = require('node:crypto');
const { DateTime } = require('luxon');
const pool = require('../config/db');
const { selectedEmailTransport, validateRecipients } = require('./emailService');
const { queueEmail, restoreAttachments } = require('./emailQueue');
const { queueDocumentEmail } = require('./documentDeliveryService');
const { releaseVerificationData } = require('./releasePdfVerificationService');
const { renderWeeklyTimesheetEmail } = require('./weeklyTimesheetEmailService');
const { validatePdf } = require('./documentPdfService');

// The owner explicitly authorised this test inbox in this release session.
const AUTHORISED_TEST_RECIPIENT = 'Viralvekariya782@gmail.com';
const keyFor = (id, format) => `resend-release-${format.toLowerCase()}:${id}:v1`;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
function verificationError(code, message) { return Object.assign(new Error(message), { code }); }
function testId(value) {
  const id = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(id)) throw verificationError('RESEND_RELEASE_ID_INVALID', 'Set a stable release test ID containing only letters, numbers, underscores or hyphens.');
  return id;
}
function recipients(value) { try { const list = JSON.parse(value || '[]'); return Array.isArray(list) ? list : []; } catch { return []; } }
function assertFixtureQueue(row, id, format) {
  if (row.related_module !== 'security' || row.related_record_id !== `resend-release:${id}:${format.toLowerCase()}` ||
      row.idempotency_key !== keyFor(id, format) ||
      row.template_key !== (format === 'HTML' ? 'release_timesheet_html_fixture_v1' : 'document_pdf') ||
      recipients(row.to_json).length !== 1 || recipients(row.to_json)[0].toLowerCase() !== AUTHORISED_TEST_RECIPIENT.toLowerCase() ||
      recipients(row.cc_json).length || recipients(row.bcc_json).length) {
    throw verificationError('RESEND_RELEASE_FIXTURE_MISMATCH', 'The saved queue row does not match this exact authorised release fixture. Review it without resending.');
  }
}
async function fixtureQueue(id, format, db = pool) {
  const [[row]] = await db.query('SELECT * FROM email_queue WHERE idempotency_key=? LIMIT 1', [keyFor(id, format)]);
  if (row) assertFixtureQueue(row, id, format);
  return row || null;
}
function fixtureSnapshot(id, issuedAt) {
  const issue = DateTime.fromISO(String(issuedAt || ''), { setZone: true });
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(String(issuedAt || '')) || !issue.isValid) throw verificationError('RESEND_RELEASE_ISSUED_AT_REQUIRED', 'Set a fixed ISO issue timestamp with timezone for this release fixture; preserve it across restarts.');
  const monday = issue.setZone('Australia/Sydney').startOf('week').minus({ weeks: 1 });
  const name = 'Authorised test fixture - fictional employee';
  const row = (offset, minutes, breakMinutes) => {
    const start = monday.plus({ days: offset, hours: 9 });
    return { id: offset + 1, user_id: 1, name, work_date: start.toISODate(), clock_in: start.toUTC().toISO(), clock_out: start.plus({ hours: 8 }).toUTC().toISO(),
      timestamp_basis: 'UTC', recorded_timezone: 'Australia/Sydney', entry_source: 'CLOCK', attendance_status: 'COMPLETED',
      total_minutes: minutes, total_hours: minutes / 60, break_minutes: breakMinutes, project: 'Synthetic delivery test only' };
  };
  return { staff_id: 1, staff_name: name, employee_reference: `FIXTURE-${id}`, period_start: monday.toISODate(), period_end: monday.plus({ days: 6 }).toISODate(),
    timezone: 'Australia/Sydney', version: 1, generated_at: issue.toUTC().toISO(), review_status: 'DRAFT', approval_verified: false,
    total_minutes: 930, rows: [row(0, 480, null), row(1, 450, 30)] };
}

async function readResendVerificationEvidence(idValue, db = pool) {
  const id = testId(idValue);
  const evidence = { fixture_only: true, test_id: id, recipient_verified: false, messages: [] };
  for (const format of ['HTML', 'PDF']) {
    const row = await fixtureQueue(id, format, db);
    if (!row) { evidence.messages.push({ format, queued: false, recipient_verified: false }); continue; }
    const metadata = JSON.parse(row.delivery_policy_json || 'null');
    const report = { format, queued: true, queue_id: Number(row.id), status: row.status, attempts: Number(row.attempts || 0),
      provider_accepted: Boolean(row.provider_accepted_at || row.status === 'SENT'), provider_message_id: row.message_id || null,
      recipient_verified: false, to_count: 1, cc_count: 0, bcc_count: 0, transport: metadata?.queueTransport?.provider || 'unbound',
      envelope_sha256: metadata?.queueTransport?.payloadSha256 || null, failure_present: Boolean(row.last_error) };
    const attachments = restoreAttachments(JSON.parse(row.attachments_json || '[]'));
    if (format === 'HTML') {
      if (attachments.length || !row.html_body?.includes(`FIXTURE-${id}`) || !row.text_body?.includes(`FIXTURE-${id}`) ||
          !row.text_body.includes('fictional employee')) throw verificationError('RESEND_RELEASE_FIXTURE_MISMATCH', 'The HTML fixture content or attachment count changed. Review without resending.');
      Object.assign(report, { attachment_count: 0, html_sha256: sha256(row.html_body), text_sha256: sha256(row.text_body), layout_version: 'weekly-html-v1' });
    } else {
      if (attachments.length !== 1) throw verificationError('PDF_ATTACHMENT_INVALID', 'The PDF release fixture must retain exactly one validated PDF.');
      const attachment = attachments[0];
      const checked = await validatePdf(attachment.content, { expectedText: ['DOCUMENT DELIVERY VERIFICATION', `RELEASE-resend-${id}`] });
      if (attachment.contentType !== 'application/pdf' || !/\.pdf$/.test(attachment.filename)) throw verificationError('PDF_ATTACHMENT_INVALID', 'The PDF fixture metadata is invalid.');
      Object.assign(report, { attachment_count: 1, pdf: { filename: attachment.filename, content_type: attachment.contentType,
        sha256: checked.sha256, pages: checked.pages, byte_length: attachment.content.length } });
    }
    evidence.messages.push(report);
  }
  return evidence;
}

async function queueAuthorisedResendVerification(options = {}) {
  const env = options.env || process.env;
  if (env.VV_RESEND_RELEASE_VERIFY !== 'true') return { enabled: false };
  const id = testId(env.VV_RESEND_RELEASE_TEST_ID);
  const recipient = validateRecipients(String(env.VV_RELEASE_TEST_RECIPIENT || '').trim(), 'to');
  if (recipient.length !== 1 || recipient[0].toLowerCase() !== AUTHORISED_TEST_RECIPIENT.toLowerCase()) throw verificationError('RESEND_RELEASE_RECIPIENT_NOT_AUTHORISED', 'This fixture may only use the owner-authorised test inbox. No message was queued.');
  if (selectedEmailTransport() !== 'resend') throw verificationError('RESEND_RELEASE_TRANSPORT_REQUIRED', 'Select the tested Resend release explicitly before this verification. No provider was changed.');
  const snapshot = fixtureSnapshot(id, env.VV_RESEND_RELEASE_TEST_ISSUED_AT);
  const content = renderWeeklyTimesheetEmail(snapshot);
  const htmlSubject = `Voxel Veda HTML timesheet release verification ${id}`;
  const existingHtml = await fixtureQueue(id, 'HTML');
  if (existingHtml && (existingHtml.subject !== htmlSubject || existingHtml.html_body !== content.html || existingHtml.text_body !== content.text)) {
    throw verificationError('RESEND_RELEASE_FIXTURE_IMMUTABLE', 'This test ID already has a different immutable source or issue timestamp. Retain its original settings and review the existing result; no message was resent.');
  }
  if (!existingHtml) {
    await queueEmail({ templateKey: 'release_timesheet_html_fixture_v1', relatedModule: 'security', relatedRecordId: `resend-release:${id}:html`,
      to: [AUTHORISED_TEST_RECIPIENT], cc: [], bcc: [], subject: htmlSubject,
      html: content.html, text: content.text, attachments: [], idempotencyKey: keyFor(id, 'HTML') });
  }
  if (!await fixtureQueue(id, 'PDF')) {
    const data = { ...releaseVerificationData(`resend-${id}`), issueDate: DateTime.fromISO(snapshot.generated_at).setZone(snapshot.timezone).toISODate() };
    await queueDocumentEmail({ module: 'security', recordId: `resend-release:${id}:pdf`, data, to: [AUTHORISED_TEST_RECIPIENT],
      subject: `Voxel Veda PDF release verification ${id}`, text: `The parser-validated release PDF RELEASE-resend-${id} is attached. This is an authorised synthetic delivery test, not a business record.`,
      idempotencyKey: keyFor(id, 'PDF') });
  }
  return { enabled: true, ...await readResendVerificationEvidence(id) };
}
module.exports = { queueAuthorisedResendVerification, readResendVerificationEvidence, fixtureSnapshot };
