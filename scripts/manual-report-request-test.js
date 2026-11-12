'use strict';
// Durable Send-intent fixture: no real DB, provider, credentials or recipient.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const pdf = require('../services/documentPdfService');
const requests = new Map(), messages = [];
let queueStatus = 'PENDING', failRenderer = false, beforeQueueCount = 0;
const db = { async query(sql, values = []) {
  if (sql.startsWith('CREATE TABLE')) return [{}];
  if (sql.startsWith('INSERT INTO document_delivery_requests')) {
    if (!requests.has(values[0])) requests.set(values[0], { id: requests.size + 1, request_key: values[0], related_module: values[1], related_record_id: values[2], source_json: values[3], recipients_json: values[4], created_by: values[5], generation_status: 'PENDING', email_queue_id: null });
    return [{ affectedRows: 1 }];
  }
  if (sql.startsWith('SELECT * FROM document_delivery_requests')) return [[requests.get(values[0])]];
  if (sql.startsWith('SELECT id,status')) return [[{ id: values[0], status: queueStatus, message_id: queueStatus === 'SENT' ? 'fixture-provider-id' : null, provider_accepted_at: queueStatus === 'SENT' ? new Date() : null, last_error: queueStatus === 'FAILED' ? 'Fixture definite provider failure' : null }]];
  if (sql.startsWith('SELECT attachments_json')) {
    const part = messages[values[0] - 1].attachments[0];
    return [[{ attachments_json: JSON.stringify([{ filename: part.filename, contentType: part.contentType, contentDisposition: part.contentDisposition, content: part.content.toString('base64'), encoding: 'base64', byteLength: part.content.length, sha256: crypto.createHash('sha256').update(part.content).digest('hex') }]) }]];
  }
  const row = [...requests.values()].find(item => item.id === values.at(-1));
  if (sql.includes("generation_status='GENERATING'")) {
    if (!['PENDING','GENERATION_FAILED'].includes(row.generation_status)) return [{ affectedRows: 0 }];
    row.generation_status = 'GENERATING'; return [{ affectedRows: 1 }];
  }
  if (sql.includes("generation_status='VALIDATED'")) { Object.assign(row, { generation_status: 'VALIDATED', pdf_sha256: values[0], pdf_pages: values[1], email_queue_id: values[2] }); return [{ affectedRows: 1 }]; }
  if (sql.includes("generation_status='GENERATION_FAILED'")) { if (row.generation_status !== 'VALIDATED') { row.generation_status = 'GENERATION_FAILED'; row.last_error = values[0]; } return [{ affectedRows: 1 }]; }
  throw new Error('Unexpected request fixture SQL: ' + sql);
}, async getConnection() { return { query: db.query, async beginTransaction() {}, async commit() {}, async rollback() {}, release() {} }; } };
function load() {
  const filename = path.join(__dirname, '../services/documentDeliveryService.js'), module = { exports: {} };
  const dependencies = {
    'node:crypto': crypto, '../config/db': db,
    './documentPdfService': { ...pdf, async createDocumentPdf(data) { if (failRenderer) throw Object.assign(new Error('Fixture generation failed'), { code: 'PDF_GENERATION_FAILED' }); return pdf.createDocumentPdf(data); } },
    './emailQueueSchema': { async ensureEmailQueueSchema() {} },
    './emailQueue': { async queueEmail(message) { messages.push(message); return messages.length; }, restoreAttachments(parts) { return parts.map(item => ({ ...item, content: Buffer.from(item.content, 'base64') })); } }
  };
  const wrapper = new vm.Script('(function(require,module,exports){\n' + fs.readFileSync(filename, 'utf8') + '\n})', { filename }).runInThisContext();
  wrapper(name => { assert(Object.hasOwn(dependencies, name), name); return dependencies[name]; }, module, module.exports);
  return module.exports;
}
async function main() {
  const service = load();
  const data = { title: 'MANUAL REPORT REQUEST FIXTURE', reference: 'FIXTURE-MANUAL-1', filename: 'FIXTURE-MANUAL-1', issueDate: '2026-11-12', columns: [{ label: 'Record' }, { label: 'Value' }], rows: [['Fixture employee only', '8.00 hours']], notes: ['Synthetic fixture; no real employee information.'] };
  const artifact = await pdf.createDocumentPdf(data);
  const message = { module: 'workflow', recordId: 'manual:fixture-1', data, to: ['intended@example.invalid'], subject: 'Fixture manual report', text: 'The fixture PDF is attached.', createdBy: 71, requestIdentity: 'manual:71:54f85438-0971-4b21-9e22-7ce75fda082a', idempotencyKey: 'manual-report:fixture:54f85438-0971-4b21-9e22-7ce75fda082a', validatedArtifact: { buffer: artifact.buffer, filename: artifact.filename, sha256: artifact.validation.sha256 }, beforeQueue: async () => { beforeQueueCount += 1; } };
  await assert.rejects(() => service.queueDocumentEmail({ ...message, requestIdentity: '../bad request' }), { code: 'DOCUMENT_SEND_ID_INVALID' });
  assert.equal(messages.length, 0);
  const concurrent = await Promise.all([service.queueDocumentEmail(message), service.queueDocumentEmail(message)]);
  assert.equal(messages.length, 1, 'Atomic generation claim must prevent overlapping requests from inserting duplicate messages');
  assert.equal(requests.size, 1); assert.equal(beforeQueueCount, 1); assert(concurrent.some(value => value.email_queued));
  const repeated = await service.queueDocumentEmail(message); assert.equal(repeated.existing, true); assert.equal(repeated.email_queue_id, 1); assert.equal(messages.length, 1);
  const restarted = load();
  const afterRestart = await restarted.queueDocumentEmail(message); assert.equal(afterRestart.email_queue_id, 1); assert.equal(messages.length, 1, 'A fresh service process must reuse the durable Send intent');
  for (const changed of [
    { to: ['different@example.invalid'] },
    { data: { ...data, reference: 'FIXTURE-CHANGED' } },
    { recordId: 'manual:fixture-2' },
    { createdBy: 72 }
  ]) await assert.rejects(() => service.queueDocumentEmail({ ...message, ...changed }), { code: 'DOCUMENT_SEND_ID_CONFLICT' });
  assert.equal(messages.length, 1, 'Changing a Send intent cannot create another recipient or attachment');
  queueStatus = 'REVIEW_REQUIRED';
  const uncertain = await service.queueDocumentEmail(message); assert.equal(uncertain.email_queued, false); assert.equal(uncertain.email_status, 'REVIEW_REQUIRED'); assert.match(service.deliveryMessage(uncertain), /No automatic resend/); assert.equal(messages.length, 1);
  queueStatus = 'SENT';
  const accepted = await service.queueDocumentEmail(message); assert.equal(accepted.provider_accepted, true); assert.equal(accepted.recipient_verified, false); assert.equal(messages.length, 1);
  queueStatus = 'FAILED';
  const failed = await service.queueDocumentEmail(message); assert.equal(failed.email_queued, false); assert.equal(failed.last_error, 'Fixture definite provider failure'); assert.match(service.deliveryMessage(failed), /failed/); assert.equal(messages.length, 1);
  failRenderer = true;
  const next = { ...message, requestIdentity: 'manual:71:195004a7-1b1f-46ab-af3f-e6bf087797cd', idempotencyKey: 'manual-report:fixture:195004a7-1b1f-46ab-af3f-e6bf087797cd' };
  const frozen = await service.queueDocumentEmail(next); assert.equal(frozen.email_queued, true); assert.equal(messages.length, 2); assert.deepEqual(messages[1].attachments[0].content, artifact.buffer, 'Frozen bytes must remain sendable without re-rendering');
  const nodemailer = require('nodemailer');
  const mime = (await nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' }).sendMail({ from: 'Voxel Veda <info@voxelveda.com>', to: messages[0].to, subject: messages[0].subject, text: messages[0].text, attachments: messages[0].attachments })).message.toString('utf8');
  assert.equal((mime.match(/Content-Disposition: attachment/g) || []).length, 1); assert.match(mime, /Content-Type: application\/pdf; name=FIXTURE-MANUAL-1.pdf/); assert.doesNotMatch(mime, /^Cc:|^Bcc:|\.tmp|application\/octet-stream/mi);
  const part = mime.split(/--[^\n]+\n/).find(value => /Content-Type: application\/pdf/.test(value)); assert(part);
  const decoded = Buffer.from(part.split('\n\n')[1].trim(), 'base64'); assert.deepEqual(decoded, artifact.buffer); await pdf.validateDocumentPdf(decoded, data);
  failRenderer = false;
  const invalid = { ...message, requestIdentity: 'manual:71:5e471bb6-8acb-4d38-81b2-f5014c5fe760', validatedArtifact: { ...message.validatedArtifact, buffer: Buffer.from('<html>Not a PDF</html>') } };
  await assert.rejects(() => service.queueDocumentEmail(invalid), /PDF bytes/); assert.equal(messages.length, 2);
  console.log('Manual report request passed: durable actor/request binding; recipient/source/record conflicts; concurrent and restart-style retry deduplication; uncertain/accepted/failed outcomes held; frozen PDF bytes and decoded MIME; no non-PDF fallback.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
