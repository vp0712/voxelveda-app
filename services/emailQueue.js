const pool = require('../config/db');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { ensureEmailQueueSchema } = require('./emailQueueSchema');
const { sendMail, selectedEmailTransport, normalizeAddressList, isEmailTransportError, explicitNegativeSmtpReply, classifySmtpFailure, attachmentBuffer, assertAttachmentIntegrity } = require('./emailService');
const { assertWeeklyDeliveryPolicy, assertWeeklyDeliveryContent, weeklyFormat, weeklyMessage, privacyError } = require('./weeklyDeliveryPolicy');
const { validatePdf } = require('./documentPdfService');

// Retired and unclassified messages remain in their original queue rows but
// cannot be claimed by this deployment. Restore of the previous release can
// resume its own workflows without losing the historical content.
const RETAINED_EMAIL_MODULES = Object.freeze(['auth', 'security', 'contact', 'rfq', 'invoices', 'timesheets', 'roster', 'procurement', 'workflow', 'qms', 'meetings', 'tasks', 'careers']);
const modulePlaceholders = RETAINED_EMAIL_MODULES.map(() => '?').join(', ');

function assertRetainedEmailModule(message) {
  if (!RETAINED_EMAIL_MODULES.includes(message?.relatedModule)) {
    const error = new Error('Email delivery for this module is no longer available.');
    error.code = 'EMAIL_MODULE_RETIRED';
    throw error;
  }
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function withoutTransportBinding(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return null;
  const { queueTransport, ...sourcePolicy } = policy;
  return sourcePolicy.type === 'QUEUE_TRANSPORT' ? null : sourcePolicy;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJson(value[key])]));
  return value;
}

// This hash covers the immutable recipient/content envelope, not queue status,
// attempts, provider results or the transport admission metadata itself.
function envelopeHash(message, attachments, policy) {
  if (!Array.isArray(attachments)) throw queueReviewError('The queued attachment envelope is invalid. Repair or revise the saved request before delivery.', 'QUEUE_CONTENT_CHANGED');
  const persisted = Object.prototype.hasOwnProperty.call(message, 'to_json');
  const value = {
    template: (persisted ? message.template_key : message.templateKey) || null,
    to: normalizeAddressList(persisted ? parseJson(message.to_json, []) : message.to),
    cc: normalizeAddressList(persisted ? parseJson(message.cc_json, []) : message.cc),
    bcc: normalizeAddressList(persisted ? parseJson(message.bcc_json, []) : message.bcc),
    replyTo: (persisted ? message.reply_to : message.replyTo) || null,
    subject: message.subject,
    html: (persisted ? message.html_body : message.html) || null,
    text: (persisted ? message.text_body : message.text) || null,
    module: (persisted ? message.related_module : message.relatedModule) || null,
    record: String((persisted ? message.related_record_id : message.relatedRecordId) || '') || null,
    deliveryKey: (persisted ? message.idempotency_key : message.idempotencyKey) || null,
    policy: withoutTransportBinding(policy),
    attachments: attachments.map(item => ({ filename: item.filename, contentType: item.contentType,
      contentDisposition: item.contentDisposition || 'attachment', byteLength: Number(item.byteLength), sha256: item.sha256 }))
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonicalJson(value))).digest('hex');
}

function bindQueueTransport(message, attachments, deliveryPolicy, transport) {
  // Explicit selection is essential: merely adding a Resend key must not move
  // the existing company's messages away from its current provider.
  if (transport !== 'resend') return deliveryPolicy;
  return { ...(deliveryPolicy || { type: 'QUEUE_TRANSPORT' }), queueTransport: {
    version: 1, provider: transport, enqueuedAt: new Date().toISOString(),
    payloadSha256: envelopeHash(message, attachments, deliveryPolicy)
  } };
}

function queueReviewError(message, reasonCode) {
  return Object.assign(new Error(message), { code: 'DELIVERY_REVIEW_REQUIRED', reasonCode, deliveryOutcome: 'NOT_DISPATCHED', retryable: false });
}

