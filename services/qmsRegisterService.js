'use strict';
const crypto = require('node:crypto');
const pool = require('../config/db');
const { hasAnyPermission } = require('./authorizationService');
const { createDocumentPdf } = require('./documentPdfService');
const MAX_REPORT_ROWS = 10000;
function register(table, key, title, reference, columns, options = {}) {
  return { table, key, title, reference, columns, date: 'created_at', sort: 'created_at', direction: 'desc', search: [reference, ...columns.filter(c => c[2] !== 'date').map(c => c[1])], filters: {}, ...options };
}
const REGISTERS = Object.freeze({
  records: register('qms_records','records','Controlled quality records','record_no',[['Reference','record_no'],['Document','document_id'],['Title','document_title'],['Status','status'],['Revision','record_revision'],['Updated','updated_at','date']],{date:'updated_at',sort:'updated_at',filters:{status:['DRAFT','SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','CLOSED','VOID','SUPERSEDED'],document_id:null},select:'r.id,r.record_uuid,r.record_no,r.document_id,r.document_title,r.source_revision,r.record_revision,r.status,r.owner_user_id,r.prepared_by,r.reviewed_by,r.approved_by,r.approved_at,r.closed_at,r.effective_at,r.completed_at,r.confidentiality_classification,r.retention_class,r.related_customer_id,r.related_supplier_id,r.related_job_id,r.related_material_lot_id,r.related_machine_id,r.related_build_id,r.related_inspection_id,r.integrity_hash,r.created_at,r.updated_at'}),
  audits: register('internal_audits','audits','Internal audit register','audit_no',[['Reference','audit_no'],['Title','title'],['Status','status'],['Scheduled','scheduled_at','date'],['Completed','completed_at','date']],{filters:{status:['PLANNED','IN_PROGRESS','FOLLOW_UP','CLOSED','CANCELLED']}}),
  'management-reviews': register('management_reviews','reviews','Management review register','review_no',[['Reference','review_no'],['Title','title'],['Status','status'],['Period from','period_start','date'],['Period to','period_end','date'],['Held','held_at','date']],{filters:{status:['DRAFT','SCHEDULED','HELD','CLOSED']}}),
  'continuity-exercises': register('continuity_exercises','exercises','Business continuity exercises','exercise_no',[['Reference','exercise_no'],['Type','exercise_type'],['Scenario','scenario'],['Result','result'],['Performed','performed_at','date'],['Next due','next_due','date']],{date:'performed_at',sort:'performed_at',filters:{result:['PASSED','PARTIAL','FAILED'],exercise_type:['TABLETOP','RESTORE_TEST','FAILOVER','SUPPLIER','MACHINE']}}),
  'critical-services': register('critical_services','services','Business continuity services','service_code',[['Reference','service_code'],['Service','service_name'],['Criticality','criticality'],['Status','status'],['RTO (minutes)','rto_minutes'],['RPO (minutes)','rpo_minutes']],{sort:'service_name',direction:'asc',filters:{status:['ACTIVE','DEGRADED','UNAVAILABLE','RETIRED'],criticality:['LOW','MEDIUM','HIGH','CRITICAL']}}),
  'regulatory-reviews': register('regulatory_reviews','reviews','Regulatory review register','review_no',[['Reference','review_no'],['Sector','sector'],['Status','status'],['Created','created_at','date'],['Reviewed','reviewed_at','date']],{filters:{status:['PENDING','UNDER_REVIEW','CLEARED','RESTRICTED','ESCALATED'],sector:['GENERAL','AEROSPACE','DEFENCE','MEDICAL','AUTOMOTIVE','OTHER']}}),
  notifications: register('qms_notifications','notifications','Quality alert register','title',[['Title','title'],['Severity','severity'],['Type','notification_type'],['Due','due_at','date'],['Created','created_at','date'],['Acknowledged','acknowledged_at','date']],{filters:{severity:['INFO','WARNING','HIGH','CRITICAL'],record_type:null,acknowledged:['open','read','all']},search:['title','body','notification_type','record_type','record_id'],sort:'severity',direction:'asc',targeted:true}),
  ncrs: register('ncrs','ncrs','Nonconformance register','ncr_no',[['Reference','ncr_no'],['Description','description'],['Severity','severity'],['Status','status'],['Closed','closed_at','date'],['Created','created_at','date']],{filters:{status:['OPEN','CONTAINMENT_REQUIRED','CONTAINED','INVESTIGATION','DISPOSITION_REQUIRED','REWORK','REINSPECTION','APPROVAL','CLOSED'],severity:['MINOR','MAJOR','CRITICAL']}}),
  capas: register('capas','capas','Corrective action register','capa_no',[['Reference','capa_no'],['Problem','problem_statement'],['Status','status'],['Due','due_date','date'],['Created','created_at','date']],{filters:{status:['OPEN','ROOT_CAUSE','ACTION_PLANNED','IMPLEMENTING','EFFECTIVENESS_REVIEW','CLOSED']}}),
  holds: register('quality_holds','holds','Quality hold register','hold_no',[['Reference','hold_no'],['Entity type','entity_type'],['Entity','entity_id'],['Reason','reason'],['Active','active'],['Placed','placed_at','date'],['Released','released_at','date']],{date:'placed_at',sort:'placed_at',filters:{entity_type:['MATERIAL_LOT','JOB','BUILD','SERIAL','SHIPMENT','QMS_RECORD'],entity_id:null,active:['0','1']}}),
  'inspection-plans': register('inspection_plans','plans','Inspection plan register','plan_no',[['Reference','plan_no'],['Name','name'],['Type','inspection_type'],['Part','part_no'],['Revision','drawing_revision'],['Status','status']],{date:null,sort:'id',filters:{status:['DRAFT','APPROVED','SUPERSEDED'],inspection_type:['INCOMING','IN_PROCESS','FINAL','FAI']}}),
  concessions: register('concessions','concessions','Concession register','concession_no',[['Reference','concession_no'],['Requirement','affected_requirement'],['Status','status'],['Valid until','valid_until','date'],['Created','created_at','date']],{filters:{status:['DRAFT','INTERNAL_REVIEW','CUSTOMER_REVIEW','APPROVED','REJECTED','EXPIRED','CLOSED']}}),
  cocs: register('certificates_of_conformance','cocs','Certificates of conformance register','coc_no',[['Reference','coc_no'],['Revision','revision'],['Part','part_no'],['Quantity','quantity'],['Issued','issued_at','date'],['Voided','voided_at','date']],{date:'issued_at',sort:'issued_at',filters:{part_no:null},select:'r.id,r.coc_no,r.revision,r.job_id,r.production_release_id,r.customer_id,r.customer_po,r.part_no,r.drawing_revision,r.quantity,r.integrity_hash,r.issued_by,r.issued_at,r.voided_at'}),
  documents: register('controlled_documents','documents','Controlled document register','document_id',[['Reference','document_id'],['Title','title'],['Revision','current_revision'],['Status','status'],['Effective','effective_date','date'],['Review due','next_review_date','date']],{sort:'document_id',direction:'asc',filters:{status:['DRAFT','REVIEW','APPROVED','EFFECTIVE','SUPERSEDED','OBSOLETE','WITHDRAWN']}}),
  changes: register('configuration_changes','changes','Quality change register','change_no',[['Reference','change_no'],['Type','change_type'],['Description','description'],['Status','status'],['Created','created_at','date']],{filters:{status:['REQUESTED','IMPACT_ASSESSMENT','REVIEW','VALIDATION','APPROVAL','IMPLEMENTED','VERIFIED','EFFECTIVE','REJECTED','CANCELLED']}}),
  chemicals: register('chemical_products','chemicals','Chemical and SDS register','chemical_code',[['Reference','chemical_code'],['Product','product_name'],['Manufacturer','manufacturer'],['Quantity','current_quantity'],['Unit','unit'],['Status','status']],{sort:'product_name',direction:'asc',filters:{status:['ACTIVE','REVIEW','QUARANTINED','DISCONTINUED']},select:'r.*,s.version_label sds_version,s.issue_date sds_issue_date,s.review_due sds_review_due,s.status sds_status',join:' LEFT JOIN sds_versions s ON s.id=(SELECT s2.id FROM sds_versions s2 WHERE s2.chemical_id=r.id ORDER BY s2.id DESC LIMIT 1)'}),
  calibration: register('measurement_equipment','equipment','Calibration register','equipment_code',[['Reference','equipment_code'],['Description','description'],['Serial number','serial_no'],['Status','status'],['Last calibrated','last_calibrated','date'],['Due','due_date','date']],{date:'due_date',sort:'equipment_code',direction:'asc',filters:{status:['VALID','DUE_SOON','EXPIRED','SUSPENDED','OUT_OF_TOLERANCE']}}),
  maintenance: register('maintenance_work_orders','work_orders','Maintenance register','work_order_no',[['Reference','work_order_no'],['Description','description'],['Status','status'],['Due','due_date','date'],['Opened','opened_at','date'],['Completed','completed_at','date']],{date:'opened_at',sort:'opened_at',filters:{status:['OPEN','IN_PROGRESS','COMPLETE','CANCELLED']}}),
  training: register('employee_competencies','competencies','Competency register','staff_name',[['Staff','staff_name'],['Staff reference','staff_reference'],['Competency','competency_name'],['Status','status'],['Issued','issued_at','date'],['Expires','expires_at','date']],{date:'expires_at',sort:'staff_name',direction:'asc',filters:{status:['VALID','EXPIRED','SUSPENDED','PENDING']},select:'r.id,r.user_id,r.competency_id,r.status,r.issued_at,r.expires_at,u.name staff_name,u.employee_number staff_reference,c.name competency_name',join:' LEFT JOIN users u ON u.id=r.user_id LEFT JOIN competencies c ON c.id=r.competency_id',expressions:{staff_name:'u.name',staff_reference:'u.employee_number',competency_name:'c.name'}}),
  'supplier-scars': register('supplier_scars','scars','Supplier corrective action register','scar_no',[['Reference','scar_no'],['Problem','problem_statement'],['Status','status'],['Due','due_date','date'],['Issued','issued_at','date'],['Closed','closed_at','date']],{date:'issued_at',sort:'issued_at',filters:{status:['ISSUED','ACKNOWLEDGED','CONTAINMENT_RECEIVED','ROOT_CAUSE_RECEIVED','CORRECTIVE_ACTION_RECEIVED','EFFECTIVENESS_REVIEW','CLOSED']}}),
  visitors: register('site_visitors','visitors','Active visitor register','visitor_name',[['Name','visitor_name'],['Company','company'],['Host','host_name'],['Purpose','purpose'],['Checked in','checked_in_at','date'],['Checked out','checked_out_at','date']],{date:'checked_in_at',sort:'checked_in_at',base:'r.checked_out_at IS NULL',select:'r.*,u.name host_name',join:' LEFT JOIN users u ON u.id=r.host_user_id',expressions:{host_name:'u.name'}})
});
function error(message, status = 400, code = 'QMS_REGISTER_INVALID', fields) {
  return Object.assign(new Error(message), { status, statusCode: status, code, ...(fields ? { fields } : {}) });
}
function authority(user) {
  if (!user || !Number.isSafeInteger(Number(user.id || user.user_id)) || Number(user.id || user.user_id) < 1) throw error('Sign in to view quality records.',401,'AUTH_REQUIRED');
  if (!hasAnyPermission(user,['VIEW_QMS','VIEW_COMPLIANCE'])) throw error('Quality records are not permitted for this account.',403,'QMS_REGISTER_FORBIDDEN');
}
function definition(name) {
  if (!Object.hasOwn(REGISTERS,name)) throw error('Quality register not found.',404,'QMS_REGISTER_NOT_FOUND');
  return REGISTERS[name];
}
function text(value, field, max = 160) {
  if (value === undefined || value === null || value === '') return '';
  if (!['string','number'].includes(typeof value) || String(value).length > max) throw error('Enter one valid '+field+' value.',400,'QMS_REGISTER_INVALID',{[field]:'Enter one value of up to '+max+' characters'});
  return String(value).trim();
}
function integer(value, field, fallback, maximum) {
  if (value === undefined || value === '') return fallback;
  const raw = text(value,field,12), n = Number(raw);
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(n) || n > maximum) throw error('Choose a valid '+field+'.',400,'QMS_REGISTER_INVALID',{[field]:'Enter a whole number from 1 to '+maximum});
  return n;
}
function calendar(value, field) {
  const v = text(value,field,10);
  if (!v) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v+'T00:00:00Z')) || new Date(v+'T00:00:00Z').toISOString().slice(0,10) !== v) throw error('Choose a valid '+field+' calendar date.',400,'QMS_REGISTER_INVALID',{[field]:'Use YYYY-MM-DD'});
  return v;
}
function buildQuery(name, user, input = {}, report = false) {
  authority(user);
  const d = definition(name);
  const allowed = new Set(['q','search','sort','direction','from_date','to_date','id',...(report ? ['download'] : ['page','limit']),...Object.keys(d.filters)]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw error('The '+key+' filter is not supported for this register.',400,'QMS_REGISTER_INVALID',{[key]:'Remove this unsupported filter'});
  if (input.q && input.search && String(input.q) !== String(input.search)) throw error('Use one consistent search value.');
  const search = text(input.search || input.q,'search');
  const where = [], params = [], filters = {};
  if(input.id!==undefined&&input.id!==''){const id=text(input.id,'id',16);if(!/^[1-9]\d*$/.test(id)||!Number.isSafeInteger(Number(id)))throw error('Choose a valid quality record.');where.push('r.id=?');params.push(id);filters.id=id;}
  const expression=column=>d.expressions?.[column]||'r.'+column;
  if (d.base) where.push(d.base);
  if (d.targeted) { where.push('(r.target_user_id IS NULL OR r.target_user_id=?)'); params.push(Number(user.id || user.user_id)); }
  if (search) {
    const escaped = '%'+search.replace(/[!%_]/g,'!$&')+'%';
    where.push('('+[...new Set(d.search)].map(col => expression(col)+" LIKE ? ESCAPE '!'").join(' OR ')+')');
    for (const _ of [...new Set(d.search)]) params.push(escaped);
    filters.search = search;
  }
  for (const [field, values] of Object.entries(d.filters)) {
    let value = text(input[field],field,120);
    if (field === 'acknowledged') {
      value = value || 'open';
      if (!values.includes(value)) throw error('Choose open, read or all quality alerts.');
      if (value !== 'all') where.push('r.acknowledged_at IS '+(value === 'read' ? 'NOT ' : '')+'NULL');
      filters[field] = value; continue;
    }
    if (!value) continue;
    if(values?.every(allowed=>allowed===allowed.toUpperCase()))value=value.toUpperCase();
    if (values && !values.includes(value)) throw error('Choose a valid '+field+'.',400,'QMS_REGISTER_INVALID',{[field]:'Choose an available value'});
    where.push('r.'+field+'=?'); params.push(value); filters[field] = value;
  }
  const from = calendar(input.from_date,'from_date'), to = calendar(input.to_date,'to_date');
  if((from||to)&&!d.date)throw error('This register has no recorded date field. Use its reference or status filters.');
  if (from && to && from > to) throw error('The start date must not follow the end date.',400,'QMS_REGISTER_INVALID',{to_date:'Choose an end date on or after the start'});
  if (from) { where.push('r.'+d.date+'>=?'); params.push(from); filters.from_date=from; }
  if (to) { where.push('r.'+d.date+'<DATE_ADD(?,INTERVAL 1 DAY)'); params.push(to); filters.to_date=to; }
  const sorts = [...new Set(['id',d.date,d.reference,d.sort,...d.columns.map(c=>c[1])].filter(Boolean))];
  const sort = text(input.sort,'sort',64) || d.sort;
  const direction = text(input.direction,'direction',4) || d.direction;
  if (!sorts.includes(sort) || !['asc','desc'].includes(direction)) throw error('Choose a supported sort field and asc or desc direction.');
  const order = d.targeted && sort === 'severity' ? "FIELD(r.severity,'CRITICAL','HIGH','WARNING','INFO') "+direction+',COALESCE(r.due_at,r.created_at) ASC,r.id ASC' : expression(sort)+' '+direction+',r.id '+direction;
  const limit = report ? MAX_REPORT_ROWS : integer(input.limit,'limit',50,100);
  const page = report ? 1 : integer(input.page,'page',1,1000000);
  filters.sort=sort;filters.direction=direction;
  if (report && input.download !== undefined && !['0','1'].includes(String(input.download))) throw error('Download must be 0 or 1.');
  const clause = where.length ? ' WHERE '+where.join(' AND ') : '';
  return {d,name,filters,page,limit,offset:(page-1)*limit,params,from:' FROM '+d.table+' r'+(d.join || '')+clause,order};
}
function dateTitle(field){return ({created_at:'Created',updated_at:'Updated',performed_at:'Performed',issued_at:'Issued',opened_at:'Opened',due_date:'Due',expires_at:'Expires',checked_in_at:'Checked in',placed_at:'Placed'})[field]||'Recorded';}
function metadata(name) {
  const d=definition(name);
  return { name,title:d.title,key:d.key,columns:d.columns.map(([label,key,type])=>({label,key,type:type||'text'})),filters:d.filters,sorts:[...new Set(['id',d.date,d.reference,d.sort,...d.columns.map(c=>c[1])].filter(Boolean))],default_sort:d.sort,default_direction:d.direction,date_field:d.date,date_label:dateTitle(d.date) };
}
function catalog(user) { authority(user);return Object.keys(REGISTERS).map(metadata); }
async function snapshot(query, report) {
  let connection;
  try {
    connection=await pool.getConnection();
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await connection.beginTransaction();
    const [[count]]=await connection.query('SELECT COUNT(*) total'+query.from,query.params);
    const total=Number(count?.total);
    if (!Number.isSafeInteger(total) || total<0) throw error('The register count could not be verified. Retry.',503,'QMS_REGISTER_SOURCE_INVALID');
    if (report && total>MAX_REPORT_ROWS) throw error('This selection exceeds 10,000 records. Narrow the filters before generating a report.',422,'QMS_REPORT_LIMIT_EXCEEDED');
    const [rows]=await connection.query('SELECT '+(query.d.select || 'r.*')+query.from+' ORDER BY '+query.order+' LIMIT ? OFFSET ?',[...query.params,report ? total || 1 : query.limit,report ? 0 : query.offset]);
    const expected=report ? total : Math.max(0,Math.min(query.limit,total-query.offset));
    if (!Array.isArray(rows) || rows.length !== expected || rows.some(row=>row.id===undefined || row.id===null) || new Set(rows.map(row=>String(row.id))).size !== rows.length) throw error('The selected records could not be loaded completely. No partial report was created. Retry.',503,'QMS_REGISTER_SOURCE_INCOMPLETE');
    await connection.commit();
    return {rows,total};
  } catch (e) {
    if(connection)await connection.rollback().catch(()=>{});
    if (['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(e.code)) throw error('This quality register requires the release schema update. Contact an administrator.',503,'QMS_REGISTER_SCHEMA_UNAVAILABLE');
    throw e;
  } finally { connection?.release(); }
}
function notification(row) {
  const targets={MEASUREMENT_EQUIPMENT:'calibration',MAINTENANCE:'maintenance',CAPA:'capas',EMPLOYEE_COMPETENCY:'training',SCAR:'supplier-quality',CONTROLLED_DOCUMENT:'documents',SDS_VERSION:'chemicals'};
  return {...row,action_url:'/quality?register='+encodeURIComponent(targets[row.record_type] || 'notifications')+'&record_id='+encodeURIComponent(row.record_id || '')};
}
async function listRegister(req,name) {
  const q=buildQuery(name,req.user,req.query || {});
  const result=await snapshot(q,false);
  const rows=name === 'notifications' ? result.rows.map(notification) : result.rows;
  const body={[q.d.key]:rows,pagination:{page:q.page,limit:q.limit,total:result.total,pages:Math.ceil(result.total/q.limit),has_more:q.offset+rows.length<result.total},register:metadata(name),filters:q.filters};
  if(name==='chemicals') {
    body.warnings=rows.filter(row=>row.maximum_quantity!==null&&Number(row.current_quantity)>Number(row.maximum_quantity)).map(row=>({chemical_code:row.chemical_code,message:'Configured internal maximum quantity exceeded; compliance review required.'}));
    body.advisory='Automated quantity warnings are internal review triggers and are not definitive legal or dangerous-goods advice.';
  }
  return body;
}
async function completeRegister(req,name) {
  return snapshot(buildQuery(name,req.user,req.query || {},true),true);
}
function dateCell(value) {
  if(value===null||value===undefined||value==='')return '—';
  const raw=value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(raw)||new Date(raw+'T00:00:00Z').toISOString().slice(0,10)!==raw)throw error('A recorded report date needs correction before this report can be generated.',422,'QMS_REPORT_DATA_INVALID');
  return new Intl.DateTimeFormat('en-AU',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(raw+'T00:00:00Z'));
}
async function reportArtifact(req,name) {
  const q=buildQuery(name,req.user,req.query || {},true);
  const {rows,total}=await snapshot(q,true);
  const sourceHash=crypto.createHash('sha256').update(JSON.stringify({register:name,filters:q.filters,rows})).digest('hex');
  const generatedAt=new Date();
  const day=generatedAt.toISOString().slice(0,10);
  const reference='QMS-'+name.toUpperCase()+'-'+day.replace(/-/g,'');
  const notes=[String(total)+' authorised '+(total===1?'record.':'records.'),'Prepared from saved quality records matching the selected reporting criteria.'];
  if(q.filters.search)notes.push('Search: '+q.filters.search+'.');
  if(q.filters.from_date||q.filters.to_date)notes.push(dateTitle(q.d.date)+' dates: '+(q.filters.from_date?dateCell(q.filters.from_date):'First record')+' to '+(q.filters.to_date?dateCell(q.filters.to_date):'Latest record')+'.');
  for(const [key,value] of Object.entries(q.filters))if(!['search','sort','direction','from_date','to_date','id'].includes(key))notes.push(key.replace(/_/g,' ')+': '+value+'.');
  if(name==='regulatory-reviews')notes.push('Review records do not establish certification or regulatory approval.');
  const artifact=await createDocumentPdf({title:q.d.title,reference,filename:'voxel-veda-'+name+'-'+day,issueDate:generatedAt,columns:q.d.columns.map(([label,,type])=>({label,width:type==='date'?1.2:1.6})),rows:rows.map(row=>q.d.columns.map(([,key,type])=>type==='date'?dateCell(row[key]):String(row[key]??'—'))),notes});
  return {...artifact,sourceHash,sourceCount:total,generatedAt:generatedAt.toISOString()};
}
module.exports={catalog,listRegister,completeRegister,reportArtifact,buildQuery,metadata,MAX_REPORT_ROWS,_test:{snapshot,dateCell,notification,REGISTERS}};

