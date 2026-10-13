'use strict';
const { queueDocumentEmail } = require('./documentDeliveryService');
const { validateRecipients } = require('./emailService');
const pool = require('../config/db');
const crypto = require('node:crypto');
const { restoreAttachments } = require('./emailQueue');
const { validatePdf } = require('./documentPdfService');
function recipientCount(json) { try { const value=JSON.parse(json || '[]');return Array.isArray(value)?value.length:null; } catch { return null; } }
async function readReleasePdfEvidence(requestId,id,db=pool) {
  const [[request]]=await db.query('SELECT id,related_module,related_record_id,source_json,generation_status,pdf_sha256,pdf_pages,email_queue_id FROM document_delivery_requests WHERE id=?',[requestId]);
  if (!request || request.related_module!=='security' || request.related_record_id!==`release:${id}`) throw Object.assign(new Error('Release verification source did not match the authorised fixture.'),{code:'RELEASE_FIXTURE_MISMATCH'});
  const evidence={request_id:Number(request.id),generation_status:request.generation_status,source_sha256:crypto.createHash('sha256').update(request.source_json).digest('hex'),pdf_sha256:request.pdf_sha256,pdf_pages:Number(request.pdf_pages||0),email_queue_id:request.email_queue_id,recipient_verified:false};
  if (!request.email_queue_id) return evidence;
  const [[queue]]=await db.query('SELECT id,status,attempts,max_attempts,next_attempt_at,last_error,message_id,provider_accepted_at,to_json,cc_json,bcc_json,attachments_json FROM email_queue WHERE id=?',[request.email_queue_id]);
  if (!queue) return {...evidence,email_status:'MISSING'};
  Object.assign(evidence,{email_status:queue.status,attempts:Number(queue.attempts),max_attempts:Number(queue.max_attempts),next_attempt_at:queue.next_attempt_at,provider_message_id_present:Boolean(queue.message_id),provider_accepted:Boolean(queue.provider_accepted_at),to_count:recipientCount(queue.to_json),cc_count:recipientCount(queue.cc_json),bcc_count:recipientCount(queue.bcc_json),failure_boundary:/relay must support validated PDF bytes/i.test(queue.last_error||'')?'RELAY_PREFLIGHT_CONTRACT':queue.last_error?'REVIEW_ERROR_IN_AUTHORISED_QUEUE':'NONE'});
  try {
    const source=JSON.parse(request.source_json),attachments=restoreAttachments(JSON.parse(queue.attachments_json||'[]'));
    evidence.attachment_count=attachments.length;
    if (attachments.length!==1) throw Object.assign(new Error('Expected one release PDF.'),{code:'PDF_ATTACHMENT_INVALID'});
    const checked=await validatePdf(attachments[0].content,{expectedText:[source.title,source.reference]});
    evidence.queue_pdf={filename:attachments[0].filename,content_type:attachments[0].contentType,byte_length:attachments[0].content.length,sha256:checked.sha256,pages:checked.pages,matches_request:checked.sha256===request.pdf_sha256};
  } catch(error) { evidence.queue_pdf={valid:false,error_code:error.code||'PDF_VERIFICATION_FAILED'}; }
  return evidence;
}
function releaseVerificationData(id) {
  return { title:'DOCUMENT DELIVERY VERIFICATION', reference:`RELEASE-${id}`, filename:`voxel-veda-release-${id}`, issueDate:'2026-10-11',
    columns:[{label:'Verification',width:2},{label:'Expected result',width:3}],rows:[['Document identity',`RELEASE-${id}`],['File format','Genuine parser-validated PDF'],['Attachment metadata','application/pdf; .pdf filename'],['Sender','info@voxelveda.com']],
    notes:['Authorised release test. This is a delivery verification fixture and does not represent a customer, supplier, invoice, purchase order or payroll record.','Provider acceptance is tracked separately from recipient receipt and opening.'] };
}
async function queueAuthorisedReleasePdf() {
  const recipient=String(process.env.VV_RELEASE_TEST_RECIPIENT || '').trim();
  const id=String(process.env.VV_RELEASE_TEST_ID || '').trim();
  if(!recipient || !id)return {enabled:false};
  if(!/^[a-zA-Z0-9_-]{1,60}$/.test(id))throw new Error('Release test ID must contain only letters, numbers, underscores or hyphens.');
  const result=await queueDocumentEmail({module:'security',recordId:`release:${id}`,data:releaseVerificationData(id),to:validateRecipients(recipient,'to'),
    subject:`Voxel Veda PDF release verification ${id}`,text:`The authorised release verification PDF RELEASE-${id} is attached. Please open it and verify the document identity and PDF filename. This message does not represent business records.`});
  return {enabled:true,...result,evidence:await readReleasePdfEvidence(result.request_id,id)};
}
module.exports={queueAuthorisedReleasePdf,releaseVerificationData,readReleasePdfEvidence};
