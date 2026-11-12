'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const actualMail = require('../services/emailService');
const pdf = require('../services/documentPdfService');

async function main() {
  const rows = [];
  const documents = [];
  const queries = [];
  let provider = 'resend';
  const db = { async query(sql, values) {
    queries.push(sql);
    assert.match(sql, /^SELECT \* FROM email_queue WHERE idempotency_key=\? LIMIT 1$/);
    return [[rows.find(row => row.idempotency_key === values[0])].filter(Boolean)];
  } };
  const install = (name, exports) => { const id = require.resolve(name); require.cache[id] = { id, filename: id, loaded: true, exports }; };
  const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
  async function save(message) {
    assert.equal(message.relatedModule, 'security');
    assert.deepEqual(message.to, ['Viralvekariya782@gmail.com']);
    assert.deepEqual(message.cc || [], []); assert.deepEqual(message.bcc || [], []);
    const attachments = (message.attachments || []).map(part => ({ filename: part.filename, contentType: part.contentType,
      contentDisposition: 'attachment', content: part.content.toString('base64'), encoding: 'base64', byteLength: part.content.length, sha256: sha256(part.content) }));
    const row = { id: rows.length + 1, status: 'PENDING', attempts: 0, idempotency_key: message.idempotencyKey,
      template_key: message.templateKey, related_module: message.relatedModule, related_record_id: message.relatedRecordId,
      subject: message.subject, html_body: message.html, text_body: message.text,
      to_json: JSON.stringify(message.to), cc_json: '[]', bcc_json: '[]', attachments_json: JSON.stringify(attachments),
      delivery_policy_json: JSON.stringify({ type: 'QUEUE_TRANSPORT', queueTransport: { version: 1, provider, payloadSha256: sha256(JSON.stringify(message)) } }) };
    rows.push(row); return row.id;
  }
  install('../config/db', db);
  install('../services/emailService', { ...actualMail, selectedEmailTransport: () => provider });
  install('../services/emailQueue', { queueEmail: save, restoreAttachments: parts => parts.map(part => {
    const content = Buffer.from(part.content, 'base64'); assert.equal(sha256(content), part.sha256); return { ...part, content };
  }) });
  install('../services/documentDeliveryService', { async queueDocumentEmail(input) {
    documents.push(input);
    const artifact = await pdf.createDocumentPdf(input.data);
    return { email_queue_id: await save({ templateKey: 'document_pdf', relatedModule: input.module, relatedRecordId: input.recordId,
      to: input.to, subject: input.subject, text: input.text, idempotencyKey: input.idempotencyKey,
      attachments: [{ filename: artifact.filename, contentType: 'application/pdf', content: artifact.buffer }] }) };
  } });
  const service = require('../services/releaseResendVerificationService');
  const env = { VV_RESEND_RELEASE_VERIFY: 'true', VV_RESEND_RELEASE_TEST_ID: 'fixture-release-1',
    VV_RELEASE_TEST_RECIPIENT: 'Viralvekariya782@gmail.com', VV_RESEND_RELEASE_TEST_ISSUED_AT: '2026-11-12T12:00:00Z' };
  assert.deepEqual(await service.queueAuthorisedResendVerification({ env: {} }), { enabled: false });
  await assert.rejects(service.queueAuthorisedResendVerification({ env: { ...env, VV_RELEASE_TEST_RECIPIENT: 'unrelated@example.invalid' } }), { code: 'RESEND_RELEASE_RECIPIENT_NOT_AUTHORISED' });
  await assert.rejects(service.queueAuthorisedResendVerification({ env: { ...env, VV_RESEND_RELEASE_TEST_ID: '../unsafe' } }), { code: 'RESEND_RELEASE_ID_INVALID' });
  await assert.rejects(service.queueAuthorisedResendVerification({ env: { ...env, VV_RESEND_RELEASE_TEST_ISSUED_AT: '' } }), { code: 'RESEND_RELEASE_ISSUED_AT_REQUIRED' });
  provider = 'https_relay';
  await assert.rejects(service.queueAuthorisedResendVerification({ env }), { code: 'RESEND_RELEASE_TRANSPORT_REQUIRED' });
  assert.equal(queries.length, 0); assert.equal(rows.length, 0, 'Disabled, unauthorised or incorrectly configured fixtures must not access or change the queue');
  provider = 'resend';
  const snapshot = service.fixtureSnapshot('fixture-release-1', env.VV_RESEND_RELEASE_TEST_ISSUED_AT);
  assert.equal(snapshot.period_start, '2026-11-02'); assert.equal(snapshot.period_end, '2026-11-08'); assert.equal(snapshot.total_minutes, 930);
  assert.equal(snapshot.rows[0].break_minutes, null); assert.equal(snapshot.rows[1].break_minutes, 30);
  const first = await service.queueAuthorisedResendVerification({ env });
  assert.equal(rows.length, 2); assert.equal(documents.length, 1); assert.equal(first.enabled, true); assert.equal(first.recipient_verified, false);
  assert.deepEqual(first.messages.map(row => row.format), ['HTML','PDF']);
  assert.equal(first.messages[0].attachment_count, 0); assert.equal(first.messages[1].pdf.pages, 1);
  assert.equal(first.messages[1].pdf.content_type, 'application/pdf'); assert.match(first.messages[1].pdf.filename, /\.pdf$/);
  for (const text of ['fictional employee', 'FIXTURE-fixture-release-1', '15.50 (15h 30m)', 'Not recorded', '30 min', 'Provisional — Draft', 'Australia/Sydney']) {
    assert(rows[0].html_body.includes(text), 'HTML contains ' + text); assert(rows[0].text_body.includes(text), 'Plain text contains ' + text);
  }
  assert(rows[0].html_body.includes('https://app.voxelveda.com/logo.png'));
  assert.equal(documents[0].data.issueDate, '2026-11-12');
  assert.equal(new Set(rows.map(row => row.idempotency_key)).size, 2);
  const repeated = await service.queueAuthorisedResendVerification({ env });
  assert.equal(rows.length, 2); assert.equal(documents.length, 1); assert.deepEqual(repeated, first, 'Restart/repeated invocation returns the exact existing fixture without queueing again');
  rows[0].status = 'REVIEW_REQUIRED'; rows[1].status = 'FAILED';
  const held = await service.queueAuthorisedResendVerification({ env });
  assert.deepEqual(held.messages.map(row => row.status), ['REVIEW_REQUIRED','FAILED']); assert.equal(rows.length, 2, 'Uncertain and failed fixtures are never reset or resent by the verifier');
  await assert.rejects(service.queueAuthorisedResendVerification({ env: { ...env, VV_RESEND_RELEASE_TEST_ISSUED_AT: '2026-11-13T12:00:00Z' } }), { code: 'RESEND_RELEASE_FIXTURE_IMMUTABLE' });
  rows[0].status = 'SENT'; rows[0].provider_accepted_at = 'fixture-acceptance'; rows[0].message_id = 'fixture-resend-provider-id';
  const evidence = await service.readResendVerificationEvidence('fixture-release-1');
  assert.equal(evidence.messages[0].provider_accepted, true); assert.equal(evidence.messages[0].provider_message_id, 'fixture-resend-provider-id');
  assert.equal(evidence.messages[0].recipient_verified, false, 'Provider acceptance must never become inbox verification');
  assert.doesNotMatch(JSON.stringify(evidence), /Viralvekariya|gmail|fictional employee|base64|api_key|password/i);
  assert.ok(queries.every(sql => /^SELECT \* FROM email_queue/.test(sql)), 'Only exact fixture queue reads are permitted; no staff, attendance, customer or supplier data is read');
  rows[0].to_json = '["different@example.invalid"]';
  await assert.rejects(service.readResendVerificationEvidence('fixture-release-1'), { code: 'RESEND_RELEASE_FIXTURE_MISMATCH' });
  console.log('Release Resend verifier tests passed: explicit gate and approved inbox only; real HTML renderer/plain text and parser-valid PDF; fixture-only durable keys; immutable issue time; repeated/review/failed rows never resend; sanitized provider evidence never claims recipient receipt.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
