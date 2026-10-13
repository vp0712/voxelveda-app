const pool = require('../config/db');
const {
  isEmailConfigured,
  missingSmtpKeys,
  smtpConfig,
  verifyConnection,
  sendMail,
  emailFailureDetails,
  isEmailTransportError
} = require('../services/emailService');
const { processEmailQueue, RETAINED_EMAIL_MODULES } = require('../services/emailQueue');
const { ensureEmailQueueSchema } = require('../services/emailQueueSchema');
const { isRelayConfigured, isHostingerMailApiConfigured } = require('../services/emailService');
const { renderEmailTemplate, templates } = require('../services/emailTemplates');
const { ensureWorkforceSchema } = require('../services/workforceSchema');
const { companyProfile } = require('../config/companyProfile');

function pageSize(value) {
  return Math.max(1, Math.min(Number(value) || 25, 100));
}

function masked(value) {
  const text = String(value || '');
  if (!text) return '';
  const at = text.indexOf('@');
  if (at > 2) return `${text.slice(0, 2)}***${text.slice(at)}`;
  return `${text.slice(0, 2)}***`;
}

exports.config = async (_req, res) => {
  const config = smtpConfig();
  const company = companyProfile();
  const selected=String(process.env.EMAIL_PRIMARY_TRANSPORT || '').trim().toLowerCase() || (isRelayConfigured()?'https_relay':isHostingerMailApiConfigured()?'hostinger_mail_api':'smtp');
  return res.json({
    transport: selected,
    provider: selected==='https_relay' ? 'WordPress HTTPS company relay' : selected==='hostinger_mail_api' ? 'Configured Hostinger mail API' : selected==='smtp' ? 'Company SMTP' : 'Unknown configured transport; administrator review required',
    configured: selected==='https_relay'?isRelayConfigured():selected==='hostinger_mail_api'?isHostingerMailApiConfigured():selected==='smtp'?missingSmtpKeys().length===0:false,
    missing: missingSmtpKeys(),
    host: config.host,
    port: config.port,
    secure: config.secure,
    username: masked(config.user),
    from_name: config.fromName,
    from_address: config.fromEmail,
    reply_to: config.replyTo,
    support_address: company.supportEmail,
    password_configured: Boolean(config.pass)
  });
};

exports.verify = async (_req, res) => {
  try {
    const result = await verifyConnection();
    return res.json({ message: 'Company email transport connection verified. Recipient delivery remains unverified.', ...result });
  } catch (error) {
    console.error('SMTP VERIFY ERROR:', error.message);
    const details = emailFailureDetails(error);
    return res.status(details.status).json(details);
  }
};

exports.sendTest = async (req, res) => {
  try {
    const recipient = String(req.body.to || req.user?.email || '').trim();
    const rendered = renderEmailTemplate('general_notification', {
      subject: 'Voxel Veda company email test',
      preview: 'An authorised company email transport test.',
      title: 'Voxel Veda email test',
      message: 'This authorised message tests the configured company email transport. Provider acceptance is recorded separately from recipient receipt and opening.'
    });
    const result = await sendMail({
      to: recipient,
      ...rendered,
    });
    return res.json({
      message: 'The provider accepted the authorised test message. Recipient receipt and opening remain unverified.',
      message_id: result.messageId || null,
      transport:result.transport || null,
      provider_accepted:true,
      recipient_verified:false
    });
  } catch (error) {
    console.error('SMTP TEST ERROR:', error.message);
    const details = isEmailTransportError(error)
      ? emailFailureDetails(error)
      : { status: 400, message: error.message, code: error.code || 'EMAIL_TEST_FAILED' };
    return res.status(details.status).json(details);
  }
};

