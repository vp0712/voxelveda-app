'use strict';
const crypto=require('node:crypto');
const pool=require('../config/db');
const {hasPermission,hasAnyPermission}=require('./authorizationService');
const {logAudit}=require('./auditService');
const {ensureProcurementImportSchema}=require('./procurementImportSchema');
const {normalizeImportRow,IMPORT_FIELDS}=require('./procurementImportExtractionService');
const {dateOnly}=require('../utils/dateOnly');

const CLASSIFICATIONS=new Set(['PLAN','QUOTATION','PURCHASE_ORDER','SUPPLIER_INVOICE']);
const SORTS={created_desc:'r.created_at DESC,r.id DESC',created_asc:'r.created_at ASC,r.id ASC',date_desc:'r.issue_date DESC,r.id DESC',date_asc:'r.issue_date ASC,r.id ASC',title_asc:'r.title ASC,r.id ASC',total_desc:'r.total_amount DESC,r.id DESC',total_asc:'r.total_amount ASC,r.id ASC',supplier_asc:'r.supplier_name ASC,r.id ASC'};
class ProcurementImportError extends Error{
 constructor(message,statusCode=400,code='PROCUREMENT_IMPORT_INVALID',details=null){super(message);this.statusCode=statusCode;this.code=code;this.details=details;}
}
function parsed(value,fallback={}){if(value==null)return fallback;if(typeof value==='string'){try{return JSON.parse(value);}catch{return fallback;}}return value;}
function id(value){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||'')))throw new ProcurementImportError('Choose a valid saved record.',400,'RECORD_ID_INVALID');return String(value);}
function actor(user){const who=Number(user?.id);if(!Number.isSafeInteger(who)||who<1)throw new ProcurementImportError('Authentication is required.',401,'AUTHENTICATION_REQUIRED');return who;}
function text(value,field,max=255,{required=false}={}){const result=String(value??'').trim();if(result.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(result)||required&&!result)throw new ProcurementImportError(`Check ${field}.`,422,'FIELD_INVALID',{fields:{[field]:`Enter ${required?'a value of ':''}at most ${max} safe characters`}});return result||null;}
function canViewAll(user){return hasPermission(user,'MANAGE_PROCUREMENT_RECORDS');}
function canMutate(user){return hasPermission(user,'VIEW_PROCUREMENT')&&hasAnyPermission(user,['IMPORT_PROCUREMENT','CREATE_PURCHASE_REQUISITION','MANAGE_PROCUREMENT_RECORDS']);}
function assertView(user){actor(user);if(!hasPermission(user,'VIEW_PROCUREMENT'))throw new ProcurementImportError('Procurement access is required.',403,'PROCUREMENT_PERMISSION_REQUIRED');}
function assertWrite(user){assertView(user);if(!canMutate(user))throw new ProcurementImportError('Procurement import or draft-entry authority is required.',403,'PROCUREMENT_WRITE_REQUIRED');}
function assertRecordAccess({user,record,write=false}){if(write)assertWrite(user);else assertView(user);if(!record||!canViewAll(user)&&Number(record.owner_user_id)!==actor(user))throw new ProcurementImportError('This record is unavailable within your access.',404,'PROCUREMENT_RECORD_NOT_FOUND');return record;}
function expectedRevision(value,current){const revision=Number(value);if(!Number.isSafeInteger(revision)||revision<1)throw new ProcurementImportError('Provide the current record revision.',422,'REVISION_REQUIRED',{fields:{expected_revision:'Refresh the record and provide its current revision'}});if(revision!==Number(current))throw new ProcurementImportError('This record has changed. Refresh it before saving.',409,'REVISION_CONFLICT',{current_revision:Number(current)});}
function publicEntry(record){
 const result={...record,tax_rate:record.tax_rate==null?null:String(record.tax_rate).replace(/(\.\d*?[1-9])0+$|\.0+$/,'$1'),date:dateOnly(record.issue_date)||null,due_date:dateOnly(record.due_date)||null,net:record.net_amount??null,tax:record.tax_amount??null,total:record.total_amount??null,status:record.archived_at?'ARCHIVED':'DRAFT',revision:Number(record.revision)};
 delete result.request_key;delete result.request_hash;delete result.fingerprint;
 result.lines=[{item_code:record.item_code,description:record.description,quantity:record.quantity,unit:record.unit,unit_price:record.unit_price,tax_rate:record.tax_rate,subtotal:record.net_amount,tax_amount:record.tax_amount,total_amount:record.total_amount}];
 return result;
}
function validateEntryInput(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new ProcurementImportError('Provide a draft entry.',422,'ENTRY_REQUIRED');
 const classification=String(input.classification||'').toUpperCase();if(!CLASSIFICATIONS.has(classification))throw new ProcurementImportError('Choose a supported draft classification.',422,'CLASSIFICATION_INVALID',{fields:{classification:'Choose plan, quotation, purchase order or supplier invoice'}});
 const fieldNames=IMPORT_FIELDS.map(field=>typeof field==='string'?field:field.key||field.name);
 const mapping=Object.fromEntries(fieldNames.map((field,index)=>[field,index]));
 const normalized=normalizeImportRow({cells:fieldNames.map(field=>input[field]??null)},{mapping,dateOrder:'ISO',classification,sourceFormat:'MANUAL',requiresReview:false});
 if(normalized.status!=='VALIDATED'||normalized.errors?.length)throw new ProcurementImportError('Correct the draft entry fields before saving.',422,'ENTRY_VALIDATION_FAILED',{fields:Object.fromEntries([...(normalized.errors||[]),...(normalized.warnings||[])].map(error=>[error.field||'entry',error.message])),errors:normalized.errors,warnings:normalized.warnings});
 const supplierId=input.supplier_id==null||input.supplier_id===''?null:Number(input.supplier_id);if(supplierId!==null&&(!Number.isSafeInteger(supplierId)||supplierId<1))throw new ProcurementImportError('Choose a valid supplier.',422,'SUPPLIER_INVALID',{fields:{supplier_id:'Choose a saved supplier'}});
 return{classification,title:text(input.title||normalized.values.description,'title',255,{required:true}),supplier_id:supplierId,...normalized.values,fingerprint:supplierId===null?normalized.fingerprint:crypto.createHash('sha256').update(JSON.stringify([normalized.fingerprint,supplierId])).digest('hex')};
}
function auditContext(user,req){return{actorId:actor(user),ipAddress:req?.ip||null,userAgent:req?.get?.('user-agent')||null,requestId:req?.id||req?.get?.('x-request-id')||null,sessionId:req?.session?.id||null};}
async function auditEntry(db,{user,req,record,oldValue,action,reason}){
 const revision=Number(record.revision);
 await db.query('INSERT INTO procurement_record_revisions(record_id,revision,action,old_json,new_json,changed_by,reason) VALUES(?,?,?,?,?,?,?)',[record.id,revision,action,oldValue?JSON.stringify(publicEntry(oldValue)):null,JSON.stringify(publicEntry(record)),actor(user),reason||null]);
 await logAudit(db,{...auditContext(user,req),action:`PROCUREMENT_ENTRY_${action}`,module:'PROCUREMENT',recordType:record.classification,recordId:record.record_no,oldValue:oldValue?publicEntry(oldValue):null,newValue:publicEntry(record)});
}
async function assertSupplier(db,supplierId){if(supplierId===null)return;const [[supplier]]=await db.query('SELECT id FROM suppliers WHERE id=? AND IFNULL(deleted,0)=0 LIMIT 1',[supplierId]);if(!supplier)throw new ProcurementImportError('The chosen supplier is not active.',422,'SUPPLIER_UNAVAILABLE',{fields:{supplier_id:'Choose an active supplier'}});}
function requestIdentity(user,key,input){const raw=text(key,'request key',200);return{key:raw?crypto.createHash('sha256').update(JSON.stringify([actor(user),raw])).digest('hex'):null,hash:crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex')};}
async function nextEntryReference(db){
 const year=new Date().getUTCFullYear();
 await db.query('INSERT INTO procurement_entry_sequences(year_value,next_value) VALUES(?,1) ON DUPLICATE KEY UPDATE year_value=VALUES(year_value)',[year]);
 const [[sequence]]=await db.query('SELECT next_value FROM procurement_entry_sequences WHERE year_value=? FOR UPDATE',[year]);
 const next=BigInt(sequence.next_value);
 await db.query('UPDATE procurement_entry_sequences SET next_value=? WHERE year_value=?',[(next+1n).toString(),year]);
 return`PRC-${year}-${next.toString().padStart(6,'0')}`;
}
async function insertEntry(db,{user,input,ownerUserId,source={},req,requestKey=null,requestHash=null}){
 const clean=validateEntryInput(input);await assertSupplier(db,clean.supplier_id);
 const recordId=crypto.randomUUID(),recordNo=await nextEntryReference(db);
 await db.query(`INSERT INTO procurement_records(id,record_no,owner_user_id,classification,title,category,priority,phase,reference,supplier_id,supplier_name,issue_date,due_date,currency,item_code,description,quantity,unit,unit_price,tax_rate,net_amount,tax_amount,total_amount,notes,import_batch_id,import_file_id,import_row_id,source_document_id,fingerprint,request_key,request_hash,created_by,updated_by)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[recordId,recordNo,ownerUserId||actor(user),clean.classification,clean.title,clean.category,clean.priority,clean.phase,clean.reference,clean.supplier_id,clean.supplier_name,clean.date,clean.due_date,clean.currency,clean.item_code,clean.description,clean.quantity,clean.unit,clean.unit_price,clean.tax_rate,clean.net,clean.tax,clean.total,clean.notes,source.batch_id||null,source.file_id||null,source.row_id||null,source.document_id||null,clean.fingerprint,requestKey,requestHash,actor(user),actor(user)]);
 const [[record]]=await db.query('SELECT * FROM procurement_records WHERE id=?',[recordId]);await auditEntry(db,{user,req,record,action:'CREATED'});return record;
}
async function getEntry({user,id:recordId,db=pool,lock=false}){
 assertView(user);await ensureProcurementImportSchema();const [[record]]=await db.query(`SELECT * FROM procurement_records WHERE id=?${lock?' FOR UPDATE':''}`,[id(recordId)]);assertRecordAccess({user,record});
 const [history]=await db.query('SELECT revision,action,old_json,new_json,changed_by,reason,created_at FROM procurement_record_revisions WHERE record_id=? ORDER BY revision DESC',[record.id]);return{...publicEntry(record),history:history.map(row=>({...row,old_value:parsed(row.old_json,null),new_value:parsed(row.new_json,null),old_json:undefined,new_json:undefined}))};
}
function filtersWhere(user,filters={}){
 assertView(user);const clauses=[],params=[];
 if(!canViewAll(user)){clauses.push('r.owner_user_id=?');params.push(actor(user));}
 const status=String(filters.status||'DRAFT').toUpperCase();if(!['DRAFT','ARCHIVED','ALL'].includes(status))throw new ProcurementImportError('Choose draft, archived or all status.',422,'FILTER_INVALID');if(status!=='ALL')clauses.push(status==='ARCHIVED'?'r.archived_at IS NOT NULL':'r.archived_at IS NULL');
 if(filters.classification){const value=String(filters.classification).toUpperCase();if(!CLASSIFICATIONS.has(value))throw new ProcurementImportError('Choose a supported classification.',422,'FILTER_INVALID');clauses.push('r.classification=?');params.push(value);}
 if(filters.search){const search=text(filters.search,'search',200);clauses.push('(r.record_no LIKE ? OR r.title LIKE ? OR r.reference LIKE ? OR r.description LIKE ? OR r.item_code LIKE ? OR r.supplier_name LIKE ?)');for(let i=0;i<6;i++)params.push(`%${search}%`);}
 for(const field of ['category','priority','phase']){if(filters[field]){clauses.push(`r.${field}=?`);params.push(text(filters[field],field,120));}}
 if(filters.currency){const value=String(filters.currency).toUpperCase();if(!/^[A-Z]{3}$/.test(value))throw new ProcurementImportError('Use a three-letter currency code.',422,'FILTER_INVALID');clauses.push('r.currency=?');params.push(value);}
 if(filters.supplier_id){const supplier=Number(filters.supplier_id);if(!Number.isSafeInteger(supplier)||supplier<1)throw new ProcurementImportError('Choose a valid supplier.',422,'FILTER_INVALID');clauses.push('r.supplier_id=?');params.push(supplier);}
 for(const [keys,op] of [[['from_date','from'],'>='],[['to_date','to'],'<=']]){const value=filters[keys[0]]||filters[keys[1]];if(value){const date=dateOnly(value);if(!date)throw new ProcurementImportError('Use a valid document date filter.',422,'FILTER_INVALID');clauses.push(`r.issue_date${op}?`);params.push(date);}}
 if(filters.ids){const values=Array.isArray(filters.ids)?filters.ids:String(filters.ids).split(',');if(!values.length||values.length>2000)throw new ProcurementImportError('Select at most 2,000 saved entries.',422,'SELECTION_INVALID');clauses.push(`r.id IN (${values.map(()=>'?').join(',')})`);params.push(...values.map(id));}
 const from=filters.from_date||filters.from,to=filters.to_date||filters.to;if(from&&to&&dateOnly(from)>dateOnly(to))throw new ProcurementImportError('The start date must not follow the end date.',422,'FILTER_INVALID');
 const sort=String(filters.sort||'created_desc');if(!SORTS[sort])throw new ProcurementImportError('Choose a supported sort order.',422,'FILTER_INVALID');
 return{where:clauses.length?'WHERE '+clauses.join(' AND '):'',params,order:SORTS[sort]};
}
function pagination(filters){const page=Number(filters.page||1),pageSize=Number(filters.page_size||25);if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100||(page-1)*pageSize>10000000)throw new ProcurementImportError('Choose a valid page and page size up to 100.',422,'PAGINATION_INVALID');return{page,pageSize,offset:(page-1)*pageSize};}
async function listEntries({user,filters={}}){await ensureProcurementImportSchema();const {where,params,order}=filtersWhere(user,filters),{page,pageSize,offset}=pagination(filters);
 const [[counts]]=await pool.query(`SELECT COUNT(*) total FROM procurement_records r ${where}`,params);
 const [rows]=await pool.query(`SELECT r.* FROM procurement_records r ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,[...params,pageSize,offset]);
 const [totals]=await pool.query(`SELECT r.classification,r.currency,COUNT(*) record_count,IF(r.currency IS NULL,NULL,SUM(r.net_amount)) net,IF(r.currency IS NULL,NULL,SUM(r.tax_amount)) tax,IF(r.currency IS NULL,NULL,SUM(r.total_amount)) total,COUNT(r.total_amount) priced_count FROM procurement_records r ${where} GROUP BY r.classification,r.currency`,params);
 const [quantities]=await pool.query(`SELECT r.classification,r.unit,COUNT(*) record_count,IF(r.unit IS NULL,NULL,SUM(r.quantity)) quantity FROM procurement_records r ${where} GROUP BY r.classification,r.unit`,params);
 return{entries:rows.map(publicEntry),summary:{record_count:Number(counts.total),currency_totals:totals,quantity_totals:quantities},page,page_size:pageSize,total:Number(counts.total),pages:Math.max(1,Math.ceil(Number(counts.total)/pageSize))};
}
async function listReportRecords({user,filters={},db=pool,limit=2000}){await ensureProcurementImportSchema();const {where,params,order}=filtersWhere(user,filters);const cap=Math.min(2000,Number(limit)||2000);const [rows]=await db.query(`SELECT r.* FROM procurement_records r ${where} ORDER BY ${order} LIMIT ?`,[...params,cap+1]);if(rows.length>cap)throw new ProcurementImportError('Narrow report filters to at most 2,000 entries.',422,'REPORT_LIMIT_EXCEEDED');return rows.map(publicEntry);}
async function createEntry({user,input,req}){
 assertWrite(user);await ensureProcurementImportSchema();const normalized=validateEntryInput(input);
 let source={},owner=actor(user);
 if(input.source_file_id){
  const [[file]]=await pool.query('SELECT f.id,f.batch_id,f.storage_type,f.scan_status,b.owner_user_id FROM procurement_import_files f JOIN procurement_import_batches b ON b.id=f.batch_id WHERE f.id=?',[id(input.source_file_id)]);
  assertRecordAccess({user,record:file});
  if(!file.storage_type||['PENDING_SCAN','QUARANTINED'].includes(file.scan_status))throw new ProcurementImportError('The selected source is not durably available for this draft.',409,'SOURCE_UNAVAILABLE');
  owner=Number(file.owner_user_id);source={batch_id:file.batch_id,file_id:file.id};
 }
 const identity=requestIdentity(user,req?.get?.('Idempotency-Key')||input.request_key,{...normalized,source_file_id:input.source_file_id||null}),connection=await pool.getConnection();
 try{
  await connection.beginTransaction();await connection.query('SELECT id FROM users WHERE id=? FOR UPDATE',[owner]);
  if(identity.key){const [[existing]]=await connection.query('SELECT * FROM procurement_records WHERE request_key=?',[identity.key]);if(existing){if(existing.request_hash!==identity.hash)throw new ProcurementImportError('This retry key was used for different entry data.',409,'IDEMPOTENCY_CONFLICT');assertRecordAccess({user,record:existing});await connection.commit();return{entry:publicEntry(existing),existing:true};}}
  const [[duplicate]]=await connection.query('SELECT * FROM procurement_records WHERE owner_user_id=? AND fingerprint=? LIMIT 1',[owner,normalized.fingerprint]);
  if(duplicate){await connection.commit();return{entry:publicEntry(duplicate),existing:true,duplicate:true};}
  const record=await insertEntry(connection,{user,input,ownerUserId:owner,source,req,requestKey:identity.key,requestHash:identity.hash});
  await connection.commit();return{entry:publicEntry(record),existing:false};
 }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}

async function editEntry({user,id:recordId,input,req}){
 assertWrite(user);await ensureProcurementImportSchema();const clean=validateEntryInput(input),connection=await pool.getConnection();
 try{await connection.beginTransaction();const [[before]]=await connection.query('SELECT * FROM procurement_records WHERE id=? FOR UPDATE',[id(recordId)]);assertRecordAccess({user,record:before,write:true});expectedRevision(input.expected_revision,before.revision);if(before.archived_at)throw new ProcurementImportError('Restore this archived entry before editing.',409,'ENTRY_ARCHIVED');await assertSupplier(connection,clean.supplier_id);
 await connection.query(`UPDATE procurement_records SET classification=?,title=?,category=?,priority=?,phase=?,reference=?,supplier_id=?,supplier_name=?,issue_date=?,due_date=?,currency=?,item_code=?,description=?,quantity=?,unit=?,unit_price=?,tax_rate=?,net_amount=?,tax_amount=?,total_amount=?,notes=?,fingerprint=?,revision=revision+1,updated_by=? WHERE id=?`,[clean.classification,clean.title,clean.category,clean.priority,clean.phase,clean.reference,clean.supplier_id,clean.supplier_name,clean.date,clean.due_date,clean.currency,clean.item_code,clean.description,clean.quantity,clean.unit,clean.unit_price,clean.tax_rate,clean.net,clean.tax,clean.total,clean.notes,clean.fingerprint,actor(user),before.id]);const [[record]]=await connection.query('SELECT * FROM procurement_records WHERE id=?',[before.id]);await auditEntry(connection,{user,req,record,oldValue:before,action:'EDITED',reason:text(input.reason,'change reason',1000)});await connection.commit();return{entry:publicEntry(record)};}catch(error){await connection.rollback();throw error;}finally{connection.release();}
}
async function archiveEntry({user,id:recordId,input,req,restore=false}){
 assertWrite(user);await ensureProcurementImportSchema();const reason=text(input.reason,'reason',1000,{required:!restore}),connection=await pool.getConnection();
 try{await connection.beginTransaction();const [[before]]=await connection.query('SELECT * FROM procurement_records WHERE id=? FOR UPDATE',[id(recordId)]);assertRecordAccess({user,record:before,write:true});expectedRevision(input.expected_revision,before.revision);if(Boolean(before.archived_at)===!restore){await connection.commit();return{entry:publicEntry(before),existing:true};}
 await connection.query(`UPDATE procurement_records SET archived_at=${restore?'NULL':'NOW()'},archived_by=?,archive_reason=?,revision=revision+1,updated_by=? WHERE id=?`,[restore?null:actor(user),restore?null:reason,actor(user),before.id]);const [[record]]=await connection.query('SELECT * FROM procurement_records WHERE id=?',[before.id]);await auditEntry(connection,{user,req,record,oldValue:before,action:restore?'RESTORED':'ARCHIVED',reason});await connection.commit();return{entry:publicEntry(record),existing:false};}catch(error){await connection.rollback();throw error;}finally{connection.release();}
}
module.exports={ProcurementImportError,CLASSIFICATIONS,canViewAll,canMutate,assertView,assertWrite,assertRecordAccess,expectedRevision,publicEntry,validateEntryInput,auditContext,insertEntry,getEntry,listEntries,listReportRecords,createEntry,editEntry,archiveEntry,parsed,id,actor,text,pagination};
