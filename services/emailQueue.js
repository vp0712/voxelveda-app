const pool = require('../config/db');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { ensureEmailQueueSchema } = require('./emailQueueSchema');
const { sendMail, normalizeAddressList, isEmailTransportError, classifySmtpFailure, attachmentBuffer, assertAttachmentIntegrity } = require('./emailService');
const { assertWeeklyDeliveryPolicy, weeklyMessage, privacyError } = require('./weeklyDeliveryPolicy');
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

function assertExpectedDocumentAttachment(message, attachments) {
  const module = String(message.relatedModule || message.related_module || '').toLowerCase();
  const template = String(message.templateKey || message.template_key || '').toLowerCase();
  const key = String(message.idempotencyKey || message.idempotency_key || '');
  const body = [message.subject, message.text || message.text_body, message.html || message.html_body].join(' ').replace(/<[^>]*>/g, ' ');
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
    deliveryPolicy ? JSON.stringify(deliveryPolicy) : null,
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
    const [[existing]] = await db.query(
      'SELECT id FROM email_queue WHERE idempotency_key = ? LIMIT 1',
      [message.idempotencyKey]
    );
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
    const [claim] = await pool.query(
      `UPDATE email_queue SET status = 'SENDING', claimed_at=NOW(), attempts = attempts + 1 WHERE id = ? AND status IN ('PENDING', 'RETRY') AND related_module IN (${modulePlaceholders})`,
      [row.id, ...RETAINED_EMAIL_MODULES]
    );
    if (!claim.affectedRows) continue;

    let providerAccepted = false;
    let weeklyDb = null;
    const isWeekly = weeklyMessage(row);
    const markWeekly = async (status, metadata = {}, db = pool) => {
      if (isWeekly && row.delivery_policy_json) await require('./weeklyTimesheetScheduler').markWeeklyDeliveryResult(db, row, status, metadata);
    };
    try {
      const attachments = restoreAttachments(parseJson(row.attachments_json, []));
      assertExpectedDocumentAttachment(row, attachments);
      let deliveryPolicy = null;
      if (isWeekly) {
        deliveryPolicy = assertWeeklyDeliveryPolicy({ ...row, deliveryPolicy: parseJson(row.delivery_policy_json, null) }, { to: parseJson(row.to_json, []), cc: parseJson(row.cc_json, []), bcc: parseJson(row.bcc_json, []) });
        weeklyDb = await pool.getConnection();
        await weeklyDb.beginTransaction();
        const checked = await require('./weeklyTimesheetScheduler').validateQueuedWeeklyDelivery(row, weeklyDb);
        if (!checked || Number(checked.delivery_id) !== Number(deliveryPolicy.deliveryId) || Number(checked.staff_id) !== Number(deliveryPolicy.staffId) || Number(checked.version) !== Number(deliveryPolicy.revision) || checked.source_sha256 !== deliveryPolicy.sourceHash) throw privacyError('WEEKLY_POLICY_SOURCE_MISMATCH');
        if (attachments.length !== 1) throw privacyError('WEEKLY_ATTACHMENT_COUNT_INVALID');
        const data = checked.documentData;
        await validatePdf(attachmentBuffer(attachments[0]), { expectedText: [data.title, data.reference, data.party, data.period] });
      }
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
      const db = weeklyDb || pool;
      await db.query(
        `UPDATE email_queue SET status = 'SENT', sent_at = NOW(), provider_accepted_at=NOW(), message_id = ?, last_error = NULL WHERE id = ?`,
        [result.messageId || null, row.id]
      );
      await writeEmailLog(row, 'SENT', result, null, db);
      await markWeekly('SENT', { providerAccepted: true }, db);
      if (weeklyDb) { await weeklyDb.commit(); weeklyDb.release(); weeklyDb = null; }
      if(row.related_module==='invoices' && /^[1-9]\d*$/.test(String(row.related_record_id))) {
        await pool.query("UPDATE invoices SET status='sent' WHERE id=? AND status='approved' AND IFNULL(deleted,0)=0",[Number(row.related_record_id)]);
      }
      outcomes.push({ id: row.id, status: 'SENT', provider_accepted: true, recipient_verified: false });
    } catch (error) {
      if (weeklyDb) { await weeklyDb.rollback().catch(() => {}); weeklyDb.release(); weeklyDb = null; }
      const explicitNegative=error.deliveryOutcome==='NOT_ACCEPTED'||Number(error.responseCode)>=400&&Number(error.responseCode)<600;
      const uncertainTransport=isEmailTransportError(error)&&error.code!=='SMTP_CONFIG_MISSING'&&!explicitNegative;
      if(providerAccepted || error.code==='DELIVERY_REVIEW_REQUIRED' || uncertainTransport) {
        providerAccepted=providerAccepted || error.providerAccepted===true;
        await pool.query("UPDATE email_queue SET status='REVIEW_REQUIRED',provider_accepted_at=CASE WHEN ?=1 THEN COALESCE(provider_accepted_at,NOW()) ELSE provider_accepted_at END,last_error=?,next_attempt_at=NULL WHERE id=?",[providerAccepted?1:0,providerAccepted ? 'The provider accepted this message, but attachment confirmation or delivery bookkeeping could not finish. Review before retry; recipient receipt is unverified.' : (error.message || 'The transport transaction outcome is uncertain. Review provider logs before retry to avoid duplicate delivery.'),row.id]);
        await writeEmailLog(row,'REVIEW_REQUIRED',null,error);
        await markWeekly('REVIEW_REQUIRED', { code: error.code, reasonCode: error.reasonCode, providerAccepted });
        outcomes.push({id:row.id,status:'REVIEW_REQUIRED',provider_accepted:providerAccepted,recipient_verified:false});
        continue;
      }
      const attempts = Number(row.attempts || 0) + 1;
      const code = String(error?.code || '').toUpperCase();
      const persistentTransportRetry = isEmailTransportError(error)
        && !['EAUTH', 'SMTP_CONFIG_MISSING'].includes(code);
      const requiresRepair = code.startsWith('PDF_');
      const retry = error.retryable!==false && !requiresRepair && (persistentTransportRetry || attempts < Number(row.max_attempts || 5));
      const retryMinutes = persistentTransportRetry
        ? Math.min(360, 2 ** Math.min(9, Math.max(0, attempts - 1)))
        : Math.min(60, 2 ** Math.max(0, attempts - 1));
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

module.exports = { queueEmail, processEmailQueue, RETAINED_EMAIL_MODULES, restoreAttachments, _test:{serializableAttachments,restoreAttachments,assertExpectedDocumentAttachment} };