function assertQueueTransport(row, transport) {
  const policy = parseJson(row.delivery_policy_json, null);
  const binding = policy?.queueTransport;
  if (row.provider_accepted_at || row.message_id || row.recipient_verified_at) {
    throw queueReviewError('This queue row already records provider acceptance or receipt. Review its existing outcome before any further send.', 'QUEUE_PROVIDER_OUTCOME_EXISTS');
  }
  if (transport === 'resend' && !binding) {
    throw queueReviewError('This message was queued before the Resend release and has no approved transport binding. Review the original provider outcome and current source before requesting a new delivery; no historical message was sent.', 'QUEUE_TRANSPORT_ADMISSION_REQUIRED');
  }
  if (!binding) return;
  if (binding.version !== 1 || binding.provider !== transport || !/^[a-f0-9]{64}$/.test(String(binding.payloadSha256)) || !Number.isFinite(Date.parse(binding.enqueuedAt))) {
    throw queueReviewError('The queue transport changed or its admission metadata is invalid. Review the existing message before requesting delivery through another provider.', 'QUEUE_TRANSPORT_CHANGED');
  }
  const savedAttachments = parseJson(row.attachments_json, []);
  if (!Array.isArray(savedAttachments) || envelopeHash(row, savedAttachments, policy) !== binding.payloadSha256) {
    throw queueReviewError('The queued recipient or document content differs from its saved version. Review the source and create an authorised revision; the original message was not sent.', 'QUEUE_CONTENT_CHANGED');
  }
}

function assertExpectedDocumentAttachment(message, attachments) {
  const module = String(message.relatedModule || message.related_module || '').toLowerCase();
  const template = String(message.templateKey || message.template_key || '').toLowerCase();
  const key = String(message.idempotencyKey || message.idempotency_key || '');
  const body = [message.subject, message.text || message.text_body, message.html || message.html_body].join(' ').replace(/<[^>]*>/g, ' ');
  const suppliedPolicy = message.deliveryPolicy || parseJson(message.delivery_policy_json, null);
  if (suppliedPolicy?.format === 'HTML') {
    // This exception belongs only to the explicit, source-bound weekly HTML
    // report. A generic timesheet/invoice message cannot use it to omit a PDF.
    const deliveryPolicy = assertWeeklyDeliveryPolicy({ ...message, deliveryPolicy: suppliedPolicy }, {
      to: normalizeAddressList(message.to ?? parseJson(message.to_json, [])),
      cc: normalizeAddressList(message.cc ?? parseJson(message.cc_json, [])),
      bcc: normalizeAddressList(message.bcc ?? parseJson(message.bcc_json, []))
    });
    if (module !== 'timesheets' || template !== 'weekly_timesheet_html') throw privacyError('WEEKLY_HTML_IDENTITY_MISMATCH');
    assertWeeklyDeliveryContent({ ...message, attachments }, deliveryPolicy);
    return;
  }
  const expected = module === 'invoices'
    || /^(?:document:|weekly-timesheet:)/.test(key)
    || /(?:^|_)(?:document_pdf|invoice|invoice_statement|customer_statement|quotation|purchase_order|weekly_timesheet|timesheet_summary)(?:_|$)/.test(template)
    || /\battached\b/i.test(body);
  if (expected && !attachments.length) {
    const error = new Error('This document email has no validated PDF attachment. The original queue row is retained for repair and controlled retry; no message was sent.');
    error.code = 'PDF_ATTACHMENT_MISSING';
    throw error;
  }
}

