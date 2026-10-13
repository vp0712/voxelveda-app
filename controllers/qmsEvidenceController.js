const crypto = require('crypto');
const pool = require('../config/db');
const { ensureQmsEnterpriseCompletionSchema } = require('../services/qmsEnterpriseCompletionSchema');
const { logAudit } = require('../services/auditService');
const { getAuthorisedDocument } = require('../services/documentSecurityService');
function actor(req){return Number(req.user?.id||req.user?.user_id||0)||null}
function clean(v,max=255){return String(v??'').trim().slice(0,max)}
async function list(req,res,next){
 try{
  await ensureQmsEnterpriseCompletionSchema();
  const [rows]=await pool.query('SELECT * FROM qms_evidence_index WHERE record_type=? AND record_id=? ORDER BY uploaded_at DESC',[clean(req.params.type,80),clean(req.params.id,80)]);
  const evidence=[];
  for(const row of rows){const access=await getAuthorisedDocument(req.user,row.secure_document_id);if(access.status===200)evidence.push(row);}
  return res.json({evidence});
 }catch(error){return next(error);}
}
async function register(req,res,next){
 let connection;
 try{
  await ensureQmsEnterpriseCompletionSchema();
  const recordType=clean(req.body.record_type,80).toUpperCase(),recordId=clean(req.body.record_id,80);
  if(!recordType||!recordId)return res.status(400).json({message:'record_type and record_id are required.'});
  if(['BANKING','FINANCE','ERP','PERSONAL_FINANCE'].includes(recordType))return res.status(410).json({message:'This evidence workflow has been retired.',code:'MODULE_RETIRED'});
  const access=await getAuthorisedDocument(req.user,req.body.secure_document_id);
  if(access.status!==200)return res.status(access.status).json({message:'The uploaded secure document is unavailable or access is denied.',code:'EVIDENCE_DOCUMENT_UNAVAILABLE'});
  if(req.body.file_hash&&String(req.body.file_hash).toLowerCase()!==String(access.document.content_sha256).toLowerCase())return res.status(409).json({message:'The evidence hash does not match the uploaded document.',code:'DOCUMENT_HASH_MISMATCH'});
  connection=await pool.getConnection();await connection.beginTransaction();
  const currentAccess=await getAuthorisedDocument(req.user,access.document.id,connection);
  if(currentAccess.status!==200){await connection.rollback();return res.status(currentAccess.status).json({message:'The secure document is no longer available.'});}
  const document=currentAccess.document;
  const [[existing]]=await connection.query('SELECT id,evidence_uuid FROM qms_evidence_index WHERE record_type=? AND record_id=? AND secure_document_id=? AND replaced_by IS NULL LIMIT 1',[recordType,recordId,document.id]);
  if(existing){await connection.commit();return res.json({...existing,unchanged:true});}
  const classification=document.classification==='RESTRICTED'?'RESTRICTED_TECHNICAL':document.classification==='CONFIDENTIAL'?'CONFIDENTIAL':'INTERNAL';
  const malwareStatus=['CLEAN','SAFE'].includes(String(document.scan_status).toUpperCase())?'CLEAN':'REVIEW_REQUIRED';
  const uuid=crypto.randomUUID();
  const [result]=await connection.query('INSERT INTO qms_evidence_index(evidence_uuid,record_type,record_id,secure_document_id,file_name,file_hash,classification,revision,malware_status,retention_class,uploaded_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
   [uuid,recordType,recordId,document.id,document.original_name,document.content_sha256,classification,clean(req.body.revision,50)||null,malwareStatus,clean(req.body.retention_class,80)||null,actor(req)]);
  await logAudit(connection,{actorId:actor(req),ipAddress:req.ip,userAgent:req.get('user-agent'),requestId:req.id||req.get('x-request-id')||null,sessionId:req.session?.id||null,action:'QMS_EVIDENCE_REGISTERED',module:'QMS',recordType,recordId,newValue:{evidenceUuid:uuid,secureDocumentId:document.id,fileHash:document.content_sha256,classification,malwareStatus}});
  await connection.commit();return res.status(201).json({id:result.insertId,evidence_uuid:uuid,malware_status:malwareStatus});
 }catch(error){if(connection)await connection.rollback().catch(()=>{});return next(error);}finally{if(connection)connection.release();}
}
module.exports={list,register};
