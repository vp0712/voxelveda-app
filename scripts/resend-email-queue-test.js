'use strict';
// Synthetic durable queue fixture: no provider, mailbox or production data.
const assert = require('node:assert/strict');
const actual = require('../services/emailService');
const pdf = require('../services/documentPdfService');

async function main() {
  let selected = 'resend';
  let nextId = 1;
  const rows = [];
  const logs = [];
  const sent = [];
  const failures = new Map();
  const bookkeepingFailures = new Set();
  const db = { async query(sql, values = []) {
    const query = sql.replace(/\s+/g, ' ').trim();
    if (query.startsWith('INSERT INTO email_queue')) {
      const columns = ['template_key','to_json','cc_json','bcc_json','reply_to','subject','html_body','text_body','attachments_json','delivery_policy_json','related_module','related_record_id','scheduled_at','idempotency_key','created_by'];
      if (values[13] && rows.some(row => row.idempotency_key === values[13])) throw Object.assign(new Error('Fixture duplicate'), { code: 'ER_DUP_ENTRY' });
      const row = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
      rows.push({ ...row, id: nextId++, status: 'PENDING', attempts: 0, max_attempts: 3 });
      return [{ insertId: rows.at(-1).id }];
    }
    if (/^SELECT (?:\*|id) FROM email_queue WHERE idempotency_key/.test(query)) return [[rows.find(row => row.idempotency_key === values[0])].filter(Boolean)];
    if (query.startsWith('UPDATE email_queue q LEFT JOIN')) {
      for (const row of rows.filter(row => row.status === 'SENDING' && row.stale)) { row.status = 'REVIEW_REQUIRED'; row.next_attempt_at = null; }
      return [{ affectedRows: 0 }];
    }
    if (query.startsWith('SELECT * FROM email_queue')) return [rows.filter(row => ['PENDING','RETRY'].includes(row.status) && !row.future).map(row => ({ ...row }))];
    if (query.startsWith("UPDATE email_queue SET status = 'SENDING'")) {
      const row = rows.find(row => row.id === values[0]);
      if (!row || !['PENDING','RETRY'].includes(row.status) || row.future || (query.includes('attempts < max_attempts') && row.attempts >= row.max_attempts)) return [{ affectedRows: 0 }];
      row.status = 'SENDING'; row.attempts += 1;
      return [{ affectedRows: 1 }];
    }
    if (query.startsWith("UPDATE email_queue SET status = 'SENT'")) {
      const row = rows.find(row => row.id === values[1]);
      if (bookkeepingFailures.delete(row.id)) throw new Error('Fixture lost bookkeeping acknowledgement');
      row.status = 'SENT'; row.message_id = values[0]; row.provider_accepted_at = 'fixture-accepted';
      return [{ affectedRows: 1 }];
    }
    if (query.startsWith("UPDATE email_queue SET status='REVIEW_REQUIRED',provider_accepted_at=")) {
      const row = rows.find(row => row.id === values.at(-1));
      row.status = 'REVIEW_REQUIRED'; row.last_error = values[1]; row.next_attempt_at = null;
      if (values[0]) row.provider_accepted_at ||= 'fixture-accepted';
      row.message_id ??= values[2];
      return [{ affectedRows: 1 }];
    }
    if (query.startsWith('UPDATE email_queue SET status = ?')) {
      const row = rows.find(row => row.id === values.at(-1));
      row.status = values[0]; row.last_error = values[1]; row.retryMinutes = values[3];
      return [{ affectedRows: 1 }];
    }
    if (query.startsWith('INSERT INTO email_logs')) { logs.push(values); return [{ insertId: logs.length }]; }
    if (query.startsWith('UPDATE invoices')) return [{ affectedRows: 0 }];
    throw new Error('Unexpected Resend queue fixture SQL: ' + query);
  } };
  const install = (name, exports) => { const id = require.resolve(name); require.cache[id] = { id, filename: id, loaded: true, exports }; };
  install('../config/db', db);
  install('../services/emailQueueSchema', { async ensureEmailQueueSchema() {} });
  install('../services/emailService', { ...actual, selectedEmailTransport: () => selected,
    async sendMail(message) {
      sent.push(message);
      const failure = failures.get(message.subject);
      if (failure) throw failure;
      return { messageId: 'fixture-provider-' + sent.length };
    }
  });
  const queue = require('../services/emailQueue');
  const message = (reference, overrides = {}) => ({ templateKey: 'release_queue_fixture', relatedModule: 'security',
    to: 'fixture@example.invalid', subject: reference, html: '<p>Queue fixture</p>', text: 'Queue fixture',
    idempotencyKey: 'fixture:' + reference, ...overrides });
  const enqueue = async (reference, overrides) => { const id = await queue.queueEmail(message(reference, overrides)); return rows.find(row => row.id === id); };

  // Adding the provider key alone leaves the explicitly selected relay intact.
  selected = 'https_relay';
  const legacy = await enqueue('legacy pending');
  assert.equal(legacy.delivery_policy_json, null);
  const legacyRetry = await enqueue('legacy retry'); legacyRetry.status = 'RETRY'; legacyRetry.attempts = 2;
  const expiredAuth = await enqueue('old password reset', { relatedModule: 'auth', templateKey: 'password_reset' });
  selected = 'resend';
  const accepted = await enqueue('already accepted'); accepted.provider_accepted_at = 'fixture-prior-provider';
  const changed = await enqueue('changed body'); changed.html_body = '<p>Changed after queueing</p>';
  const oldProvider = await enqueue('wrong provider');
  const oldPolicy = JSON.parse(oldProvider.delivery_policy_json); oldPolicy.queueTransport.provider = 'https_relay'; oldProvider.delivery_policy_json = JSON.stringify(oldPolicy);
  const normal = await enqueue('valid immutable');
  const binding = JSON.parse(normal.delivery_policy_json).queueTransport;
  assert.equal(binding.provider, 'resend'); assert.equal(binding.version, 1); assert.match(binding.payloadSha256, /^[a-f0-9]{64}$/);
  assert.equal(await queue.queueEmail(message('valid immutable')), normal.id, 'Same key and same payload must return the saved delivery');
  await assert.rejects(queue.queueEmail(message('valid immutable', { text: 'A different version' })), error => error.reasonCode === 'QUEUE_IDEMPOTENCY_CONFLICT');
  const first = await queue.processEmailQueue();
  assert.deepEqual(first.map(row => row.status), ['REVIEW_REQUIRED','REVIEW_REQUIRED','REVIEW_REQUIRED','REVIEW_REQUIRED','REVIEW_REQUIRED','REVIEW_REQUIRED','SENT']);
  assert.equal(sent.length, 1, 'Historical provider queues, stale auth, accepted and changed messages must not be drained through Resend');
  assert.equal(sent[0].deliveryKey, normal.idempotency_key);
  assert.equal(sent[0].html, '<p>Queue fixture</p>'); assert.equal(sent[0].deliveryPolicy, null, 'Queue metadata must not become a document or provider policy');
  assert.equal(legacy.status, 'REVIEW_REQUIRED'); assert.match(legacy.last_error, /no approved transport binding/);
  assert.equal(legacyRetry.status, 'REVIEW_REQUIRED'); assert.equal(expiredAuth.status, 'REVIEW_REQUIRED');
  assert.equal((await queue.processEmailQueue()).length, 0, 'Restart must leave historical rows held without automatic backfill');

  const uncertain = await enqueue('uncertain');
  failures.set('uncertain', Object.assign(new Error('Fixture connection closed after request'), { code: 'RESEND_REQUEST_UNCERTAIN' }));
  assert.equal((await queue.processEmailQueue())[0].status, 'REVIEW_REQUIRED');
  const countAfterUncertain = sent.length;
  assert.equal((await queue.processEmailQueue()).length, 0); assert.equal(sent.length, countAfterUncertain, 'Uncertain outcomes must remain held even beyond a provider idempotency window');
  assert.equal(uncertain.status, 'REVIEW_REQUIRED');

  const limited = await enqueue('known rate limit');
  failures.set('known rate limit', Object.assign(new Error('Fixture rate limit'), { code: 'RESEND_RATE_LIMITED', retryable: true, deliveryOutcome: 'NOT_ACCEPTED', retryAfterMs: 125000 }));
  assert.equal((await queue.processEmailQueue())[0].status, 'RETRY');
  assert.equal(limited.retryMinutes, 3, 'A proven negative 429 must respect Retry-After instead of retrying early');
  assert.equal((await queue.processEmailQueue())[0].status, 'RETRY');
  assert.equal((await queue.processEmailQueue())[0].status, 'FAILED');
  assert.equal(limited.attempts, limited.max_attempts, 'Known-safe rejection must stop at the durable retry budget');
  const attempts = sent.filter(item => item.subject === 'known rate limit');
  assert.equal(new Set(attempts.map(item => item.deliveryKey)).size, 1);
  assert.ok(attempts.every(item => item.html === attempts[0].html && item.text === attempts[0].text));

  const recovered = await enqueue('known rejected then recovered');
  failures.set(recovered.subject, Object.assign(new Error('Fixture service rejected request'), { code: 'RESEND_UNAVAILABLE', retryable: true, deliveryOutcome: 'NOT_ACCEPTED' }));
  assert.equal((await queue.processEmailQueue())[0].status, 'RETRY');
  failures.delete(recovered.subject);
  assert.equal((await queue.processEmailQueue())[0].status, 'SENT');
  const recoveredMessages = sent.filter(item => item.subject === recovered.subject);
  assert.equal(recoveredMessages[0].deliveryKey, recoveredMessages[1].deliveryKey);

  const bookkeeping = await enqueue('accepted bookkeeping failure'); bookkeepingFailures.add(bookkeeping.id);
  const acceptedThenFailed = (await queue.processEmailQueue())[0];
  assert.equal(acceptedThenFailed.status, 'REVIEW_REQUIRED'); assert.equal(acceptedThenFailed.provider_accepted, true); assert.equal(acceptedThenFailed.recipient_verified, false);
  assert.ok(bookkeeping.provider_accepted_at); assert.match(bookkeeping.message_id, /^fixture-provider-\d+$/);
  assert.equal(logs.find(log => log[0] === bookkeeping.id && log[5] === 'REVIEW_REQUIRED')[6], bookkeeping.message_id, 'Known provider ID must survive a failed SENT update in the durable review log');
  const afterAcceptance = sent.length; assert.equal((await queue.processEmailQueue()).length, 0); assert.equal(sent.length, afterAcceptance);

  const concurrent = await enqueue('concurrent workers');
  const outcomes = await Promise.all([queue.processEmailQueue(), queue.processEmailQueue()]);
  assert.equal(outcomes.flat().filter(row => row.id === concurrent.id).length, 1);
  assert.equal(sent.filter(item => item.subject === concurrent.subject).length, 1, 'Atomic claims must prevent concurrent sends');

  const stableKeyless = await enqueue('stable queue id', { idempotencyKey: undefined });
  failures.set(stableKeyless.subject, Object.assign(new Error('Fixture pre-dispatch config unavailable'), { code: 'RESEND_CONFIG_MISSING', retryable: true, deliveryOutcome: 'NOT_DISPATCHED' }));
  await queue.processEmailQueue(); failures.delete(stableKeyless.subject); await queue.processEmailQueue();
  assert.deepEqual(sent.filter(item => item.subject === stableKeyless.subject).map(item => item.deliveryKey), [`email-queue:${stableKeyless.id}`, `email-queue:${stableKeyless.id}`]);

  const document = await pdf.createDocumentPdf({ title: 'QUEUE REPORT', reference: 'QUEUE-PDF-FIXTURE', party: 'Fixture recipient', columns: [{ label: 'Hours' }], rows: [['8.00']] });
  const documentRow = await enqueue('valid PDF report', { relatedModule: 'invoices', relatedRecordId: '1', attachments: [{ filename: document.filename, contentType: 'application/pdf', contentDisposition: 'attachment', content: document.buffer }] });
  await queue.processEmailQueue();
  const delivered = sent.find(item => item.subject === documentRow.subject);
  assert.deepEqual(delivered.attachments[0].content, document.buffer);
  assert.equal(delivered.attachments[0].filename, document.filename);
  assert.equal(delivered.attachments[0].contentType, 'application/pdf');
  await pdf.validatePdf(delivered.attachments[0].content, { expectedText: ['QUEUE-PDF-FIXTURE', 'Fixture recipient'] });

  const switched = await enqueue('switch away'); selected = 'https_relay';
  assert.equal((await queue.processEmailQueue())[0].status, 'REVIEW_REQUIRED');
  assert.equal(switched.status, 'REVIEW_REQUIRED');
  assert.equal(sent.filter(item => item.subject === switched.subject).length, 0);

  selected = 'resend';
  const weeklyContent = { subject: 'Weekly timesheet fixture', html: '<h1>TIMESHEET</h1><p>Fixture Staff A: 8.00 hours</p>',
    text: 'TIMESHEET\nFixture Staff A: 8.00 hours', layoutVersion: 'weekly-html-v1' };
  const weeklyPolicy = { type: 'WEEKLY_TIMESHEET', format: 'HTML', staffId: 31, deliveryId: 81, revision: 1,
    fromDate: '2026-11-02', toDate: '2026-11-08', recipient: 'fixture@example.invalid',
    recipientSource: 'REGISTERED_EMAIL', recipientPolicyVersion: 2, layoutVersion: weeklyContent.layoutVersion,
    contentHash: require('../services/weeklyTimesheetEmailService').contentHashFor(weeklyContent),
    sourceHash: require('node:crypto').createHash('sha256').update('synthetic staff source').digest('hex') };
  db.getConnection = async () => ({ query: db.query, async beginTransaction() {}, async commit() {}, async rollback() {}, release() {} });
  install('../services/weeklyTimesheetScheduler', {
    async validateQueuedWeeklyDelivery() { return { delivery_id: 81, staff_id: 31, version: 1, source_sha256: weeklyPolicy.sourceHash,
      format: 'HTML', contentHash: weeklyPolicy.contentHash, contentSnapshot: weeklyContent }; },
    async markWeeklyDeliveryResult() {}
  });
  const weeklyRow = await enqueue(weeklyContent.subject, { ...weeklyContent, relatedModule: 'timesheets', relatedRecordId: '51',
    templateKey: 'weekly_timesheet_html', idempotencyKey: 'weekly-timesheet:31:2026-11-02:2026-11-08:v1', deliveryPolicy: weeklyPolicy, cc: [], bcc: [] });
  assert.equal(JSON.parse(weeklyRow.delivery_policy_json).queueTransport.provider, 'resend');
  assert.equal((await queue.processEmailQueue())[0].status, 'SENT');
  const weeklySent = sent.find(item => item.subject === weeklyContent.subject);
  assert.deepEqual(weeklySent.to, [weeklyPolicy.recipient]); assert.deepEqual(weeklySent.cc, []); assert.deepEqual(weeklySent.bcc, []);
  assert.deepEqual(weeklySent.attachments, []); assert.deepEqual(weeklySent.deliveryPolicy, weeklyPolicy);
  assert.equal(weeklySent.html, weeklyContent.html); assert.equal(weeklySent.text, weeklyContent.text);
  assert.ok(logs.length > 0);
  console.log('Resend queue tests passed: explicit provider admission; no stale-provider/auth drain; immutable recipient/body/PDF bytes; stable retry keys; bounded rejection retries; uncertain/accepted holds; atomic concurrent claims; restart safety; provider change requires review.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