exports.queue = async (req, res) => {
  try {
    await ensureEmailQueueSchema();
    const limit = pageSize(req.query.limit);
    const page = Math.max(1, Number(req.query.page) || 1);
    const status = String(req.query.status || '').trim().toUpperCase();
    const params = [...RETAINED_EMAIL_MODULES];
    const allowed = RETAINED_EMAIL_MODULES.map(() => '?').join(',');
    const where = `WHERE related_module IN (${allowed})${status ? ' AND status=?' : ''}`;
    if (status) params.push(status);
    params.push(limit, (page - 1) * limit);
    const [rows] = await pool.query(
      `SELECT id, template_key, to_json, subject, related_module, related_record_id, status,
        attempts, max_attempts, scheduled_at, next_attempt_at, last_error, message_id, created_at, sent_at, provider_accepted_at, recipient_verified_at
       FROM email_queue ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      params
    );
    const [countRows] = await pool.query(
      `SELECT status, COUNT(*) AS total FROM email_queue WHERE related_module IN (${RETAINED_EMAIL_MODULES.map(() => '?').join(',')}) GROUP BY status`, RETAINED_EMAIL_MODULES
    );
    const counts = countRows.reduce((result, row) => {
      result[String(row.status || 'UNKNOWN').toUpperCase()] = Number(row.total || 0);
      return result;
    }, {});
    return res.json({ emails: rows.map(row=>({...row,provider_accepted:Boolean(row.provider_accepted_at || row.status==='SENT'),recipient_verified:Boolean(row.recipient_verified_at)})), counts, page, limit });
  } catch (error) {
    console.error('EMAIL QUEUE LIST ERROR:', error);
    return res.status(500).json({ message: 'Unable to load the email queue.' });
  }
};

exports.logs = async (req, res) => {
  try {
    await ensureEmailQueueSchema();
    const limit = pageSize(req.query.limit);
    const [rows] = await pool.query(
      `SELECT id, queue_id, related_module, related_record_id, recipients, subject, status,
        provider_message_id, error_message, created_by, created_at
       FROM email_logs WHERE related_module IN (${RETAINED_EMAIL_MODULES.map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT ?`,
      [...RETAINED_EMAIL_MODULES,limit]
    );
    return res.json({ logs: rows });
  } catch (error) {
    console.error('EMAIL LOG LIST ERROR:', error);
    return res.status(500).json({ message: 'Unable to load email delivery logs.' });
  }
};

exports.process = async (req, res) => {
  try {
    const outcomes = await processEmailQueue(pageSize(req.body.limit || 10));
    return res.json({ message: 'Email queue processed.', outcomes });
  } catch (error) {
    console.error('EMAIL QUEUE PROCESS ERROR:', error);
    return res.status(500).json({ message: 'Unable to process the email queue.', code: 'EMAIL_QUEUE_ERROR' });
  }
};

exports.retry = async (req, res) => {
  let connection;
  try {
    await ensureEmailQueueSchema();
    const id=Number(req.params.id);
    if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({message:'Select a valid email delivery.'});
    connection=await pool.getConnection();
    await connection.beginTransaction();
    const [[previous]]=await connection.query('SELECT id,status,attempts,related_module FROM email_queue WHERE id=? FOR UPDATE',[id]);
    if(!previous||!['FAILED','RETRY'].includes(previous.status)||!RETAINED_EMAIL_MODULES.includes(previous.related_module)){
      await connection.rollback();
      return res.status(409).json({message:'Only confirmed failed emails can be retried. Accepted or uncertain deliveries require review.'});
    }
    const [result] = await connection.query(
      `UPDATE email_queue SET status = 'RETRY', attempts = 0, next_attempt_at = NOW(), last_error = NULL
       WHERE id = ? AND status IN ('FAILED', 'RETRY') AND related_module IN (${RETAINED_EMAIL_MODULES.map(() => '?').join(',')})`,
      [id,...RETAINED_EMAIL_MODULES]
    );
    if (!result.affectedRows){await connection.rollback();return res.status(409).json({ message: 'This delivery changed. Refresh before retrying.' });}
    await require('../services/auditService').logAudit(connection,{actorId:req.user.id,action:'DOCUMENT_EMAIL_RETRY_REQUESTED',module:previous.related_module,recordType:'email_queue',recordId:id,oldValue:{status:previous.status,attempts:previous.attempts},newValue:{status:'RETRY',attempts:0},ipAddress:req.ip,userAgent:req.get('user-agent'),requestId:req.requestId,sessionId:req.session?.id});
    await connection.commit();
    return res.json({ message: 'Email queued for retry.' });
  } catch (error) {
    if(connection)await connection.rollback().catch(()=>{});
    console.error('EMAIL RETRY ERROR:', error);
    return res.status(500).json({ message: 'Unable to retry this email.' });
  } finally {if(connection)connection.release();}
};

exports.templates = async (_req, res) => res.json({
  templates: Object.entries(templates).map(([key, value]) => ({
    key,
    subject: value.subject,
    supports_html: true,
    supports_text: true
  }))
});

async function mayViewDelivery(user,request,db=pool){
 if(!user || !Number.isSafeInteger(Number(user.id)) || Number(user.id)<1)return false;
 const {mayViewDocument}=require('../services/documentSecurityService');
 const {customerScoped,ownsCustomerRecord}=require('../services/customerRecordScope');
 if(customerScoped(user) && request.related_module==='invoices' && String(request.related_record_id).startsWith('statement:')) {
  if(!require('../services/authorizationService').hasPermission(user,'VIEW_FINANCE'))return false;
  let source;
  try { source=JSON.parse(request.source_json || '{}'); } catch { return false; }
  return ownsCustomerRecord(user,source.customerEmail);
 }
 let owner=null;
 if(request.related_module==='timesheets'){
  const related=String(request.related_record_id || '');
  if(/^[1-9]\d*$/.test(related)){const [[sheet]]=await db.query('SELECT user_id FROM weekly_timesheets WHERE id=? LIMIT 1',[Number(related)]);owner=sheet?.user_id || null;}
  else {const selected=related.match(/^([1-9]\d*):\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/);if(selected)owner=Number(selected[1]);}
 }else if(['profile','security'].includes(request.related_module))owner=request.created_by || null;
 return mayViewDocument(user,{module:request.related_module,owner_user_id:owner,record_type:request.related_module==='tasks'?'task':'document',record_id:request.related_record_id,classification:'CONFIDENTIAL',access_policy:'MODULE_OR_OWNER'},db);
}
exports.documentStatus=async(req,res)=>{
 try{
  await require('../services/documentDeliveryService').ensureDocumentDeliverySchema();
  const [[request]]=await pool.query('SELECT id,related_module,related_record_id,generation_status,pdf_sha256,pdf_pages,email_queue_id,last_error,created_by,created_at,updated_at,source_json FROM document_delivery_requests WHERE id=?',[req.params.id]);
  if(!request||!RETAINED_EMAIL_MODULES.includes(request.related_module))return res.status(404).json({message:'Document delivery request not found.'});
  if(!await mayViewDelivery(req.user,request))return res.status(403).json({message:'Document delivery is outside your authorised module or staff scope.'});
  const [[email]]=request.email_queue_id?await pool.query('SELECT id,status,attempts,last_error,message_id,provider_accepted_at,recipient_verified_at FROM email_queue WHERE id=?',[request.email_queue_id]):[[]];
  const {source_json,...metadata}=request;
  return res.json({document:metadata,email:email?{...email,provider_accepted:Boolean(email.provider_accepted_at || email.status==='SENT'),recipient_verified:Boolean(email.recipient_verified_at)}:null});
 }catch(error){return res.status(500).json({message:'Document delivery status could not be loaded. Please retry.'});}
};
exports.documentPdf=async(req,res)=>{
 try{
  await require('../services/documentDeliveryService').ensureDocumentDeliverySchema();
  const [[request]]=await pool.query('SELECT * FROM document_delivery_requests WHERE id=?',[req.params.id]);
  if(!request||!RETAINED_EMAIL_MODULES.includes(request.related_module))return res.status(404).json({message:'Document delivery request not found.'});
  if(!await mayViewDelivery(req.user,request))return res.status(403).json({message:'Document delivery is outside your authorised module or staff scope.'});
  if(!request.email_queue_id||request.generation_status!=='VALIDATED')return res.status(409).json({message:'The document PDF is not validated yet. Retry generation before downloading.'});
  const [[email]]=await pool.query('SELECT attachments_json FROM email_queue WHERE id=?',[request.email_queue_id]);
  const {restoreAttachments}=require('../services/emailQueue');
  const {validatePdf,sendPdfResponse}=require('../services/documentPdfService');
  const attachments=restoreAttachments(JSON.parse(email?.attachments_json || '[]'));
  if(attachments.length!==1)throw Object.assign(new Error('The document attachment is unavailable.'),{status:422});
  const bytes=attachments[0].content,data=JSON.parse(request.source_json);
  const validation=await validatePdf(bytes,{expectedText:[data.title,data.reference,data.party,data.period]});
  if(validation.sha256!==request.pdf_sha256)throw Object.assign(new Error('The stored PDF does not match the validated document version.'),{status:409});
  return await sendPdfResponse(res,{buffer:bytes,filename:attachments[0].filename},Boolean(req.query.download));
 }catch(error){return res.status(error.status || 500).json({message:error.message,code:error.code || 'PDF_DOCUMENT_INVALID'});}
};
exports._test={mayViewDelivery};