async function serializableAttachments(attachments = []) {
  const saved=[];
  let total=0;
  for(const item of await assertAttachmentIntegrity(attachments||[])){
    if(!item)continue;
    let bytes;
    if(item.path)bytes=await fs.promises.readFile(item.path);
    else bytes=attachmentBuffer(item);
    if(!bytes)throw new Error('Queued attachment has no durable content.');
    total+=bytes.length;
    if(total>20*1024*1024)throw new Error('Queued attachments exceed the 20 MB limit.');
    saved.push({filename:item.filename,contentType:item.contentType||'application/octet-stream',contentDisposition:item.contentDisposition||'attachment',validation:item.validation,
      content:bytes.toString('base64'),encoding:'base64',byteLength:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
  }
  return saved;
}
function restoreAttachments(items=[]){
  if (!Array.isArray(items)) throw Object.assign(new Error('Queued attachment metadata is invalid. Repair the original queue row before retry.'),{code:'PDF_ATTACHMENT_INVALID'});
  return items.map(item=>{
    if (!item || typeof item !== 'object') throw Object.assign(new Error('Queued attachment metadata is invalid. Repair the original queue row before retry.'),{code:'PDF_ATTACHMENT_INVALID'});
    if(item.encoding!=='base64')return item; // Legacy durable path rows retain their existing behaviour.
    const bytes=Buffer.from(String(item.content||''),'base64');
    if(bytes.length!==Number(item.byteLength)||crypto.createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Object.assign(new Error('Queued attachment integrity check failed.'),{code:'PDF_ATTACHMENT_INVALID'});
    return {...item,content:bytes,encoding:undefined};
  });
}

async function queueEmail(message, db = pool) {
  assertRetainedEmailModule(message);
  const attachments = await serializableAttachments(message.attachments);
  assertExpectedDocumentAttachment(message, attachments);
  const deliveryPolicy = assertWeeklyDeliveryPolicy(message, { to: normalizeAddressList(message.to), cc: normalizeAddressList(message.cc), bcc: normalizeAddressList(message.bcc) });
  assertWeeklyDeliveryContent({ ...message, attachments }, deliveryPolicy);
  if (deliveryPolicy && weeklyFormat(deliveryPolicy) === 'HTML' && message.idempotencyKey !== `weekly-timesheet:${deliveryPolicy.staffId}:${deliveryPolicy.fromDate}:${deliveryPolicy.toDate}:v${deliveryPolicy.revision}`) throw privacyError('WEEKLY_POLICY_IDENTITY_MISMATCH');
  const storedPolicy = bindQueueTransport(message, attachments, deliveryPolicy, selectedEmailTransport());
  await ensureEmailQueueSchema();
  const payload = [
    message.templateKey || null,
    JSON.stringify(normalizeAddressList(message.to)),
    JSON.stringify(normalizeAddressList(message.cc)),
    JSON.stringify(normalizeAddressList(message.bcc)),
    message.replyTo || null,
    message.subject,
    message.html || null,
    message.text || null,
    JSON.stringify(attachments),
    storedPolicy ? JSON.stringify(storedPolicy) : null,
    message.relatedModule || null,
    message.relatedRecordId ? String(message.relatedRecordId) : null,
    message.scheduledAt || new Date(),
    message.idempotencyKey || null,
    message.createdBy || null
  ];

  try {
    const [result] = await db.query(
      `
      INSERT INTO email_queue
      (template_key, to_json, cc_json, bcc_json, reply_to, subject, html_body, text_body,
       attachments_json, delivery_policy_json, related_module, related_record_id, scheduled_at, idempotency_key, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      payload
    );
    return result.insertId;
  } catch (error) {
    if (error?.code !== 'ER_DUP_ENTRY' || !message.idempotencyKey) throw error;
    if (deliveryPolicy && weeklyFormat(deliveryPolicy) === 'HTML') {
      const [[existing]] = await db.query('SELECT * FROM email_queue WHERE idempotency_key = ? LIMIT 1', [message.idempotencyKey]);
      let existingPolicy;
      try {
        existingPolicy = assertWeeklyDeliveryPolicy({ ...existing, deliveryPolicy: parseJson(existing?.delivery_policy_json, null) }, {
          to: parseJson(existing?.to_json, []), cc: parseJson(existing?.cc_json, []), bcc: parseJson(existing?.bcc_json, [])
        });
        assertExpectedDocumentAttachment(existing || {}, restoreAttachments(parseJson(existing?.attachments_json, [])));
      } catch { throw privacyError('WEEKLY_HTML_IDEMPOTENCY_CONFLICT'); }
      if (!existing || existing.related_module !== message.relatedModule || String(existing.related_record_id) !== String(message.relatedRecordId) ||
          existing.template_key !== message.templateKey || existing.subject !== message.subject || existing.html_body !== message.html || existing.text_body !== message.text ||
          existingPolicy?.sourceHash !== deliveryPolicy.sourceHash || existingPolicy?.contentHash !== deliveryPolicy.contentHash ||
          existingPolicy?.recipient !== deliveryPolicy.recipient || existingPolicy?.format !== 'HTML') throw privacyError('WEEKLY_HTML_IDEMPOTENCY_CONFLICT');
      return existing.id;
    }
    const [[existing]] = await db.query(
      storedPolicy?.queueTransport ? 'SELECT * FROM email_queue WHERE idempotency_key = ? LIMIT 1' : 'SELECT id FROM email_queue WHERE idempotency_key = ? LIMIT 1',
      [message.idempotencyKey]
    );
    if (existing && storedPolicy?.queueTransport) {
      const existingPolicy = parseJson(existing.delivery_policy_json, null);
      if (existingPolicy?.queueTransport?.payloadSha256 !== storedPolicy.queueTransport.payloadSha256 ||
          envelopeHash(existing, parseJson(existing.attachments_json, []), existingPolicy) !== storedPolicy.queueTransport.payloadSha256) {
        throw queueReviewError('This delivery key already belongs to another saved envelope or transport history. Review that delivery and create an authorised new request or revision instead of changing its recipient or content.', 'QUEUE_IDEMPOTENCY_CONFLICT');
      }
    }
    return existing?.id || null;
  }
}

async function writeEmailLog(row, status, result, error, db = pool) {
  await db.query(
    `
    INSERT INTO email_logs
    (queue_id, related_module, related_record_id, recipients, subject, status,
     provider_message_id, error_message, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      row.id,
      row.related_module,
      row.related_record_id,
      parseJson(row.to_json, []).join(', '),
      row.subject,
      status,
      result?.messageId || null,
      error?.message || null,
      row.created_by || null
    ]
  );
}

async function processEmailQueue(limit = 10) {
  await ensureEmailQueueSchema();
  const transport = selectedEmailTransport();
  // One atomic multi-table update preserves the same review state in the queue,
  // current staff/week delivery and immutable version history after a crash.
  await pool.query(`UPDATE email_queue q
    LEFT JOIN weekly_timesheet_deliveries d ON d.email_queue_id=q.id
    LEFT JOIN weekly_timesheet_delivery_versions v ON v.email_queue_id=q.id
    SET q.status='REVIEW_REQUIRED',q.next_attempt_at=NULL,
      q.last_error='The worker stopped during transport. Provider acceptance is uncertain; review the provider before retry to prevent duplicate delivery.',
      d.status='REVIEW_REQUIRED',d.last_error_code='WORKER_TRANSPORT_UNCERTAIN',v.status='REVIEW_REQUIRED'
    WHERE q.status='SENDING' AND q.claimed_at < DATE_SUB(NOW(),INTERVAL 15 MINUTE) AND q.related_module IN (${modulePlaceholders})`, RETAINED_EMAIL_MODULES);
  const [rows] = await pool.query(
    `
    SELECT * FROM email_queue
    WHERE status IN ('PENDING', 'RETRY')
      AND related_module IN (${modulePlaceholders})
      AND scheduled_at <= NOW()
      AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
    ORDER BY created_at ASC
    LIMIT ?
    `,
    [...RETAINED_EMAIL_MODULES, Math.max(1, Math.min(Number(limit) || 10, 50))]
  );

  const outcomes = [];
  for (const row of rows) {
    const isWeekly = weeklyMessage(row);
    const resendBound = transport === 'resend' && parseJson(row.delivery_policy_json, null)?.queueTransport?.provider === 'resend';
    // The SELECT may be stale after another replica safely failed and scheduled
    // a retry. Recheck due time and the bounded delivery budget atomically when
    // claiming, so that replica cannot bypass backoff or consume another send.
    const [claim] = await pool.query(
      `UPDATE email_queue SET status = 'SENDING', claimed_at=NOW(), attempts = attempts + 1 WHERE id = ? AND status IN ('PENDING', 'RETRY') AND related_module IN (${modulePlaceholders})
        AND scheduled_at <= NOW() AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())${isWeekly || resendBound ? ' AND attempts < max_attempts' : ''}`,
      [row.id, ...RETAINED_EMAIL_MODULES]
    );
    if (!claim.affectedRows) continue;

    let providerAccepted = false;
    let acceptedMessageId = null;
    let transportInvoked = false;
    let weeklyDb = null;
    const markWeekly = async (status, metadata = {}, db = pool) => {
      if (isWeekly && row.delivery_policy_json) await require('./weeklyTimesheetScheduler').markWeeklyDeliveryResult(db, row, status, metadata);
    };
    try {
      assertQueueTransport(row, transport);
      const attachments = restoreAttachments(parseJson(row.attachments_json, []));
      assertExpectedDocumentAttachment(row, attachments);
      let deliveryPolicy = null;
      if (isWeekly) {
        deliveryPolicy = assertWeeklyDeliveryPolicy({ ...row, deliveryPolicy: withoutTransportBinding(parseJson(row.delivery_policy_json, null)) }, { to: parseJson(row.to_json, []), cc: parseJson(row.cc_json, []), bcc: parseJson(row.bcc_json, []) });
        weeklyDb = await pool.getConnection();
        await weeklyDb.beginTransaction();
        const checked = await require('./weeklyTimesheetScheduler').validateQueuedWeeklyDelivery(row, weeklyDb);
        if (!checked || Number(checked.delivery_id) !== Number(deliveryPolicy.deliveryId) || Number(checked.staff_id) !== Number(deliveryPolicy.staffId) || Number(checked.version) !== Number(deliveryPolicy.revision) || checked.source_sha256 !== deliveryPolicy.sourceHash) throw privacyError('WEEKLY_POLICY_SOURCE_MISMATCH');
        if (weeklyFormat(deliveryPolicy) === 'HTML') {
          const content = assertWeeklyDeliveryContent({ ...row, attachments }, deliveryPolicy);
          if (checked.format !== 'HTML' || checked.contentHash !== deliveryPolicy.contentHash || !checked.contentSnapshot ||
              ['subject', 'html', 'text', 'layoutVersion'].some(field => checked.contentSnapshot[field] !== content[field])) throw privacyError('WEEKLY_HTML_SNAPSHOT_MISMATCH');
        } else {
          if (checked.format && checked.format !== 'PDF') throw privacyError('WEEKLY_FORMAT_MISMATCH');
          assertWeeklyDeliveryContent({ ...row, attachments }, deliveryPolicy);
          const data = checked.documentData;
          await validatePdf(attachmentBuffer(attachments[0]), { expectedText: [data.title, data.reference, data.party, data.period] });
        }
      }
      transportInvoked=true;
      const result = await sendMail({
        to: parseJson(row.to_json, []),
        cc: parseJson(row.cc_json, []),
        bcc: parseJson(row.bcc_json, []),
        replyTo: row.reply_to,
        deliveryKey: row.idempotency_key || `email-queue:${row.id}`,
        deliveryPolicy,
        subject: row.subject,
        html: row.html_body,
        text: row.text_body,
        attachments
      });
      providerAccepted = true;
      acceptedMessageId = result.messageId || null;
      const db = weeklyDb || pool;
      const [completed] = await db.query(
        `UPDATE email_queue SET status = 'SENT', sent_at = NOW(), provider_accepted_at=NOW(), message_id = ?, last_error = NULL WHERE id = ?`,
        [result.messageId || null, row.id]
      );
      if (completed.affectedRows !== 1) throw queueReviewError('The provider accepted this message but its queue result could not be saved. Review before retry; recipient receipt remains unverified.', 'QUEUE_ACCEPTANCE_BOOKKEEPING_FAILED');
      await writeEmailLog(row, 'SENT', result, null, db);
      await markWeekly('SENT', { providerAccepted: true }, db);
      if (weeklyDb) { await weeklyDb.commit(); weeklyDb.release(); weeklyDb = null; }
      if(row.related_module==='invoices' && /^[1-9]\d*$/.test(String(row.related_record_id))) {
        await pool.query("UPDATE invoices SET status='sent' WHERE id=? AND status='approved' AND IFNULL(deleted,0)=0",[Number(row.related_record_id)]);
      }
      outcomes.push({ id: row.id, status: 'SENT', provider_accepted: true, recipient_verified: false });
    } catch (error) {
      if (weeklyDb) { await weeklyDb.rollback().catch(() => {}); weeklyDb.release(); weeklyDb = null; }
      const explicitNegative=error.deliveryOutcome==='NOT_ACCEPTED'||explicitNegativeSmtpReply(error);
      const provedBeforeDispatch=error.deliveryOutcome==='NOT_DISPATCHED';
      const uncertainTransport=transportInvoked&&!provedBeforeDispatch&&!explicitNegative;
      if(providerAccepted || error.code==='DELIVERY_REVIEW_REQUIRED' || uncertainTransport) {
        providerAccepted=providerAccepted || error.providerAccepted===true;
        await pool.query("UPDATE email_queue SET status='REVIEW_REQUIRED',provider_accepted_at=CASE WHEN ?=1 THEN COALESCE(provider_accepted_at,NOW()) ELSE provider_accepted_at END,last_error=?,message_id=COALESCE(message_id,?),next_attempt_at=NULL WHERE id=?",[providerAccepted?1:0,providerAccepted ? 'The provider accepted this message, but content confirmation or delivery bookkeeping could not finish. Review before retry; recipient receipt is unverified.' : (error.message || 'The transport transaction outcome is uncertain. Review provider logs before retry to avoid duplicate delivery.'),acceptedMessageId,row.id]);
        await writeEmailLog(row,'REVIEW_REQUIRED',acceptedMessageId ? { messageId: acceptedMessageId } : null,error);
        await markWeekly('REVIEW_REQUIRED', { code: error.code, reasonCode: error.reasonCode, providerAccepted });
        outcomes.push({id:row.id,status:'REVIEW_REQUIRED',provider_accepted:providerAccepted,recipient_verified:false});
        continue;
      }
      const attempts = Number(row.attempts || 0) + 1;
      const code = String(error?.code || '').toUpperCase();
      const persistentTransportRetry = isEmailTransportError(error)
        && !['EAUTH', 'SMTP_CONFIG_MISSING'].includes(code);
      const requiresRepair = code.startsWith('PDF_');
      // Weekly reports and Resend have a bounded recovery policy. Known-safe
      // connectivity failures must not bypass the durable attempt budget.
      // Accepted/uncertain attempts are already held above, never retried here.
      const withinBudget = attempts < Number(row.max_attempts || 5);
      const retry = error.retryable!==false && !requiresRepair && (isWeekly || resendBound ? withinBudget : persistentTransportRetry || withinBudget);
      const backoffMinutes = persistentTransportRetry
        ? Math.min(360, 2 ** Math.min(9, Math.max(0, attempts - 1)))
        : Math.min(60, 2 ** Math.max(0, attempts - 1));
      const retryAfterMs = Number(error.retryAfterMs);
      const retryMinutes = resendBound && Number.isFinite(retryAfterMs) && retryAfterMs > 0
        ? Math.max(backoffMinutes, Math.ceil(retryAfterMs / 60000))
        : backoffMinutes;
      await pool.query(
        `
        UPDATE email_queue
        SET status = ?, last_error = ?, next_attempt_at = CASE WHEN ? = 1 THEN DATE_ADD(NOW(), INTERVAL ? MINUTE) ELSE NULL END
        WHERE id = ?
        `,
        [retry ? 'RETRY' : 'FAILED', String(error.message || error).slice(0, 4000), retry ? 1 : 0, retryMinutes, row.id]
      );
      await writeEmailLog(row, retry ? 'RETRY' : 'FAILED', null, error);
      await markWeekly(retry ? 'RETRY' : 'FAILED', { code: error.code, reasonCode: error.reasonCode });
      const failure = classifySmtpFailure(error);
      outcomes.push({
        id: row.id,
        status: retry ? 'RETRY' : 'FAILED',
        error: error.message,
        errorCode: failure.code,
        errorCategory: failure.category,
        responseCode: failure.response_code
      });
    }
  }
  return outcomes;
}

module.exports = { queueEmail, processEmailQueue, RETAINED_EMAIL_MODULES, restoreAttachments, _test:{serializableAttachments,restoreAttachments,assertExpectedDocumentAttachment,envelopeHash,bindQueueTransport,assertQueueTransport} };
