'use strict';
// Synthetic records only. These tests do not use a database, network or inbox.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const authorization = require('../services/authorizationService');
const customerScope = require('../services/customerRecordScope');
const pdf = require('../services/documentPdfService');
const { stableJsonText } = require('../services/auditService');
const UUID = 'd32bf966-c48a-4cf2-9f84-dc5ca1f6e46b';
function load(relative, dependencies) {
  const filename = path.join(__dirname, '..', relative), module = { exports: {} };
  const wrapper = new vm.Script('(function(require,module,exports){\n' + fs.readFileSync(filename, 'utf8') + '\n})', { filename }).runInThisContext();
  wrapper(name => { if (!Object.hasOwn(dependencies, name)) throw new Error('Unexpected fixture dependency: ' + name); return dependencies[name]; }, module, module.exports);
  return module.exports;
}
function permissions(...values) { return { id: 71, role: 'fixture', email: 'owner@example.invalid', permissions: values }; }
function fixture() {
  const snapshots = new Map(), storage = new Map(), queued = [], audits = [], reads = [], invoiceLocks = [], invoiceActivity = [];
  const heldLocks = new Map();
  const state = { sourceChanged: false, corrupt: false, invoiceDraft: false, invoiceStatus: 'approved', invoiceDeleted: false };
  const staff = permissions('SEND_COMPANY_EMAIL', 'VIEW_RFQS', 'VIEW_FINANCE', 'EDIT_FINANCE');
  const records = Array.from({ length: 205 }, (_, index) => ({ id: index + 1, customer_name: 'Fixture customer ' + (index + 1), email: 'customer@example.invalid', material: 'Fixture nylon', quantity: index + 1, status: 'pending', created_at: '2026-11-01' }));
  const db = { pool: { config: { connectionLimit: 10 } }, async query(sql, values = []) {
    if (sql.includes('SELECT GET_LOCK')) {
      const key = values[0];
      if (!heldLocks.has(key)) { heldLocks.set(key, []); return [[{ acquired: 1 }]]; }
      return [[{ acquired: 0 }]];
    }
    if (sql.includes('SELECT RELEASE_LOCK')) {
      const key = values[0], waiters = heldLocks.get(key);
      if (waiters?.length) waiters.shift()(); else heldLocks.delete(key);
      return [[{ released: 1 }]];
    }
    if (sql.startsWith('INSERT INTO manual_report_snapshots')) {
      const columns = ['id','created_by','source_type','descriptor_json','document_json','authority_sha256','source_sha256','pdf_storage_key','pdf_sha256','pdf_pages','filename'];
      snapshots.set(values[0], { ...Object.fromEntries(columns.map((key, index) => [key, values[index]])), created_at: new Date('2026-11-12T00:00:00Z') });
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('SELECT * FROM manual_report_snapshots')) return [[snapshots.get(values[0])].filter(Boolean)];
    if (sql.startsWith('SELECT q.id email_queue_id')) {
      assert.match(sql, /JOIN manual_report_snapshots m/); assert.match(sql, /m.authority_sha256=\?/); assert.match(sql, /LOWER\(q.to_json\)=LOWER\(\?\)/);
      const previous = [...queued].reverse().find(item => {
        const snapshotId = item.idempotencyKey.match(/^manual-report:([^:]+):/)?.[1], snapshot = snapshots.get(snapshotId);
        return snapshot && Number(snapshot.created_by) === Number(values[0]) && snapshot.authority_sha256 === values[1] && JSON.stringify(item.to).toLowerCase() === String(values[2]).toLowerCase();
      });
      if (!previous) return [[]];
      const index = queued.indexOf(previous), snapshotId = previous.idempotencyKey.match(/^manual-report:([^:]+):/)[1];
      return [[{ email_queue_id: index + 1, email_status: previous.status || 'PENDING', message_id: previous.message_id || null, provider_accepted_at: previous.provider_accepted_at || null, recipient_verified_at: null, document_request_id: index + 1, request_key: crypto.createHash('sha256').update([previous.module,'send-intent',previous.requestIdentity].join('\n')).digest('hex'), snapshot_id: snapshotId }]];
    }

    if (sql.startsWith('SELECT id,status,deleted FROM invoices')) { invoiceLocks.push({ sql, values }); return [[{ id: values[0], status: state.invoiceStatus, deleted: state.invoiceDeleted }]]; }
    if (sql.startsWith('INSERT INTO invoice_activity')) { invoiceActivity.push([...values]); return [{ affectedRows: 1 }]; }
    if (sql.startsWith('SELECT r.id request_id')) return [[...queued.filter(item => item.module === values[0] && item.recordId === values[1] && item.createdBy === values[2] && item.validatedArtifact.sha256 === values[3] && (!values[4] || crypto.createHash('sha256').update([item.module,'send-intent',item.requestIdentity].join('\n')).digest('hex') === values[4])).map((item, index) => ({ request_id: index + 1, generation_status: 'VALIDATED', pdf_sha256: item.validatedArtifact.sha256, email_queue_id: index + 1, email_status: 'PENDING', created_at: new Date(), provider_accepted_at: null, recipient_verified_at: null }))]];
    throw new Error('Unexpected fixture SQL: ' + sql);
  }, async getConnection() { return { query: db.query, async beginTransaction() {}, async commit() {}, async rollback() {}, release() {} }; } };
  const rfqSource = { async getRFQs(req, res) {
    reads.push({ query: { ...req.query }, user: req.user.id });
    let source = records.map(row => state.sourceChanged && row.id === 205 ? { ...row, customer_name: 'Changed authoritative customer' } : row);
    if (req.user.role === 'customer') source = source.filter(row => row.email === req.user.email);
    const page = Number(req.query.page), limit = Number(req.query.limit);
    return res.json({ rfqs: source.slice((page - 1) * limit, page * limit), page, limit, total: source.length });
  } };
  const originalReports = load('controllers/originalReportController.js', {
    '../services/authorizationService': authorization, '../config/db': db,
    '../services/attendanceRecordedTotals': require('../services/attendanceRecordedTotals'),
    '../services/customerRecordScope': customerScope,
    '../services/documentPdfService': pdf, './rfqController': rfqSource
  });
  const invoiceController = { async viewInvoicePdf(req, res) {
    customerScope.assertCustomerRecord(req.user, 'owner@example.invalid');
    const data = { title: state.invoiceDraft ? 'DRAFT INVOICE' : 'INVOICE', reference: 'FIXTURE-INV-' + req.params.id, filename: 'FIXTURE-INV-' + req.params.id, customerEmail: 'owner@example.invalid', issueDate: '2026-11-01', party: 'Fixture customer | owner@example.invalid', columns: [{ label: 'Description' }, { label: 'Amount' }], rows: [['Fixture approved item', 'AUD 12.34']], totals: [{ label: 'Total', value: 'AUD 12.34' }] };
    return pdf.sendPdfResponse(res, await pdf.createDocumentPdf(data));
  } };
  const dependencies = {
    'node:crypto': crypto, '../config/db': db, './authorizationService': authorization, './customerRecordScope': customerScope,
    './auditService': { stableJsonText, async logAudit(_db, entry) { audits.push(entry); } },
    './documentPdfService': pdf,
    './emailQueueSchema': { async ensureEmailQueueSchema() {} },
    './objectStorageService': { isConfigured() { return true; }, async putObject(key, bytes, contentType) { assert.equal(contentType, 'application/pdf'); storage.set(key, Buffer.from(bytes)); }, async getObject(key) { assert(storage.has(key), 'Private storage object must exist'); return Buffer.from(storage.get(key)); } },
    './emailService': { validateRecipients(value) { if (typeof value !== 'string' || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value)) throw Object.assign(new Error('Invalid recipient'), { status: 422, code: 'REPORT_EMAIL_RECIPIENT_INVALID' }); return [value.toLowerCase()]; } },
    './documentDeliveryService': {
      async ensureDocumentDeliverySchema() {},
      deliveryMessage(value) { return value.email_queued ? 'Report PDF validated and queued for email delivery.' : 'Report not queued.'; },
      async queueDocumentEmail(message) {
        if (message.beforeQueue) await message.beforeQueue(db);
        const previous = queued.find(item => item.requestIdentity === message.requestIdentity);
        if (previous) {
          assert.equal(previous.recordId, message.recordId); assert.deepEqual(previous.to, message.to); assert.deepEqual(previous.validatedArtifact.buffer, message.validatedArtifact.buffer);
          return { email_queued: true, email_queue_id: queued.indexOf(previous) + 1, existing: true };
        }
        queued.push(message);
        if (message.afterQueue) await message.afterQueue(db, queued.length, queued.length);
        return { email_queued: true, email_queue_id: queued.length, existing: false };
      }
    },
    '../controllers/originalReportController': originalReports,
    '../controllers/invoiceController': invoiceController,
    './qmsRegisterService': { catalog() { return []; } }
  };
  const service = load('services/manualReportEmailService.js', dependencies);
  const request = user => ({ user: user || staff, ip: '127.0.0.1', get() { return 'Synthetic fixture'; } });
  return { service, reload: () => load('services/manualReportEmailService.js', dependencies), request, staff, state, snapshots, storage, queued, audits, reads, invoiceLocks, invoiceActivity, heldLocks };
}
async function main() {
  const f = fixture(), { service } = f;
  for (const input of [
    { type: 'url', url: 'http://127.0.0.1/admin' },
    { type: 'invoice', record_id: 1, url: 'https://example.invalid/document.pdf' },
    { type: 'invoice', record_id: 1, html: '<h1>Untrusted</h1>' },
    { type: 'invoice', record_id: 1, buffer: Buffer.from('%PDF-') },
    { type: 'weekly-timesheet', record_id: 71 },
    { type: 'register', report: 'finance' },
    { type: 'register', report: 'erp' },
    { type: 'invoice', record_id: '../1' },
    { type: 'register', report: 'rfqs', filters: { q: { bad: true } } }
  ]) assert.throws(() => service._test.descriptor(input), /not supported|not applicable|valid|support manual/);
  assert.deepEqual(service._test.descriptor({ type: 'register', report: 'rfqs', filters: { q: 'Fixture', status: 'pending' } }), { type: 'register', report: 'rfqs', filters: { q: 'Fixture', status: 'pending' } });
  assert.throws(() => service._test.authorised(permissions('VIEW_RFQS'), { type: 'register', report: 'rfqs' }), { code: 'PERMISSION_DENIED' });
  assert.throws(() => service._test.authorised(permissions('SEND_COMPANY_EMAIL'), { type: 'invoice' }), { code: 'PERMISSION_DENIED' });
  for (const grants of [['VIEW_FINANCE','EDIT_FINANCE'],['VIEW_FINANCE','SEND_COMPANY_EMAIL'],['EDIT_FINANCE','SEND_COMPANY_EMAIL']]) await assert.rejects(() => service.prepare(f.request(permissions(...grants)), { type: 'invoice', record_id: 9 }), { code: 'PERMISSION_DENIED' });
  const catalog = service.catalog(f.staff); assert(catalog.reports.some(item => item.type === 'invoice')); assert(catalog.registers.includes('rfqs')); assert(!catalog.reports.some(item => item.type === 'weekly-timesheet')); assert(!catalog.registers.includes('staff'));
  const prepared = await service.prepare(f.request(), { type: 'register', report: 'rfqs', filters: { q: 'Fixture', status: 'pending', sort: 'id', direction: 'asc' } });
  assert.equal(f.queued.length, 0, 'Preparing a preview must never send email');
  assert.match(prepared.filename, /\.pdf$/); assert.match(prepared.sha256, /^[a-f0-9]{64}$/); assert.equal(prepared.generation_status, 'VALIDATED');
  assert.equal(f.snapshots.size, 1); assert.equal(f.snapshots.get(prepared.snapshot_id).pdf_bytes, undefined, 'PDF originals belong in private durable storage, not database blobs'); assert.equal(f.storage.size, 1); assert.equal(f.reads.length, 3, 'The original report must load every matching page, including row 205');
  for (const read of f.reads) { assert.equal(read.query.q, 'Fixture'); assert.equal(read.query.status, 'pending'); assert.equal(read.query.limit, '100'); assert.equal(read.user, f.staff.id); }
  const saved = await service.getSnapshot(f.request(), prepared.snapshot_id);
  assert.equal(saved.artifact.sha256, prepared.sha256);
  const parsed = await pdf.validatePdf(saved.artifact.buffer, { expectedText: ['Fixture customer 1', 'Fixture customer 205', '205 records.'] });
  assert(parsed.pages > 1, 'Populated original report must have multiple parser-valid pages');
  assert.equal(parsed.sha256, prepared.sha256);
  const input = { to: 'intended@example.invalid', expected_sha256: prepared.sha256, request_id: UUID };
  for (const to of ['', 'a@example.invalid,b@example.invalid', 'a@example.invalid; b@example.invalid', 'Name <a@example.invalid>', 'a@example.invalid\r\nBcc:b@example.invalid', ['a@example.invalid']]) {
    await assert.rejects(() => service.send(f.request(), prepared.snapshot_id, { ...input, to }), /exactly one|Invalid recipient/);
  }
  await assert.rejects(() => service.send(f.request(), prepared.snapshot_id, { ...input, cc: 'copy@example.invalid' }), /not supported/);
  await assert.rejects(() => service.send(f.request(), prepared.snapshot_id, { ...input, bcc: 'copy@example.invalid' }), /not supported/);
  await assert.rejects(() => service.send(f.request(), prepared.snapshot_id, { ...input, request_id: 'unsafe' }), { code: 'DOCUMENT_SEND_ID_INVALID' });
  await assert.rejects(() => service.send(f.request(), prepared.snapshot_id, { ...input, expected_sha256: '0'.repeat(64) }), { code: 'PDF_DOCUMENT_CHANGED' });
  const beforeSends = f.queued.length;
  await assert.rejects(() => service.getSnapshot(f.request({ ...f.staff, id: 72 }), prepared.snapshot_id), { code: 'REPORT_EMAIL_NOT_FOUND' });
  await assert.rejects(() => service.getSnapshot(f.request(permissions('VIEW_RFQS')), prepared.snapshot_id), { code: 'PERMISSION_DENIED' });
  assert.equal(f.queued.length, beforeSends);
  const sent = await service.send(f.request(), prepared.snapshot_id, input);
  assert.equal(sent.email_sent, false); assert.equal(sent.email_queued, true); assert.equal(f.queued.length, 1);
  const message = f.queued[0];
  assert.deepEqual(message.to, ['intended@example.invalid']); assert.equal(message.cc, undefined); assert.equal(message.bcc, undefined); assert.equal(message.deliveryPolicy, undefined);
  assert.equal(message.module, 'workflow'); assert.match(message.requestIdentity, /^manual:71:/); assert.match(message.idempotencyKey, /^manual-report:/);
  assert.deepEqual(message.validatedArtifact.buffer, saved.artifact.buffer, 'Preview/download and email must preserve exact bytes');
  assert.equal(message.validatedArtifact.sha256, prepared.sha256); assert.equal(message.validatedArtifact.filename, prepared.filename);
  await service.send(f.request(), prepared.snapshot_id, input); assert.equal(f.queued.length, 1, 'A repeated Send intent must reuse its queued message');
  const status = await service.status(f.request(), prepared.snapshot_id); assert.equal(status.sends.length, 1); assert.equal(status.sends[0].provider_accepted, false); assert.equal(status.sends[0].recipient_verified, false);
  f.state.sourceChanged = true;
  await assert.rejects(() => service.getSnapshot(f.request(), prepared.snapshot_id), { code: 'REPORT_EMAIL_SOURCE_CHANGED' });
  await assert.rejects(() => service.send(f.request(), prepared.snapshot_id, { ...input, to: 'source-change@example.invalid', request_id: crypto.randomUUID() }), { code: 'REPORT_EMAIL_SOURCE_CHANGED' });
  assert.equal(f.queued.length, 1, 'Changed authorised rows cannot enqueue an unreviewed report');
  f.state.sourceChanged = false;
  const row = f.snapshots.get(prepared.snapshot_id), originalStorageKey = f.snapshots.get(prepared.snapshot_id).pdf_storage_key;
  row.pdf_storage_key = '../another-owner/report.pdf';
  await assert.rejects(() => service.getSnapshot(f.request(), prepared.snapshot_id), { code: 'PDF_SNAPSHOT_MISMATCH' }); row.pdf_storage_key = originalStorageKey;
  const originalBytes = f.storage.get(row.pdf_storage_key);
  f.storage.set(row.pdf_storage_key, Buffer.concat([originalBytes, Buffer.from('\n% fixture changed bytes\n')]));
  await assert.rejects(() => service.getSnapshot(f.request(), prepared.snapshot_id), { code: 'PDF_SNAPSHOT_MISMATCH' }); f.storage.set(row.pdf_storage_key, originalBytes);
  await assert.rejects(() => service.prepare(f.request(), { type: 'register', report: 'rfqs', filters: {}, expected_sha256: '0'.repeat(64) }), { code: 'PDF_DOCUMENT_CHANGED' });
  const customer = { ...f.staff, role: 'customer' }, customerReq = f.request(customer);
  const ownInvoice = await service.prepare(customerReq, { type: 'invoice', record_id: 9 });
  await assert.rejects(() => service.send(customerReq, ownInvoice.snapshot_id, { ...input, expected_sha256: ownInvoice.sha256, request_id: crypto.randomUUID(), to: 'other@example.invalid' }), { code: 'REPORT_EMAIL_RECIPIENT_FORBIDDEN' });
  await assert.rejects(() => service.prepare(f.request({ ...customer, email: 'other@example.invalid' }), { type: 'invoice', record_id: 9 }), { code: 'CUSTOMER_RECORD_NOT_FOUND' });
  await assert.rejects(() => service.getSnapshot(f.request({ ...customer, email: 'other@example.invalid' }), ownInvoice.snapshot_id), { code: 'CUSTOMER_RECORD_NOT_FOUND' });
  await assert.rejects(() => service._test.capture(async(_req, res) => res.status(422).json({ message: 'Fixture PDF generation failed', code: 'PDF_GENERATION_FAILED' }), f.request()), { code: 'PDF_GENERATION_FAILED' });
  await assert.rejects(() => service._test.capture(async(_req, res) => res.send(Buffer.from('<html>Unexpected page</html>')), f.request()), { code: 'REPORT_EMAIL_SOURCE_FAILED' });
  const priorInvoiceSends = f.queued.length;
  f.state.invoiceStatus = 'draft';
  await assert.rejects(() => service.send(f.request(), ownInvoice.snapshot_id, { ...input, expected_sha256: ownInvoice.sha256, request_id: crypto.randomUUID() }), { code: 'REPORT_EMAIL_APPROVAL_REQUIRED' });
  assert.equal(f.queued.length, priorInvoiceSends, 'A status change before queueing must block invoice email');
  for (const invoiceStatus of ['approved','sent','paid']) {
    f.state.invoiceStatus = invoiceStatus;
    const invoiceInput = { ...input, to: invoiceStatus + '@example.invalid', expected_sha256: ownInvoice.sha256, request_id: crypto.randomUUID() };
    const result = await service.send(f.request(), ownInvoice.snapshot_id, invoiceInput);
    assert.equal(result.email_queued, true);
    const queuedInvoice = f.queued.at(-1); assert.equal(queuedInvoice.module, 'invoices'); assert.equal(queuedInvoice.recordId, '9'); assert.equal(queuedInvoice.createdBy, f.staff.id);
    assert.match(f.invoiceLocks.at(-1).sql, /FOR UPDATE$/); assert.deepEqual(f.invoiceLocks.at(-1).values, ['9']);
    const activity = f.invoiceActivity.at(-1); assert.equal(activity[0], '9'); assert.equal(activity[1], 'email_queued'); assert.equal(activity[3], f.staff.id);
    const activityCount = f.invoiceActivity.length; await service.send(f.request(), ownInvoice.snapshot_id, invoiceInput); assert.equal(f.invoiceActivity.length, activityCount, 'Repeated Send must not duplicate original invoice activity');
  }
  assert.equal(f.invoiceActivity.length, 3);
  const invoiceStatusResult = await service.status(f.request(), ownInvoice.snapshot_id); assert.equal(invoiceStatusResult.sends.length, 3);
  // A reopened dialog/new snapshot/request ID cannot duplicate the same report
  // to the same recipient, including after process restart or uncertain outcome.
  const freshOne = await service.prepare(f.request(), { type: 'invoice', record_id: 10 });
  const freshTwo = await service.prepare(f.request(), { type: 'invoice', record_id: 10 });
  assert.notEqual(freshOne.snapshot_id, freshTwo.snapshot_id);
  assert.equal(f.snapshots.get(freshOne.snapshot_id).authority_sha256, f.snapshots.get(freshTwo.snapshot_id).authority_sha256);
  const concurrentTo = 'concurrent@example.invalid', countBeforeConcurrent = f.queued.length;
  const attempts = await Promise.allSettled([
    service.send(f.request(), freshOne.snapshot_id, { to: concurrentTo, expected_sha256: freshOne.sha256, request_id: crypto.randomUUID() }),
    service.send(f.request(), freshTwo.snapshot_id, { to: concurrentTo, expected_sha256: freshTwo.sha256, request_id: crypto.randomUUID() })
  ]);
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(item => item.status === 'rejected').length, 1);
  assert(['REPORT_EMAIL_EXISTING_DELIVERY','REPORT_EMAIL_SEND_BUSY'].includes(attempts.find(item => item.status === 'rejected').reason.code));
  await assert.rejects(() => service.send(f.request(), freshTwo.snapshot_id, { to: concurrentTo, expected_sha256: freshTwo.sha256, request_id: crypto.randomUUID() }), { code: 'REPORT_EMAIL_EXISTING_DELIVERY' });
  assert.equal(f.queued.length, countBeforeConcurrent + 1, 'Concurrent new dialogs must queue only one source/recipient delivery');
  const priorConcurrent = f.queued.find(item => item.recordId === '10');
  priorConcurrent.status = 'REVIEW_REQUIRED';
  await assert.rejects(() => service.send(f.request(), freshTwo.snapshot_id, { to: concurrentTo, expected_sha256: freshTwo.sha256, request_id: crypto.randomUUID() }), { code: 'DELIVERY_REVIEW_REQUIRED' });
  assert.equal(f.queued.length, countBeforeConcurrent + 1);
  priorConcurrent.status = 'SENT'; priorConcurrent.provider_accepted_at = new Date(); priorConcurrent.message_id = 'fixture-provider-accepted';
  const restartedService = f.reload();
  await assert.rejects(() => restartedService.send(f.request(), freshTwo.snapshot_id, { to: concurrentTo, expected_sha256: freshTwo.sha256, request_id: crypto.randomUUID() }), { code: 'REPORT_EMAIL_EXISTING_DELIVERY' });
  assert.equal(f.queued.length, countBeforeConcurrent + 1, 'Accepted history must survive a new service instance and dialog');
  const originalSnapshotId = priorConcurrent.idempotencyKey.match(/^manual-report:([^:]+):/)[1];
  const reconciledOriginal = await restartedService.send(f.request(), originalSnapshotId, { to: concurrentTo, expected_sha256: f.snapshots.get(originalSnapshotId).pdf_sha256, request_id: priorConcurrent.requestIdentity.split(':').at(-1) });
  assert.equal(reconciledOriginal.existing, true); assert.equal(f.queued.length, countBeforeConcurrent + 1, 'The exact original request may reconcile without another message');
  assert.equal(f.heldLocks.size, 0, 'All successful and failed send paths must release their advisory locks');
  f.state.invoiceDraft = true;
  await assert.rejects(() => service.prepare(f.request(), { type: 'invoice', record_id: 9 }), { code: 'REPORT_EMAIL_APPROVAL_REQUIRED' });
  assert(f.audits.some(entry => entry.action === 'REPORT_EMAIL_SNAPSHOT_PREPARED')); assert(f.audits.some(entry => entry.action === 'REPORT_EMAIL_QUEUED'));
  console.log('Manual report email passed: strict typed source allowlist; current permissions and ownership; complete 205-row multipage source; durable immutable preview/download/email bytes; explicit one-recipient privacy; no weekly override; changed-source and tamper rejection; no email on prepare; safe request/status/audit outcomes; invoice source permissions, locked approved/sent/paid lifecycle and original activity; cross-intent/source/recipient concurrency and prior-outcome protection.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
