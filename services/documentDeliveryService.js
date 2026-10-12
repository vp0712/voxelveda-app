'use strict';
const crypto = require('node:crypto');
const pool = require('../config/db');
const { createDocumentPdf,validatePdf } = require('./documentPdfService');
const { queueEmail,restoreAttachments } = require('./emailQueue');
const { ensureEmailQueueSchema } = require('./emailQueueSchema');
let schemaPromise;
function ensureDocumentDeliverySchema() {
  if (!schemaPromise) schemaPromise = pool.query(`CREATE TABLE IF NOT EXISTS document_delivery_requests (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, request_key CHAR(64) NOT NULL,
    related_module VARCHAR(80) NOT NULL, related_record_id VARCHAR(80) NOT NULL,
    source_json LONGTEXT NOT NULL, recipients_json TEXT NOT NULL,
    generation_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    pdf_sha256 CHAR(64) NULL, pdf_pages INT NULL, email_queue_id BIGINT NULL,
    last_error TEXT NULL, created_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_document_delivery_request(request_key)
  ) ENGINE=InnoDB`).catch(error => { schemaPromise = null; throw error; });
  return schemaPromise;
}
async function queueDocumentEmail({ module, recordId, data, to, subject, html, text, createdBy, beforeQueue, afterQueue, idempotencyKey, deliveryPolicy }) {
  await ensureDocumentDeliverySchema();
  await ensureEmailQueueSchema();
  const source = JSON.stringify(data);
  const recipients = JSON.stringify(to);
  const requestKey = crypto.createHash('sha256').update([module, recordId, source, recipients].join('\n')).digest('hex');
  await pool.query(`INSERT INTO document_delivery_requests(request_key,related_module,related_record_id,source_json,recipients_json,created_by)
    VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE request_key=VALUES(request_key)`, [requestKey, module, String(recordId), source, recipients, createdBy || null]);
  const [[request]] = await pool.query('SELECT * FROM document_delivery_requests WHERE request_key=?', [requestKey]);
  if (request.email_queue_id) {
    const [[queue]] = await pool.query('SELECT id,status,message_id,last_error,provider_accepted_at FROM email_queue WHERE id=?', [request.email_queue_id]);
    return { document_pdf_url: `/api/email/documents/${request.id}/pdf`, delivery_status_url: `/api/email/documents/${request.id}`, request_id: request.id, generation_status: request.generation_status, email_queue_id: request.email_queue_id, email_status: queue?.status || 'PENDING', provider_accepted: Boolean(queue?.provider_accepted_at || queue?.status === 'SENT'), recipient_verified: false, existing: true };
  }
  const [claim] = await pool.query(`UPDATE document_delivery_requests SET generation_status='GENERATING',last_error=NULL
    WHERE id=? AND (generation_status IN ('PENDING','GENERATION_FAILED') OR (generation_status='GENERATING' AND updated_at < DATE_SUB(NOW(),INTERVAL 5 MINUTE)))`, [request.id]);
  if (!claim.affectedRows) return { document_pdf_url: `/api/email/documents/${request.id}/pdf`, delivery_status_url: `/api/email/documents/${request.id}`, request_id: request.id, generation_status: request.generation_status, email_status: 'NOT_QUEUED', provider_accepted: false, recipient_verified: false, existing: true };
  let conn;
  try {
    // The immutable source snapshot is the authority for rendering and its retained retry.
    const artifact = await createDocumentPdf(JSON.parse(request.source_json));
    // Keep the queue insert and validated document status in one transaction.
    // Workers cannot claim a message whose document bookkeeping did not commit.
    conn=await pool.getConnection();await conn.beginTransaction();
    if(beforeQueue)await beforeQueue(conn);
    const queueId = await queueEmail({ templateKey:'document_pdf', to, subject, html, text, deliveryPolicy, attachments: [{ filename: artifact.filename, content: artifact.buffer, contentType: 'application/pdf', contentDisposition: 'attachment' }], relatedModule: module, relatedRecordId: recordId, createdBy, idempotencyKey: idempotencyKey || `document:${requestKey}` },conn);
    const [[queued]] = await conn.query('SELECT attachments_json FROM email_queue WHERE id=?',[queueId]);
    const savedAttachments=restoreAttachments(JSON.parse(queued.attachments_json));
    if(savedAttachments.length!==1)throw Object.assign(new Error('The queued document must contain exactly one PDF.'),{code:'PDF_ATTACHMENT_INVALID'});
    const queuedValidation=await validatePdf(savedAttachments[0].content,{expectedText:[data.title,data.reference,data.party,data.period]});
    await conn.query(`UPDATE document_delivery_requests SET generation_status='VALIDATED',pdf_sha256=?,pdf_pages=?,email_queue_id=?,last_error=NULL WHERE id=?`, [queuedValidation.sha256, queuedValidation.pages, queueId, request.id]);
    if(afterQueue)await afterQueue(conn,queueId,request.id);
    await conn.commit();
    return { document_pdf_url: `/api/email/documents/${request.id}/pdf`, delivery_status_url: `/api/email/documents/${request.id}`, request_id: request.id, generation_status: 'VALIDATED', email_queue_id: queueId, email_status: 'PENDING', provider_accepted: false, recipient_verified: false, existing: false };
  } catch (error) {
    if(conn){await conn.rollback().catch(()=>{});conn.release();conn=null;}
    // A lost commit response must not downgrade an already committed document.
    await pool.query(`UPDATE document_delivery_requests SET generation_status='GENERATION_FAILED',last_error=? WHERE id=? AND generation_status<>'VALIDATED'`, [String(error.message || error).slice(0, 4000), request.id]);
    error.document_request_id = request.id;
    throw error;
  } finally {if(conn)conn.release();}
}
module.exports = { queueDocumentEmail, ensureDocumentDeliverySchema };
