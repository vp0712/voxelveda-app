'use strict';
// Synthetic provider responses only. No actual mailbox, API or database calls.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createDocumentPdf, validatePdf } = require('../services/documentPdfService');
const adapter = require('../services/resendTransport');
const contentService = require('../services/weeklyTimesheetEmailService');
const mail = require('../services/emailService');
const envBefore = { ...process.env }, fetchBefore = global.fetch;
const sender = { fromEmail: 'info@voxelveda.com', fromName: 'Voxel Veda', replyTo: 'info@voxelveda.com' };
const id = '146a4120-a0b9-40e1-8dc5-8571363aef70';
const content = { subject: 'Weekly timesheet fixture', html: '<!doctype html><html><body><h1>TIMESHEET</h1><p>Fixture A: 8.00 recorded hours</p></body></html>', text: 'TIMESHEET\nFixture A: 8.00 recorded hours', layoutVersion: 'weekly-html-v1' };
const policy = { type: 'WEEKLY_TIMESHEET', staffId: 31, deliveryId: 81, revision: 1, fromDate: '2026-11-02', toDate: '2026-11-08', sourceHash: crypto.createHash('sha256').update('fixture worked attendance').digest('hex'), recipient: 'fixture-a@example.invalid', recipientSource: 'REGISTERED_EMAIL', recipientPolicyVersion: 2, format: 'HTML', layoutVersion: content.layoutVersion, contentHash: contentService.contentHashFor(content) };
const message = { to: [policy.recipient], cc: [], bcc: [], ...content, attachments: [], deliveryKey: 'weekly-timesheet:31:2026-11-02:2026-11-08:v1', deliveryPolicy: policy };
function response(status, body, headers = {}) { return { status, ok: status >= 200 && status < 300, headers: { get: key => headers[key.toLowerCase()] || null }, json: async () => body }; }
async function main() {
  process.env.RESEND_API_KEY = 'synthetic-not-a-real-key';
  process.env.EMAIL_PRIMARY_TRANSPORT = 'resend';
  process.env.PDF_EMAIL_TRANSPORT = 'resend';
  process.env.MAIL_FROM_ADDRESS = sender.fromEmail;
  process.env.MAIL_FROM_NAME = sender.fromName;
  const requests = [];
  global.fetch = async (url, options) => { assert.equal(url, 'https://api.resend.com/emails'); requests.push(options); return response(200, { id }); };
  const htmlResult = await mail.sendMail(message);
  assert.equal(htmlResult.transport, 'resend'); assert.equal(htmlResult.providerAccepted, true); assert.equal(htmlResult.receivedVerified, false);
  let sent = JSON.parse(requests[0].body);
  assert.deepEqual(sent.to, [policy.recipient]); assert.equal(sent.cc, undefined); assert.equal(sent.bcc, undefined);
  assert.equal(sent.attachments, undefined); assert.equal(sent.html, content.html); assert.equal(sent.text, content.text);
  assert.equal(sent.from, 'Voxel Veda <info@voxelveda.com>');
  assert.equal(requests[0].redirect, 'error'); assert.equal(requests[0].headers.Authorization, 'Bearer synthetic-not-a-real-key');
  assert.match(requests[0].headers['Idempotency-Key'], /^voxelveda-[a-f0-9]{64}$/u);
  await mail.sendMail(message);
  assert.equal(requests[1].body, requests[0].body); assert.equal(requests[1].headers['Idempotency-Key'], requests[0].headers['Idempotency-Key']);
  const changed = await adapter.prepareMessage({ ...message, deliveryPolicy: undefined, deliveryKey: 'stable-record-key', subject: 'Document fixture' }, sender);
  const changed2 = await adapter.prepareMessage({ ...message, deliveryPolicy: undefined, deliveryKey: 'stable-record-key', subject: 'Changed document fixture' }, sender);
  assert.equal(changed.idempotencyKey, changed2.idempotencyKey); assert.notEqual(changed.payloadHash, changed2.payloadHash, 'Provider must detect a changed payload under the same durable key');

  const { buffer } = await createDocumentPdf({ title: 'INVOICE', reference: 'FIXTURE-2026-1', columns: [{label:'Item',width:3},{label:'Amount',width:1}], rows: [['Fixture item', 'AUD 12.00']], notes: ['Fixture-only document'] });
  const pdf = { filename: 'invoice-fixture.pdf', content: buffer, contentType: 'application/pdf', expectedText: ['INVOICE', 'FIXTURE-2026-1', 'AUD 12.00'] };
  const documentMessage = { to: ['document@example.invalid'], cc: [], bcc: [], subject: 'Invoice fixture', html: '<p>Validated invoice attached.</p>', text: 'Validated invoice attached.', attachments: [pdf], deliveryKey: 'invoice:fixture:v1' };
  await mail.sendMail(documentMessage);
  sent = JSON.parse(requests.at(-1).body);
  assert.equal(sent.attachments.length, 1); assert.equal(sent.attachments[0].content_type, 'application/pdf'); assert.equal(sent.attachments[0].filename, pdf.filename);
  const decoded = Buffer.from(sent.attachments[0].content, 'base64');
  assert.deepEqual(decoded, buffer); const parsed = await validatePdf(decoded, { expectedText: pdf.expectedText }); assert.equal(parsed.pages, 1);
  assert.equal(parsed.sha256, crypto.createHash('sha256').update(buffer).digest('hex'));
  const before = requests.length;
  await assert.rejects(() => mail.sendMail({ ...documentMessage, attachments: [{ filename: 'error.tmp', content: Buffer.from('<html>error</html>') }] }), { code: 'PDF_ATTACHMENT_FILENAME_INVALID' });
  await assert.rejects(() => mail.sendMail({ ...documentMessage, attachments: [{ ...pdf, content: Buffer.from('%PDF-1.7\nnot a valid PDF') }] }), error => error.code.startsWith('PDF_'));
  await assert.rejects(() => mail.sendMail({ ...documentMessage, attachments: [{ ...pdf, expectedText: ['ANOTHER-EMPLOYEE'] }] }), { code: 'PDF_CONTENT_MISMATCH' });
  await assert.rejects(() => mail.sendMail({ ...message, cc: ['manager@example.invalid'] }), { code: 'DELIVERY_REVIEW_REQUIRED' });
  await assert.rejects(() => mail.sendMail({ ...message, to: ['other@example.invalid'] }), { code: 'DELIVERY_REVIEW_REQUIRED' });
  await assert.rejects(() => mail.sendMail({ ...message, bcc: ['admin@example.invalid'] }), { code: 'DELIVERY_REVIEW_REQUIRED' });
  await assert.rejects(() => mail.sendMail({ ...message, html: content.html + '<p>changed</p>' }), { code: 'DELIVERY_REVIEW_REQUIRED' });
  assert.equal(requests.length, before, 'Invalid PDF/content/privacy must fail before provider dispatch');

  for (const [status, body, code, outcome, retryable] of [
    [401, { name: 'validation_error' }, 'RESEND_AUTHENTICATION_FAILED', 'NOT_ACCEPTED', false],
    [403, { name: 'validation_error' }, 'RESEND_AUTHENTICATION_FAILED', 'NOT_ACCEPTED', false],
    [422, { name: 'validation_error' }, 'RESEND_MESSAGE_REJECTED', 'NOT_ACCEPTED', false],
    [429, { name: 'rate_limit_exceeded' }, 'RESEND_RATE_LIMITED', 'NOT_ACCEPTED', true],
    [409, { name: 'invalid_idempotent_request' }, 'DELIVERY_REVIEW_REQUIRED', 'UNKNOWN', false],
    [500, { name: 'application_error' }, 'DELIVERY_REVIEW_REQUIRED', 'UNKNOWN', false],
    [200, { error: 'unexpected body' }, 'DELIVERY_REVIEW_REQUIRED', 'UNKNOWN', false]
  ]) {
    global.fetch = async () => response(status, body, { 'retry-after': '12' });
    await assert.rejects(() => mail.sendMail(message), error => error.code === code && error.deliveryOutcome === outcome && error.retryable === retryable && (status !== 429 || error.retryAfterMs === 12000));
  }
  global.fetch = async () => { throw new TypeError('Synthetic lost network'); };
  await assert.rejects(() => mail.sendMail(message), error => error.code === 'DELIVERY_REVIEW_REQUIRED' && error.reasonCode === 'RESEND_NETWORK_OUTCOME_UNKNOWN');
  global.fetch = async () => ({ ...response(200), json: async () => { throw new SyntaxError('Synthetic HTML/error body'); } });
  await assert.rejects(() => mail.sendMail(message), error => error.code === 'DELIVERY_REVIEW_REQUIRED' && error.reasonCode === 'RESEND_ACCEPTANCE_RESPONSE_INVALID');
  process.env.RESEND_TIMEOUT_MS = '1000';
  global.fetch = async (_url, options) => ({ ...response(200), json: () => new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(Object.assign(new Error('Synthetic slow response body'), { name: 'AbortError' })), { once: true }); }) });
  const started = Date.now();
  await assert.rejects(() => mail.sendMail(message), error => error.code === 'DELIVERY_REVIEW_REQUIRED' && error.reasonCode === 'RESEND_NETWORK_OUTCOME_UNKNOWN');
  assert(Date.now() - started < 2500, 'Response body parsing must remain inside the transport timeout');

  global.fetch = async (url, options) => { assert.equal(url, 'https://api.resend.com/domains'); assert.equal(options.method, 'GET'); return response(403, { name: 'restricted_api_key' }); };
  let health = await mail.verifyConnection();
  assert.equal(health.verification, 'CONFIGURED'); assert.equal(health.credentials_verified, false); assert.equal(health.sender_domain_verified, false); assert.equal(health.recipient_receipt_verified, false);
  global.fetch = async () => response(200, { data: [{ name: 'voxelveda.com', status: 'verified' }] });
  health = await mail.verifyConnection(); assert.equal(health.verification, 'SENDER_VERIFIED'); assert.equal(health.credentials_verified, true);
  global.fetch = async () => response(200, { data: [{ name: 'other.invalid', status: 'verified' }] });
  health = await mail.verifyConnection(); assert.equal(health.verification, 'API_AUTHENTICATED'); assert.equal(health.sender_domain_verified, false);
  delete process.env.RESEND_API_KEY;
  assert.equal(mail.isEmailConfigured(), false); assert.deepEqual(mail.missingResendKeys(), ['RESEND_API_KEY']);
  await assert.rejects(() => mail.sendMail(message), { code: 'RESEND_CONFIG_MISSING' });
  process.env.RESEND_API_KEY = 'synthetic-not-a-real-key';
  process.env.PDF_EMAIL_TRANSPORT = 'https_relay';
  await assert.rejects(() => mail.sendMail(documentMessage), { code: 'EMAIL_TRANSPORT_CONFIG_INVALID' });
  process.env.PDF_EMAIL_TRANSPORT = 'resend';
  process.env.MAIL_FROM_ADDRESS = 'unapproved@example.invalid';
  await assert.rejects(() => mail.sendMail(message), { code: 'RESEND_SENDER_INVALID' });
  console.log('Resend transport: parser-valid PDF bytes/metadata, HTML-only private recipient, payload/idempotency, restricted-key readiness and safe error/timeout outcomes passed. No live provider contacted.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { global.fetch = fetchBefore; for (const key of Object.keys(process.env)) if (!(key in envBefore)) delete process.env[key]; Object.assign(process.env, envBefore); });
