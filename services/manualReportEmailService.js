'use strict';
// Only server-owned, permission-checked document renderers may create a manual
// report snapshot. Neither URLs, HTML nor PDF bytes are accepted from a caller.
const crypto = require('node:crypto');
const pool = require('../config/db');
const { hasPermission, hasAnyPermission } = require('./authorizationService');
const { customerScoped, customerEmail } = require('./customerRecordScope');
const { stableJsonText, logAudit } = require('./auditService');
const { PDF_ARTIFACT_CAPTURE, validateDocumentPdf, safePdfFilename } = require('./documentPdfService');
const { validateRecipients } = require('./emailService');
const { queueDocumentEmail, deliveryMessage, ensureDocumentDeliverySchema } = require('./documentDeliveryService');
const { ensureEmailQueueSchema } = require('./emailQueueSchema');
const objectStorage = require('./objectStorageService');

const REGISTER_PERMISSIONS = Object.freeze({ rfqs:['VIEW_RFQS'], invoices:['VIEW_FINANCE'], customers:['VIEW_CUSTOMERS'], suppliers:['VIEW_SUPPLIERS'], stock:['VIEW_INVENTORY'], materials:['VIEW_INVENTORY'], staff:['MANAGE_USERS'], competitors:['VIEW_CUSTOMERS'], roster:['VIEW_ATTENDANCE','EDIT_ATTENDANCE'], timesheets:[], expenses:['VIEW_FINANCE'] });
const TYPES = Object.freeze({
  register: {title:'Application register',permissions:[]},
  invoice: {title:'Invoice',permissions:['VIEW_FINANCE','EDIT_FINANCE']},
  'customer-statement': {title:'Customer statement',permissions:['VIEW_FINANCE']},
  'purchase-order': {title:'Purchase order',permissions:['VIEW_PROCUREMENT','CREATE_PURCHASE_ORDER']},
  procurement: {title:'Procurement report',permissions:['VIEW_PROCUREMENT']},
  'qms-register': {title:'Quality register',permissions:[],any:['VIEW_QMS','VIEW_COMPLIANCE']},
  'qms-record': {title:'Controlled quality record',permissions:[],any:['VIEW_QMS','VIEW_COMPLIANCE']},
  coc: {title:'Certificate of conformance',permissions:[],any:['VIEW_QMS','VIEW_COMPLIANCE']},
  'material-process-sheet': {title:'Material process sheet',permissions:['VIEW_INVENTORY']}
});
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
let activeSends=0;
function sendCapacity() {
  const configured=Number(pool.pool?.config?.connectionLimit || process.env.DB_CONNECTION_LIMIT || 10);
  // Each send can retain a lock, a queue transaction and source-render reads.
  // Reserve pool headroom; fail fast instead of holding all pooled connections.
  return Math.max(0,Math.min(2,Math.floor((configured-1)/4)));
}
function fail(message,status=422,code='REPORT_EMAIL_INVALID',fields) { return Object.assign(new Error(message),{status,statusCode:status,code,...(fields?{errors:fields}:{})}); }
function hash(value) { return crypto.createHash('sha256').update(typeof value==='string' || Buffer.isBuffer(value)?value:stableJsonText(value)).digest('hex'); }
function object(value,field) { if(!value || typeof value!=='object' || Array.isArray(value) || Object.getPrototypeOf(value)!==Object.prototype)throw fail(`Use a valid ${field} object.`);return value; }
function fields(value,allowed) { for(const key of Object.keys(value))if(!allowed.includes(key))throw fail(`The ${key} field is not supported for this report.`); }
function recordId(value) { const text=String(value??'');if(!/^[1-9]\d{0,14}$/.test(text) || !Number.isSafeInteger(Number(text)))throw fail('Choose a valid saved record.');return text; }
function procurementId(value) { return UUID.test(String(value||''))?uuid(value):recordId(value); }
function uuid(value) { if(!UUID.test(String(value||'')))throw fail('Choose a valid saved report.');return String(value).toLowerCase(); }
function filters(value={}) { object(value,'report filters');for(const [key,item] of Object.entries(value))if(!/^[a-z][a-z0-9_]{0,63}$/i.test(key) || !['string','number','boolean'].includes(typeof item) || String(item).length>255)throw fail(`The ${key} filter is invalid.`);return JSON.parse(JSON.stringify(value)); }
function descriptor(input) {
  object(input,'report');
  fields(input,['type','report','record_id','filters','snapshot_id','register','source','ids','batch_id','expected_sha256','expected_source_hash']);
  const type=String(input.type||'');if(!Object.hasOwn(TYPES,type))throw fail('This saved document does not support manual report email.',404,'REPORT_EMAIL_UNSUPPORTED');
  const d={type};
  for(const name of ['expected_sha256','expected_source_hash'])if(input[name]!==undefined&&!HASH.test(String(input[name])))throw fail('Use a valid expected document hash.');
  if(type==='register') { if(!Object.hasOwn(REGISTER_PERMISSIONS,input.report))throw fail('This application report is not supported.',404,'REPORT_EMAIL_UNSUPPORTED');d.report=input.report;d.filters=filters(input.filters); }
  else if(type==='customer-statement') { d.filters=filters(input.filters);fields(d.filters,['search','customer_email','customer_name']); }
  else if(type==='invoice') {d.record_id=recordId(input.record_id);if(input.filters!==undefined){d.filters=filters(input.filters);fields(d.filters,['version']);if(d.filters.version&&!HASH.test(String(d.filters.version)))throw fail('Choose a valid saved invoice version.');}}
  else if(type==='qms-register') { if(!/^[a-z][a-z-]{0,59}$/.test(String(input.register||'')))throw fail('Choose a saved quality register.');d.register=input.register;d.filters=filters(input.filters); }
  else if(type==='procurement') {
    if(input.snapshot_id) {d.snapshot_id=uuid(input.snapshot_id);if(['report','record_id','filters','register','source','ids','batch_id'].some(key=>input[key]!==undefined))throw fail('Choose either a saved procurement snapshot or its report criteria.');}
    else {d.report=String(input.report||'register');d.source=String(input.source||'entries');d.filters=filters(input.filters);if(input.ids!==undefined){if(!Array.isArray(input.ids)||input.ids.length>500)throw fail('Choose at most 500 saved records.');d.ids=input.ids.map(procurementId);}if(input.batch_id!==undefined)d.batch_id=procurementId(input.batch_id);if(input.record_id!==undefined)d.record_id=procurementId(input.record_id);}
  } else d.record_id=recordId(input.record_id);
  const used=new Set([...Object.keys(d),'expected_sha256','expected_source_hash']);
  for(const key of Object.keys(input))if(!used.has(key))throw fail(`The ${key} field is not applicable to this report.`);
  return d;
}
function authorised(user,d) {
  if(!Number.isSafeInteger(Number(user?.id))||Number(user.id)<1)throw fail('Sign in to email a report.',401,'AUTH_REQUIRED');
  if(!hasPermission(user,'SEND_COMPANY_EMAIL'))throw fail('Company document email is not enabled for your account.',403,'PERMISSION_DENIED');
  const definition=TYPES[d.type];if(!definition)throw fail('This document type is unavailable.',404,'REPORT_EMAIL_UNSUPPORTED');
  const permissions=d.type==='register'?REGISTER_PERMISSIONS[d.report]:definition.permissions;
  if(!permissions || !permissions.every(p=>hasPermission(user,p)) || (definition.any&&!hasAnyPermission(user,definition.any)))throw fail('This report is not permitted for your account.',403,'PERMISSION_DENIED');
  if(d.type==='register'&&d.report==='timesheets'&&!hasAnyPermission(user,['VIEW_OWN_TIMESHEET','VIEW_TEAM_TIMESHEET','VIEW_ALL_TIMESHEETS']))throw fail('Timesheet reporting is not permitted for your account.',403,'PERMISSION_DENIED');
  if(d.type==='register'&&d.report==='expenses'&&customerScoped(user))throw fail('Company expense reports are restricted.',403,'PERMISSION_DENIED');
}
function catalog(user) {
  const reports=[],registers=[];
  for(const [type,value] of Object.entries(TYPES)) {
    if(type==='register') { for(const report of Object.keys(REGISTER_PERMISSIONS)){try{authorised(user,{type,report});registers.push(report);reports.push({type,report,title:report.replace(/-/g,' '),can_email:true});}catch{}} }
    else {try{authorised(user,{type});reports.push({type,title:value.title,can_email:true});}catch{}}
  }
  let qms_registers=[];if(reports.some(item=>item.type==='qms-register'))qms_registers=require('./qmsRegisterService').catalog(user);
  return {reports,registers,qms_registers};
}
async function capture(handler,req) {
  let status=200,body,artifact,error;
  const res={headers:{},status(code){status=code;return this;},json(value){body=value;return this;},setHeader(name,value){this.headers[String(name).toLowerCase()]=value;},set(name,value){this.setHeader(name,value);return this;},send(value){body=value;return this;},end(value){body=value;return this;},[PDF_ARTIFACT_CAPTURE](value){artifact=value;}};
  await handler(req,res,value=>{error=value;});
  if(error)throw error;
  if(status<200||status>=300||!artifact||!Buffer.isBuffer(body)||!Buffer.isBuffer(artifact.buffer)||!artifact.buffer.equals(body)||!artifact.documentData)throw fail(body?.message||'The authorised document renderer did not return a supported PDF. No email was queued.',status>=400?status:422,body?.code||'REPORT_EMAIL_SOURCE_FAILED');
  const data=JSON.parse(JSON.stringify(artifact.documentData));
  const validation=await validateDocumentPdf(body,data);
  return {data,artifact:{...artifact,buffer:body,filename:safePdfFilename(artifact.filename),sha256:validation.sha256,validation,...(HASH.test(String(res.headers['x-document-source-sha256']||''))?{sourceHash:res.headers['x-document-source-sha256']}:{})}};
}
function sourceRequest(req,d) { return {...req,user:req.user,params:{id:d.record_id,type:d.report,register:d.register},query:{...(d.filters||{}),download:'0'},body:{}}; }
async function render(req,d,{currentScope=false}={}) {
  authorised(req.user,d);
  if(d.type==='procurement') {
    const service=require('./procurementReportService');let snapshotId=d.snapshot_id;
    if(!snapshotId){const prepared=await service.createSnapshot({user:req.user,input:{type:d.report,source:d.source,filters:d.filters,ids:d.ids,batch_id:d.batch_id,record_id:d.record_id},req});snapshotId=prepared.snapshot_id;}
    const row=await service.getSnapshot({user:req.user,snapshotId}),artifact=await service.snapshotArtifact(row);
    return {data:JSON.parse(row.document_json),artifact:{...artifact,sourceHash:row.source_sha256},descriptor:{type:'procurement',snapshot_id:snapshotId}};
  }
  const source=sourceRequest(req,d);
  // The version parameter protects preparation from an outdated invoice view.
  // Later reads still check current ownership and every document field; a
  // provider-driven approved→sent transition alone must not revoke its PDF.
  if(currentScope&&d.type==='invoice')delete source.query.version;
  const handlers={register:()=>require('../controllers/originalReportController').download,invoice:()=>require('../controllers/invoiceController').viewInvoicePdf,'customer-statement':()=>require('../controllers/invoiceController').viewCustomerStatementPdf,'purchase-order':()=>require('../controllers/procurementDocumentController').pdf,'qms-register':()=>require('../controllers/qmsRegisterController').pdf,'qms-record':()=>require('../controllers/qmsDocumentController').recordPdf,coc:()=>require('../controllers/qms/qualityReleaseController').cocPdf,'material-process-sheet':()=>require('../controllers/materialController').viewProcessSheetPdf};
  const result=await capture(handlers[d.type](),source);
  if(d.type==='invoice'&&result.data.title!=='INVOICE')throw fail('Approve the invoice before emailing it.',409,'REPORT_EMAIL_APPROVAL_REQUIRED');
  if(d.type==='purchase-order'&&result.data.title!=='PURCHASE ORDER')throw fail('Approve the purchase order before emailing it.',409,'REPORT_EMAIL_APPROVAL_REQUIRED');
  return {...result,descriptor:d};
}
function authorityHash(d,data) {
  const source=JSON.parse(JSON.stringify(data));
  // Register/statement issue time describes rendering, not changed source data.
  // All rows, totals, identities, filters and statuses remain in the comparison.
  if(['register','qms-register','customer-statement'].includes(d.type))delete source.issueDate;
  return hash({descriptor:d,document:source});
}
function metadata(row) {
  const data=JSON.parse(row.document_json);
  return {snapshot_id:row.id,title:data.title,reference:data.reference,filename:row.filename,pdf_url:`/api/email/reports/${row.id}/pdf`,preview_url:`/api/email/reports/${row.id}/pdf`,download_url:`/api/email/reports/${row.id}/pdf?download=1`,status_url:`/api/email/reports/${row.id}`,sha256:row.pdf_sha256,source_hash:row.source_sha256,pdf_pages:Number(row.pdf_pages),generation_status:'VALIDATED',can_email:true,created_at:row.created_at};
}
function deliveryIdentity(row,d) {
  // The existing invoice queue worker records `sent` only after provider
  // acceptance. Preserve its original identity and lifecycle for manual mail.
  return d.type==='invoice'?{module:'invoices',recordId:d.record_id}:{module:'workflow',recordId:`manual:${row.id}`};
}
async function prepare(req,input) {
  const d=descriptor(input);authorised(req.user,d);
  if(!objectStorage.isConfigured())throw fail('Private report storage is unavailable. Ask an administrator to restore the configured storage connection.',503,'REPORT_EMAIL_STORAGE_UNAVAILABLE');
  const result=await render(req,d),data=result.data,artifact=result.artifact,sourceDescriptor=result.descriptor;
  const checked=await validateDocumentPdf(artifact.buffer,data),sourceHash=hash({descriptor:sourceDescriptor,document:data});
  if(input.expected_sha256&&input.expected_sha256!==checked.sha256 || input.expected_source_hash&&input.expected_source_hash!==(artifact.sourceHash||sourceHash))throw fail('The document differs from the version you reviewed. Open the current report before emailing it.',409,'PDF_DOCUMENT_CHANGED');
  const storageKey=`manual-report-pdf/${Number(req.user.id)}/${checked.sha256}.pdf`;
  // A private content-addressed original remains available across restarts and
  // deploys. A failed DB transaction can leave only an inaccessible orphan;
  // never delete a shared content-addressed object during rollback.
  await objectStorage.putObject(storageKey,artifact.buffer,'application/pdf');
  const savedBytes=await objectStorage.getObject(storageKey);
  if(!savedBytes.equals(artifact.buffer)||hash(savedBytes)!==checked.sha256)throw fail('Private report storage did not retain the validated PDF bytes.',422,'PDF_SNAPSHOT_MISMATCH');
  const row={id:crypto.randomUUID(),created_by:req.user.id,source_type:sourceDescriptor.type,descriptor_json:JSON.stringify(sourceDescriptor),document_json:JSON.stringify(data),authority_sha256:authorityHash(sourceDescriptor,data),source_sha256:sourceHash,pdf_storage_key:storageKey,pdf_sha256:checked.sha256,pdf_pages:checked.pages,filename:safePdfFilename(artifact.filename),created_at:new Date()};
  const conn=await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`INSERT INTO manual_report_snapshots(id,created_by,source_type,descriptor_json,document_json,authority_sha256,source_sha256,pdf_storage_key,pdf_sha256,pdf_pages,filename) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,[row.id,row.created_by,row.source_type,row.descriptor_json,row.document_json,row.authority_sha256,row.source_sha256,row.pdf_storage_key,row.pdf_sha256,row.pdf_pages,row.filename]);
    await logAudit(conn,{actorId:req.user.id,action:'REPORT_EMAIL_SNAPSHOT_PREPARED',module:'workflow',recordType:'manual_report',recordId:row.id,newValue:{source_type:row.source_type,pdf_hash:row.pdf_sha256,source_hash:row.source_sha256,pages:row.pdf_pages},ipAddress:req.ip,userAgent:req.get?.('user-agent')});
    await conn.commit();
  }catch(error){await conn.rollback().catch(()=>{});throw error;}finally{conn.release();}
  return metadata(row);
}
async function getSnapshot(req,id,{db=pool}={}) {
  id=uuid(id);const [[row]]=await db.query('SELECT * FROM manual_report_snapshots WHERE id=?',[id]);
  if(!row||Number(row.created_by)!==Number(req.user?.id))throw fail('Report snapshot not found.',404,'REPORT_EMAIL_NOT_FOUND');
  const d=descriptor(JSON.parse(row.descriptor_json));authorised(req.user,d);
  const data=JSON.parse(row.document_json);
  if(hash({descriptor:d,document:data})!==row.source_sha256||authorityHash(d,data)!==row.authority_sha256)throw fail('The saved report source failed integrity validation.',422,'PDF_SNAPSHOT_MISMATCH');
  // A saved snapshot never freezes access rights. Re-run the original source
  // scope before reading private bytes, even for status/retry callers. A team
  // change or customer reassignment cannot be bypassed with an old snapshot ID.
  const current=await render(req,d,{currentScope:true});
  if(authorityHash(current.descriptor,current.data)!==row.authority_sha256)throw fail('The report source or your authorised selection changed. Prepare and review a current report before sending.',409,'REPORT_EMAIL_SOURCE_CHANGED');
  if(row.pdf_storage_key!==`manual-report-pdf/${Number(row.created_by)}/${row.pdf_sha256}.pdf`)throw fail('The saved report storage identity is invalid.',422,'PDF_SNAPSHOT_MISMATCH');
  const bytes=await objectStorage.getObject(row.pdf_storage_key);
  const checked=await validateDocumentPdf(bytes,data);
  if(checked.sha256!==row.pdf_sha256||checked.pages!==Number(row.pdf_pages)||safePdfFilename(row.filename)!==row.filename)throw fail('The saved report PDF failed integrity validation.',422,'PDF_SNAPSHOT_MISMATCH');
  return {row,data,descriptor:d,artifact:{buffer:bytes,filename:row.filename,sha256:checked.sha256,validation:checked}};
}
async function status(req,id) {
  const {row,descriptor:d}=await getSnapshot(req,id);
  await ensureDocumentDeliverySchema();
  fields(req.query||{},['request_id']);
  const clientId=req.query?.request_id?uuid(req.query.request_id):null;
  const identity=deliveryIdentity(row,d),requestKey=clientId?hash([identity.module,'send-intent',`manual:${req.user.id}:${clientId}`].join('\n')):null;
  const [sends]=await pool.query(`SELECT r.id request_id,r.generation_status,r.pdf_sha256,r.email_queue_id,r.last_error generation_error,r.created_at,q.status email_status,q.last_error,q.message_id,q.provider_accepted_at,q.recipient_verified_at FROM document_delivery_requests r LEFT JOIN email_queue q ON q.id=r.email_queue_id WHERE r.related_module=? AND r.related_record_id=? AND r.created_by=? AND (r.pdf_sha256=? OR r.pdf_sha256 IS NULL)${requestKey?' AND r.request_key=?':''} ORDER BY r.id DESC LIMIT 50`,[identity.module,identity.recordId,req.user.id,row.pdf_sha256,...(requestKey?[requestKey]:[])]);
  return {...metadata(row),sends:sends.map(send=>({...send,...(clientId?{client_request_id:clientId}:{}),provider_accepted:Boolean(send.provider_accepted_at||send.email_status==='SENT'),recipient_verified:Boolean(send.recipient_verified_at),delivery_status_url:`/api/email/documents/${send.request_id}`}))};
}
async function send(req,id,input) {
  object(input,'send request');fields(input,['to','expected_sha256','request_id']);
  if(!UUID.test(String(input.request_id||'')))throw fail('Use the original Send request ID when retrying.',422,'DOCUMENT_SEND_ID_INVALID');
  if(!HASH.test(String(input.expected_sha256||'')))throw fail('Review the report PDF before sending.',422,'PDF_SNAPSHOT_REQUIRED');
  if(typeof input.to!=='string'||input.to.trim().length>254||!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(input.to.trim()))throw fail('Enter exactly one recipient email address.',422,'REPORT_EMAIL_RECIPIENT_INVALID',{to:'Enter one email address.'});
  const to=validateRecipients(input.to.trim(),'to');if(to.length!==1)throw fail('Enter exactly one recipient email address.',422,'REPORT_EMAIL_RECIPIENT_INVALID');
  const {row,data,artifact,descriptor:d}=await getSnapshot(req,id);
  if(input.expected_sha256!==row.pdf_sha256)throw fail('The reviewed PDF does not match this saved document.',409,'PDF_DOCUMENT_CHANGED');
  if(customerScoped(req.user)&&to[0].toLowerCase()!==customerEmail(req.user))throw fail('Use your authorised customer email for this document.',403,'REPORT_EMAIL_RECIPIENT_FORBIDDEN');
  const requestIdentity=`manual:${req.user.id}:${input.request_id.toLowerCase()}`;
  const identity=deliveryIdentity(row,d);
  // Preparing again or reopening a dialog creates a new browser intent, but
  // must not bypass an earlier pending/accepted/uncertain report. The named
  // lock spans the durable queue commit and serializes replicas/devices.
  const lockKey=`manual-report:${hash([req.user.id,row.authority_sha256,to[0].toLowerCase()]).slice(0,48)}`;
  if(activeSends>=sendCapacity())throw fail('Report email is busy or its database pool needs more headroom. No send was attempted; retry after the current actions finish.',503,'REPORT_EMAIL_SEND_BUSY');
  activeSends++;let guard,locked=false;
  try {
    await ensureDocumentDeliverySchema();
    await ensureEmailQueueSchema();
    guard=await pool.getConnection();
    const [[lock]]=await guard.query('SELECT GET_LOCK(?,0) AS acquired',[lockKey]);
    locked=Number(lock?.acquired)===1;
    if(!locked)throw fail('Another Send action is being reconciled. Check saved delivery status before trying again.',409,'REPORT_EMAIL_SEND_BUSY');
    const [[previous]]=await guard.query(`SELECT q.id email_queue_id,q.status email_status,q.message_id,q.provider_accepted_at,q.recipient_verified_at,r.id document_request_id,r.request_key,m.id snapshot_id
      FROM email_queue q JOIN manual_report_snapshots m ON q.idempotency_key LIKE CONCAT('manual-report:',m.id,':%')
      LEFT JOIN document_delivery_requests r ON r.email_queue_id=q.id
      WHERE m.created_by=? AND m.authority_sha256=? AND LOWER(q.to_json)=LOWER(?) ORDER BY q.id DESC LIMIT 1`,[req.user.id,row.authority_sha256,JSON.stringify(to)]);
    const expectedKey=hash([identity.module,'send-intent',requestIdentity].join('\n'));
    if(previous&&previous.request_key!==expectedKey){
      const uncertain=['SENDING','PROCESSING','REVIEW_REQUIRED'].includes(previous.email_status);
      const accepted=Boolean(previous.provider_accepted_at||previous.message_id||previous.email_status==='SENT');
      const message=uncertain?'An earlier report to this recipient has an uncertain delivery outcome. Review that retained delivery; no second message was queued.':accepted?'The provider already accepted this report for this recipient. Recipient receipt remains separate. An authorised explicit resend or revision is required; no second message was queued.':'This report already has a retained delivery request for this recipient. Review its status and use controlled retry for confirmed failures; no second message was queued.';
      throw Object.assign(fail(message,409,uncertain?'DELIVERY_REVIEW_REQUIRED':'REPORT_EMAIL_EXISTING_DELIVERY'),{document_request_id:previous.document_request_id,existing_delivery:{...previous,provider_accepted:accepted,recipient_verified:Boolean(previous.recipient_verified_at),delivery_status_url:previous.document_request_id?`/api/email/documents/${previous.document_request_id}`:null}});
    }
    const delivery=await queueDocumentEmail({module:identity.module,recordId:identity.recordId,data,to,createdBy:req.user.id,requestIdentity,idempotencyKey:`manual-report:${row.id}:${input.request_id.toLowerCase()}`,validatedArtifact:artifact,subject:`Voxel Veda ${data.title} — ${data.reference || 'report'}`.replace(/[\r\n]/g,' ').slice(0,250),text:`${data.title}${data.reference?` (${data.reference})`:''} is attached as a validated PDF. This is the report version reviewed before this Send action.`,
    beforeQueue:async conn=>{
      if(d.type==='invoice'){
        const [[current]]=await conn.query('SELECT id,status,deleted FROM invoices WHERE id=? FOR UPDATE',[d.record_id]);
        if(!current||current.deleted||!['approved','sent','paid'].includes(String(current.status).toLowerCase()))throw fail('The invoice changed or needs approval. Review its current status before retrying.',409,'REPORT_EMAIL_APPROVAL_REQUIRED');
      }
      await getSnapshot(req,row.id);
    },
    afterQueue:async(conn,queueId,documentRequestId)=>{
      if(d.type==='invoice')await conn.query('INSERT INTO invoice_activity(invoice_id,action_type,notes,created_by) VALUES(?,?,?,?)',[d.record_id,'email_queued',`Queued validated invoice PDF; queue ${queueId}`,req.user.id]);
      await logAudit(conn,{actorId:req.user.id,action:'REPORT_EMAIL_QUEUED',module:'workflow',recordType:'manual_report',recordId:row.id,requestId:input.request_id,newValue:{pdf_hash:row.pdf_sha256,source_hash:row.source_sha256,email_queue_id:queueId,document_request_id:documentRequestId,recipient_count:1},ipAddress:req.ip,userAgent:req.get?.('user-agent')});
    }});
    return {...metadata(row),...delivery,message:deliveryMessage(delivery,data.title||'Report'),email_sent:false};
  } finally {if(locked)await guard.query('SELECT RELEASE_LOCK(?)',[lockKey]).catch(()=>{});guard?.release();activeSends--;}
}
module.exports={catalog,prepare,getSnapshot,metadata,status,send,_test:{descriptor,authorised,capture,render,authorityHash,hash,REGISTER_PERMISSIONS,TYPES}};
