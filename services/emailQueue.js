const pool = require('../config/db');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { ensureEmailQueueSchema } = require('./emailQueueSchema');
const { sendMail, normalizeAddressList, isEmailTransportError, classifySmtpFailure, attachmentBuffer } = require('./emailService');

// Retired and unclassified messages remain in their original queue rows but
// cannot be claimed by this deployment. Restore of the previous release can
// resume its own workflows without losing the historical content.
const RETAINED_EMAIL_MODULES = Object.freeze(['auth', 'security', 'contact', 'customer_rfqs']);
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

async function serializableAttachments(attachments = []) {
  const saved=[];
  let total=0;
  for(const item of attachments||[]){
    if(!item)continue;
    let bytes;
    if(item.path)bytes=await fs.promises.readFile(item.path);
    else bytes=attachmentBuffer(item);
    if(!bytes)throw new Error('Queued attachment has no durable content.');
    total+=bytes.length;
    if(total>20*1024*1024)throw new Error('Queued attachments exceed the 20 MB limit.');
    saved.push({filename:item.filename,contentType:item.contentType||'application/octet-stream',contentDisposition:item.contentDisposition||'attachment',
      content:bytes.toString('base64'),encoding:'base64',byteLength:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
  }
  return saved;
}
function restoreAttachments(items=[]){
  return items.map(item=>{
    if(item.encoding!=='base64')return item; // Legacy durable path rows retain their existing behaviour.
    const bytes=Buffer.from(String(item.content||''),'base64');
    if(bytes.length!==Number(item.byteLength)||crypto.createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw new Error('Queued attachment integrity check failed.');
    return {...item,content:bytes,encoding:undefined};
  });
}

async function queueEmail(message) {
  assertRetainedEmailModule(message);
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
    JSON.stringify(await serializableAttachments(message.attachments)),
    message.relatedModule || null,
    message.relatedRecordId ? String(message.relatedRecordId) : null,
    message.scheduledAt || new Date(),
    message.idempotencyKey || null,
    message.createdBy || null
  ];

  try {
    const [result] = await pool.query(
      `
      INSERT INTO email_queue
      (template_key, to_json, cc_json, bcc_json, reply_to, subject, html_body, text_body,
       attachments_json, related_module, related_record_id, scheduled_at, idempotency_key, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      payload
    );
    return result.insertId;
  } catch (error) {
    if (error?.code !== 'ER_DUP_ENTRY' || !message.idempotencyKey) throw error;
    const [[existing]] = await pool.query(
      'SELECT id FROM email_queue WHERE idempotency_key = ? LIMIT 1',
      [message.idempotencyKey]
    );
    return existing?.id || null;
  }
}

async function writeEmailLog(row, status, result, error) {
  await pool.query(
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
      `UPDATE email_queue SET status = 'SENDING', attempts = attempts + 1 WHERE id = ? AND status IN ('PENDING', 'RETRY') AND related_module IN (${modulePlaceholders})`,
      [row.id, ...RETAINED_EMAIL_MODULES]
    );
    if (!claim.affectedRows) continue;

    try {
      const result = await sendMail({
        to: parseJson(row.to_json, []),
        cc: parseJson(row.cc_json, []),
        bcc: parseJson(row.bcc_json, []),
        replyTo: row.reply_to,
        subject: row.subject,
        html: row.html_body,
        text: row.text_body,
        attachments: restoreAttachments(parseJson(row.attachments_json, []))
      });
      await pool.query(
        `UPDATE email_queue SET status = 'SENT', sent_at = NOW(), message_id = ?, last_error = NULL WHERE id = ?`,
        [result.messageId || null, row.id]
      );
      await writeEmailLog(row, 'SENT', result, null);
      outcomes.push({ id: row.id, status: 'SENT' });
    } catch (error) {
      const attempts = Number(row.attempts || 0) + 1;
      const code = String(error?.code || '').toUpperCase();
      const persistentTransportRetry = isEmailTransportError(error)
        && !['EAUTH', 'SMTP_CONFIG_MISSING'].includes(code);
      const retry = persistentTransportRetry || attempts < Number(row.max_attempts || 5);
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

module.exports = { queueEmail, processEmailQueue, RETAINED_EMAIL_MODULES, _test:{serializableAttachments,restoreAttachments} };
