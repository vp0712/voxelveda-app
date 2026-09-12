const crypto = require('crypto');
const pool = require('../../config/db');
const { ensureQmsSchema } = require('../../services/qmsSchema');
const { ensureQmsAdvancedSchema } = require('../../services/qmsAdvancedSchema');
const { assertTransitionValidation } = require('../../services/qmsValidationService');
const { logAudit } = require('../../services/auditService');
const { loadEffectiveDefinition, respondDefinitionNotEffective } = require('../../services/qmsDefinitionService');

const MUTABLE = new Set(['DRAFT','REJECTED']);
const WORKFLOW = {
  DRAFT: ['SUBMITTED','VOID'],
  REJECTED: ['DRAFT','VOID'],
  SUBMITTED: ['UNDER_REVIEW','REJECTED'],
  UNDER_REVIEW: ['APPROVED','REJECTED'],
  APPROVED: ['CLOSED','SUPERSEDED'],
  CLOSED: ['SUPERSEDED']
};

function actor(req) { return Number(req.user?.id || req.user?.user_id || 0) || null; }
function clean(value,max=1000){return String(value??'').trim().slice(0,max)}
function canonical(value){
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function fingerprint(record){return crypto.createHash('sha256').update(canonical({documentId:record.document_id,sourceRevision:record.source_revision,recordRevision:Number(record.record_revision),status:record.status,values:record.values_json||{}})).digest('hex')}
function auditContext(req){return{actorId:actor(req),ipAddress:req.ip,userAgent:req.get('user-agent'),requestId:req.id||req.get('x-request-id')||null,sessionId:req.session?.id||null}}
async function ready(){await ensureQmsSchema();await ensureQmsAdvancedSchema()}

async function syncValues(connection,recordId,values,definition){
  const fields=new Map((definition?.fields||[]).map(field=>[String(field.key||field.id||field.label||''),field]));
  for(const [key,value] of Object.entries(values||{})){
    const field=fields.get(key)||{};
    await connection.query(`INSERT INTO qms_record_values(qms_record_id,field_key,field_label,value_json,data_type,blocking) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE field_label=VALUES(field_label),value_json=VALUES(value_json),data_type=VALUES(data_type),blocking=VALUES(blocking),updated_at=NOW()`,[recordId,key,clean(field.label||key,255),JSON.stringify(value),clean(field.type||'text',32),field.blocking?1:0]);
  }
}

async function syncLinks(connection,recordId,links,userId){
  if(!Array.isArray(links))return;
  for(const link of links.slice(0,100)){
    const entityType=clean(link.entity_type,50).toUpperCase();const entityId=clean(link.entity_id,100);const relation=clean(link.relation_type||'RELATED_TO',80);
    if(!entityType||!entityId)continue;
    await connection.query('INSERT IGNORE INTO qms_record_links(qms_record_id,entity_type,entity_id,relation_type,created_by) VALUES(?,?,?,?,?)',[recordId,entityType,entityId,relation,userId]);
  }
}

async function listRecords(req,res,next){
  try{await ready();const status=clean(req.query.status,32).toUpperCase();const documentId=clean(req.query.document_id,64);const search=clean(req.query.q,120);const where=[];const params=[];
    if(status){where.push('status=?');params.push(status)}if(documentId){where.push('document_id=?');params.push(documentId)}if(search){where.push('(record_no LIKE ? OR document_id LIKE ? OR document_title LIKE ?)');params.push(`%${search}%`,`%${search}%`,`%${search}%`)}
    const [rows]=await pool.query(`SELECT id,record_uuid,record_no,document_id,document_title,source_revision,record_revision,status,owner_user_id,prepared_by,reviewed_by,approved_by,approved_at,closed_at,effective_at,completed_at,confidentiality_classification,retention_class,related_customer_id,related_supplier_id,related_job_id,related_material_lot_id,related_machine_id,related_build_id,related_inspection_id,integrity_hash,created_at,updated_at FROM qms_records ${where.length?`WHERE ${where.join(' AND ')}`:''} ORDER BY updated_at DESC LIMIT 500`,params);return res.json({records:rows});
  }catch(e){return next(e)}
}

async function getRecord(req,res,next){
  try{await ready();const [[record]]=await pool.query('SELECT * FROM qms_records WHERE id=? OR record_uuid=? OR record_no=? LIMIT 1',[req.params.id,req.params.id,req.params.id]);if(!record)return res.status(404).json({message:'Controlled record not found.'});
    const [revisions]=await pool.query('SELECT record_revision,status,integrity_hash,change_reason,changed_by,created_at FROM qms_record_revisions WHERE qms_record_id=? ORDER BY record_revision DESC',[record.id]);
    const [events]=await pool.query('SELECT from_status,to_status,actor_id,reason,created_at FROM qms_record_workflow_events WHERE qms_record_id=? ORDER BY id ASC',[record.id]);
    const [signatures]=await pool.query('SELECT record_revision,signer_user_id,signature_type,meaning_text,signed_integrity_hash,signed_at FROM qms_record_signatures WHERE qms_record_id=? ORDER BY id ASC',[record.id]);
    const [values]=await pool.query('SELECT field_key,field_label,value_json,data_type,blocking,updated_at FROM qms_record_values WHERE qms_record_id=? ORDER BY id',[record.id]);
    const [links]=await pool.query('SELECT entity_type,entity_id,relation_type,created_by,created_at FROM qms_record_links WHERE qms_record_id=? ORDER BY id',[record.id]);
    const [evidence]=await pool.query('SELECT id,evidence_type,document_security_id,file_name,sha256,classification,malware_status,retention_class,uploaded_by,created_at FROM qms_record_evidence WHERE qms_record_id=? ORDER BY id',[record.id]);
    const [comments]=await pool.query("SELECT id,comment_text,comment_type,created_by,created_at FROM qms_record_comments WHERE qms_record_id=? AND comment_type<>'LEGACY_IMPORT_HASH' ORDER BY id",[record.id]);
    const [holds]=await pool.query('SELECT id,hold_type,reason,active,placed_by,placed_at,released_by,released_at,release_reason FROM qms_record_holds WHERE qms_record_id=? ORDER BY id DESC',[record.id]);
    return res.json({record,revisions,events,signatures,values,links,evidence,comments,holds});
  }catch(e){return next(e)}
}

async function createRecord(req,res,next){
  try{await ready();const documentId=clean(req.body.document_id,64);const title=clean(req.body.document_title,255);const sourceRevision=clean(req.body.source_revision||'1.0',32);const values=req.body.values&&typeof req.body.values==='object'&&!Array.isArray(req.body.values)?req.body.values:{};if(!documentId||!title)return res.status(400).json({message:'document_id and document_title are required.'});
    const connection=await pool.getConnection();try{await connection.beginTransaction();const resolved=await loadEffectiveDefinition(connection,documentId,sourceRevision,{lock:true});if(!resolved){await connection.rollback();return respondDefinitionNotEffective(res,documentId,sourceRevision)}const definition=resolved.definition;const record={document_id:documentId,source_revision:sourceRevision,record_revision:1,status:'DRAFT',values_json:values};const hash=fingerprint(record);const uuid=crypto.randomUUID();const who=actor(req);
      const [r]=await connection.query(`INSERT INTO qms_records(record_uuid,document_id,document_title,source_revision,values_json,owner_user_id,prepared_by,integrity_hash,related_customer_id,related_supplier_id,related_job_id,related_material_lot_id,related_machine_id,related_build_id,related_inspection_id,confidentiality_classification,retention_class) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[uuid,documentId,title,sourceRevision,JSON.stringify(values),req.body.owner_user_id||who,who,hash,req.body.related_customer_id||null,req.body.related_supplier_id||null,req.body.related_job_id||null,req.body.related_material_lot_id||null,req.body.related_machine_id||null,req.body.related_build_id||null,req.body.related_inspection_id||null,clean(req.body.confidentiality_classification||'INTERNAL',50),clean(req.body.retention_class,80)||null]);
      const recordNo=`QMS-${new Date().getUTCFullYear()}-${String(r.insertId).padStart(6,'0')}`;await connection.query('UPDATE qms_records SET record_no=? WHERE id=?',[recordNo,r.insertId]);await connection.query('INSERT INTO qms_record_revisions(qms_record_id,record_revision,status,values_json,integrity_hash,change_reason,changed_by) VALUES(?,1,\'DRAFT\',?,?,?,?)',[r.insertId,JSON.stringify(values),hash,'Initial controlled record',who]);await connection.query('INSERT INTO qms_record_workflow_events(qms_record_id,from_status,to_status,actor_id,reason) VALUES(?,NULL,\'DRAFT\',?,?)',[r.insertId,who,'Record created']);await syncValues(connection,r.insertId,values,definition);await syncLinks(connection,r.insertId,req.body.links,who);await logAudit(connection,{...auditContext(req),action:'QMS_RECORD_CREATED',module:'QMS',recordType:documentId,recordId:recordNo,newValue:{sourceRevision,status:'DRAFT',integrityHash:hash}});await connection.commit();return res.status(201).json({id:r.insertId,record_uuid:uuid,record_no:recordNo,status:'DRAFT',integrity_hash:hash});
    }catch(e){await connection.rollback();throw e}finally{connection.release()}
  }catch(e){return next(e)}
}

async function updateRecord(req,res,next){
  try{await ready();const reason=clean(req.body.revision_reason,1000);const values=req.body.values&&typeof req.body.values==='object'&&!Array.isArray(req.body.values)?req.body.values:null;if(!values)return res.status(400).json({message:'values object is required.'});if(!reason)return res.status(400).json({message:'revision_reason is required.'});const connection=await pool.getConnection();try{await connection.beginTransaction();const [[current]]=await connection.query('SELECT * FROM qms_records WHERE id=? FOR UPDATE',[req.params.id]);if(!current){await connection.rollback();return res.status(404).json({message:'Controlled record not found.'})}if(!MUTABLE.has(current.status)){await connection.rollback();return res.status(409).json({message:`Record is ${current.status} and cannot be edited. Create a controlled revision instead.`})}
      const revision=Number(current.record_revision)+1;const nextRecord={...current,record_revision:revision,status:'DRAFT',values_json:values};const hash=fingerprint(nextRecord);await connection.query(`UPDATE qms_records SET record_revision=?,status='DRAFT',values_json=?,revision_reason=?,reviewed_by=NULL,approved_by=NULL,approved_at=NULL,integrity_hash=?,owner_user_id=COALESCE(?,owner_user_id),confidentiality_classification=COALESCE(NULLIF(?,''),confidentiality_classification),retention_class=COALESCE(NULLIF(?,''),retention_class) WHERE id=?`,[revision,JSON.stringify(values),reason,hash,req.body.owner_user_id||null,clean(req.body.confidentiality_classification,50),clean(req.body.retention_class,80),current.id]);await connection.query('INSERT INTO qms_record_revisions(qms_record_id,record_revision,status,values_json,integrity_hash,change_reason,changed_by) VALUES(?,?,\'DRAFT\',?,?,?,?)',[current.id,revision,JSON.stringify(values),hash,reason,actor(req)]);await connection.query('INSERT INTO qms_record_workflow_events(qms_record_id,from_status,to_status,actor_id,reason) VALUES(?,?,?,?,?)',[current.id,current.status,'DRAFT',actor(req),reason]);const resolved=await loadEffectiveDefinition(connection,current.document_id,current.source_revision);await syncValues(connection,current.id,values,resolved?.definition||null);await syncLinks(connection,current.id,req.body.links,actor(req));await logAudit(connection,{...auditContext(req),action:'QMS_RECORD_REVISED',module:'QMS',recordType:current.document_id,recordId:current.record_no,oldValue:{revision:current.record_revision,hash:current.integrity_hash},newValue:{revision,hash}});await connection.commit();return res.json({id:current.id,record_no:current.record_no,record_revision:revision,status:'DRAFT',integrity_hash:hash});
    }catch(e){await connection.rollback();throw e}finally{connection.release()}
  }catch(e){return next(e)}
}

async function transition(req,res,next){
  try{await ready();const target=clean(req.body.status,32).toUpperCase();const reason=clean(req.body.reason,1000);const connection=await pool.getConnection();try{await connection.beginTransaction();const [[current]]=await connection.query('SELECT * FROM qms_records WHERE id=? FOR UPDATE',[req.params.id]);if(!current){await connection.rollback();return res.status(404).json({message:'Controlled record not found.'})}if(!(WORKFLOW[current.status]||[]).includes(target)){await connection.rollback();return res.status(409).json({message:`Invalid QMS workflow transition ${current.status} → ${target}.`})}if(['REJECTED','VOID','SUPERSEDED'].includes(target)&&!reason){await connection.rollback();return res.status(400).json({message:'A reason is required for this transition.'})}const who=actor(req);if(target==='APPROVED'&&who&&Number(current.prepared_by)===who){await connection.rollback();return res.status(409).json({message:'Separation of duties: the preparer cannot provide final approval.'})}
      if(['SUBMITTED','UNDER_REVIEW','APPROVED','CLOSED'].includes(target)){const resolved=await loadEffectiveDefinition(connection,current.document_id,current.source_revision,{lock:true});if(!resolved){await connection.rollback();return respondDefinitionNotEffective(res,current.document_id,current.source_revision)}const [ev]=await connection.query('SELECT id FROM qms_record_evidence WHERE qms_record_id=?',[current.id]);const validation=assertTransitionValidation({targetStatus:target,definition:resolved.definition,values:typeof current.values_json==='string'?JSON.parse(current.values_json):current.values_json,evidenceByField:ev.length?{'*':ev}:{}});if(!validation.blockingValid){await connection.rollback();return res.status(409).json({code:'QMS_BLOCKING_VALIDATION_FAILED',message:'Mandatory or blocking controlled-form requirements are incomplete.',validation})}}
      const next={...current,status:target};const hash=fingerprint(next);await connection.query(`UPDATE qms_records SET status=?,reviewed_by=IF(?='UNDER_REVIEW',?,reviewed_by),approved_by=IF(?='APPROVED',?,approved_by),approved_at=IF(?='APPROVED',NOW(),approved_at),effective_at=IF(?='APPROVED',COALESCE(effective_at,NOW()),effective_at),closed_at=IF(?='CLOSED',NOW(),closed_at),completed_at=IF(?='CLOSED',NOW(),completed_at),integrity_hash=? WHERE id=?`,[target,target,who,target,who,target,target,target,target,hash,current.id]);await connection.query('INSERT INTO qms_record_workflow_events(qms_record_id,from_status,to_status,actor_id,reason) VALUES(?,?,?,?,?)',[current.id,current.status,target,who,reason||null]);if(target==='APPROVED'){const meaning=clean(req.body.signature_meaning||'I confirm that I reviewed this controlled record and approve it for its stated purpose.',1000);await connection.query('INSERT INTO qms_record_signatures(qms_record_id,record_revision,signer_user_id,signature_type,meaning_text,signed_integrity_hash) VALUES(?,?,?,?,?,?)',[current.id,current.record_revision,who,'APPROVAL',meaning,hash])}await logAudit(connection,{...auditContext(req),action:`QMS_RECORD_${target}`,module:'QMS',recordType:current.document_id,recordId:current.record_no,oldValue:{status:current.status,hash:current.integrity_hash},newValue:{status:target,hash}});await connection.commit();return res.json({id:current.id,record_no:current.record_no,status:target,integrity_hash:hash});
    }catch(e){await connection.rollback();throw e}finally{connection.release()}
  }catch(e){return next(e)}
}

async function addComment(req,res,next){try{await ready();const text=clean(req.body.comment,4000);if(!text)return res.status(400).json({message:'comment is required.'});const [r]=await pool.query('INSERT INTO qms_record_comments(qms_record_id,comment_text,comment_type,created_by) VALUES(?,?,?,?)',[req.params.id,text,clean(req.body.comment_type||'COMMENT',40),actor(req)]);await logAudit(pool,{...auditContext(req),action:'QMS_RECORD_COMMENTED',module:'QMS',recordType:'CONTROLLED_RECORD',recordId:String(req.params.id),newValue:{commentId:r.insertId,commentType:req.body.comment_type||'COMMENT'}});return res.status(201).json({id:r.insertId})}catch(e){return next(e)}}
async function addRecordHold(req,res,next){try{await ready();const reason=clean(req.body.reason,1000);if(!reason)return res.status(400).json({message:'reason is required.'});const [r]=await pool.query('INSERT INTO qms_record_holds(qms_record_id,hold_type,reason,placed_by) VALUES(?,?,?,?)',[req.params.id,clean(req.body.hold_type||'QUALITY_HOLD',50),reason,actor(req)]);await logAudit(pool,{...auditContext(req),action:'QMS_RECORD_HOLD_PLACED',module:'QMS',recordType:'CONTROLLED_RECORD',recordId:String(req.params.id),newValue:{holdId:r.insertId,reason}});return res.status(201).json({id:r.insertId,active:true})}catch(e){return next(e)}}
async function releaseRecordHold(req,res,next){try{await ready();const reason=clean(req.body.reason,1000);if(!reason)return res.status(400).json({message:'release reason is required.'});const [[hold]]=await pool.query('SELECT * FROM qms_record_holds WHERE id=? AND qms_record_id=? AND active=1',[req.params.holdId,req.params.id]);if(!hold)return res.status(404).json({message:'Active record hold not found.'});await pool.query('UPDATE qms_record_holds SET active=0,released_by=?,released_at=NOW(),release_reason=? WHERE id=?',[actor(req),reason,hold.id]);await logAudit(pool,{...auditContext(req),action:'QMS_RECORD_HOLD_RELEASED',module:'QMS',recordType:'CONTROLLED_RECORD',recordId:String(req.params.id),newValue:{holdId:hold.id,reason}});return res.json({id:hold.id,active:false})}catch(e){return next(e)}}

module.exports={listRecords,getRecord,createRecord,updateRecord,transition,addComment,addRecordHold,releaseRecordHold};
