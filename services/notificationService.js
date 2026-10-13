'use strict';
const crypto = require('node:crypto');
const { ensureNotificationSchema } = require('./notificationSchema');
const { retiredRequest, retiredAsset } = require('./applicationRetirement');
const NOTIFICATION_CATEGORIES = new Set(['FINANCE', 'PRODUCTION', 'QUALITY', 'SECURITY', 'HR', 'TASKS', 'SYSTEM']);
const NOTIFICATION_PRIORITIES = new Set(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']);
const RETIRED_MODULES = new Set(['BANKING','ERP','PERSONAL_FINANCE','FINANCE_OS','HIGH_RISK_FINANCE']);
function normaliseCategory(value) {const category=String(value || 'SYSTEM').trim().toUpperCase();return NOTIFICATION_CATEGORIES.has(category)?category:'SYSTEM';}
function normalisePriority(value) {const priority=String(value || 'NORMAL').trim().toUpperCase();return NOTIFICATION_PRIORITIES.has(priority)?priority:'NORMAL';}
function normaliseActionUrl(value) {
  const url=String(value || '').trim();
  if(!url || url.length>500 || !url.startsWith('/') || url.startsWith('//') || /[\\\x00-\x20\x7f]/.test(url))return null;
  try {
    const parsed=new URL(url,'https://app.voxelveda.com');
    if(parsed.origin!=='https://app.voxelveda.com')return null;
    const pathname=decodeURIComponent(parsed.pathname).toLowerCase();
    if(/[\\\x00-\x20\x7f]/.test(pathname) || /%[0-9a-f]{2}/i.test(pathname) || /%2f/i.test(parsed.pathname))return null;
    if(retiredRequest(pathname) || retiredAsset(pathname) || /^\/(?:personal-finance|financial-years)(?:[/.]|$)/.test(pathname))return null;
    const view=String(parsed.searchParams.get('view') || '').toLowerCase();
    if(/^(?:finance|banking|erp|personal-finance|financial-years)(?:[-_]|$)/.test(view))return null;
  }catch{return null;}
  return url;
}
function eventKey(notification,userId) {
  const explicit=notification.dedupeKey ?? notification.eventId;
  const identity=explicit ?? (notification.linkedRecordId==null?null:[String(notification.type || 'system'),String(notification.linkedModule || '').toUpperCase(),String(notification.linkedRecordId),String(notification.title || '').trim(),String(notification.message || '')]);
  return identity===null?null:crypto.createHash('sha256').update(JSON.stringify([userId,identity])).digest('hex');
}
async function createNotification(db,notification) {
  await ensureNotificationSchema();
  const userId=Number(notification.userId),title=String(notification.title || '').trim(),type=String(notification.type || 'system').trim().slice(0,80);
  if(!Number.isSafeInteger(userId) || userId<=0 || !title)throw new Error('Notification user and title are required');
  const linkedModule=String(notification.linkedModule || '').trim().toUpperCase();
  const actionUrl=normaliseActionUrl(notification.actionUrl);
  if(RETIRED_MODULES.has(linkedModule) || notification.actionUrl && !actionUrl && (()=>{try{const url=new URL(notification.actionUrl,'https://app.voxelveda.com');return retiredRequest(decodeURIComponent(url.pathname).toLowerCase()) || retiredAsset(url.pathname);}catch{return false;}})())throw Object.assign(new Error('Retired module notifications are disabled.'),{code:'MODULE_RETIRED',status:410});
  const [result]=await db.query(`INSERT INTO notifications
    (user_id,type,category,title,message,priority,linked_module,linked_record_id,action_url,expires_at,event_key)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,[
    userId,type,normaliseCategory(notification.category),title.slice(0,180),notification.message?String(notification.message).slice(0,5000):null,normalisePriority(notification.priority),linkedModule || null,notification.linkedRecordId==null?null:String(notification.linkedRecordId).slice(0,80),actionUrl,notification.expiresAt || null,eventKey(notification,userId)
  ]);
  return result.insertId;
}
function portalPath(user) {
  const role=String(user?.role || 'staff').toLowerCase();
  if(['client','customer','viewer','view_only'].includes(role))return '/client';
  if(['admin','super_admin','finance_admin','finance_user','accountant'].includes(role))return '/admin';
  return '/portal/'+(['staff','hr','manager','supervisor','sales','production'].includes(role)?role:'staff');
}
function notificationKind(row) {
  const module=String(row.linked_module || '').trim().toUpperCase(),type=String(row.type || '').toLowerCase(),url=normaliseActionUrl(row.action_url);
  if(RETIRED_MODULES.has(module))return 'RETIRED';
  let path='',view='';if(url){const parsed=new URL(url,'https://app.voxelveda.com');path=parsed.pathname.toLowerCase();view=parsed.searchParams.get('view') || '';}
  if(['EXPENSE','EXPENSES'].includes(module) || type.includes('expense') || path==='/expenses' || view==='expenses')return 'EXPENSE';
  if(['INVOICE','INVOICES','FINANCE'].includes(module) || /^\/invoice(?:\/view)?$/.test(path) || path==='/invoices' || view==='invoices')return 'INVOICE';
  if(['TASK','TASKS'].includes(module) || path==='/tasks' || view==='tasks')return 'TASK';
  if(module==='ATTENDANCE_CORRECTIONS')return 'ATTENDANCE_CORRECTION';
  if(['TIMESHEET','TIMESHEETS','ATTENDANCE'].includes(module) || path==='/timesheets' || view==='timesheets' || view==='workforce')return 'TIMESHEET';
  if(['WORKFLOW','APPROVAL','APPROVALS'].includes(module) || path==='/approvals' || view==='approvals')return 'WORKFLOW';
  if(['PROCUREMENT','PURCHASE_ORDER','PURCHASE_ORDERS','PURCHASE_REQUISITION'].includes(module) || path==='/procurement' || view==='procurement')return 'PROCUREMENT';
  if(['STAFF_MESSAGES','STAFF_WORK_REQUESTS'].includes(module))return module;
  if(['ANNOUNCEMENT','ANNOUNCEMENTS'].includes(module))return 'ANNOUNCEMENT';
  if(['QMS','QUALITY'].includes(module) || path==='/quality' || path==='/shop-floor')return 'QUALITY';
  if(['RFQ','RFQS','QUOTATION','QUOTATIONS'].includes(module) || path==='/rfqs' || view==='rfqs')return 'RFQ';
  return 'GENERAL';
}
// The same predicate is used for list, count and read mutations. It never relies
// on a role name or a notification recipient to grant access to another record.
function visibleNotificationWhere(user,{alias='notifications',respectPreferences=true}={}) {
  const {hasPermission,hasAnyPermission}=require('./authorizationService');
  const {customerScoped,customerEmail}=require('./customerRecordScope');
  const actor=Number(user?.id);if(!Number.isSafeInteger(actor) || actor<1)throw Object.assign(new Error('Authentication required'),{status:401});
  if(!/^[a-z_]+$/i.test(alias))throw new Error('Invalid notification query alias');
  const n=alias,rawModule=`UPPER(COALESCE(${n}.linked_module,''))`,rawUrl=`LOWER(COALESCE(${n}.action_url,''))`,params=[actor];
  const module=`(CASE
    WHEN ${rawModule} IN ('BANKING','ERP','PERSONAL_FINANCE','FINANCE_OS','HIGH_RISK_FINANCE') THEN 'RETIRED'
    WHEN ${rawModule} IN ('EXPENSE','EXPENSES') OR LOWER(COALESCE(${n}.type,'')) LIKE '%expense%' OR ${rawUrl} REGEXP '(^/expenses([?]|$)|[?&]view=expenses(&|$))' THEN 'EXPENSE'
    WHEN ${rawModule} IN ('INVOICE','INVOICES','FINANCE') OR ${rawUrl} REGEXP '(^/invoice(/view)?([?]|$)|^/invoices([?]|$)|[?&]view=invoices(&|$))' THEN 'INVOICE'
    WHEN ${rawModule} IN ('TASK','TASKS') OR ${rawUrl} REGEXP '(^/tasks([?]|$)|[?&]view=tasks(&|$))' THEN 'TASK'
    WHEN ${rawModule}='ATTENDANCE_CORRECTIONS' THEN 'ATTENDANCE_CORRECTIONS'
    WHEN ${rawModule} IN ('TIMESHEET','TIMESHEETS','ATTENDANCE') OR ${rawUrl} REGEXP '(^/timesheets([?]|$)|[?&]view=(timesheets|workforce)(&|$))' THEN 'TIMESHEET'
    WHEN ${rawModule} IN ('WORKFLOW','APPROVAL','APPROVALS') OR ${rawUrl} REGEXP '(^/approvals([?]|$)|[?&]view=approvals(&|$))' THEN 'WORKFLOW'
    WHEN ${rawModule} IN ('PROCUREMENT','PURCHASE_ORDER','PURCHASE_ORDERS','PURCHASE_REQUISITION') OR ${rawUrl} REGEXP '(^/procurement([?]|$)|[?&]view=procurement(&|$))' THEN 'PROCUREMENT'
    WHEN ${rawModule} IN ('QMS','QUALITY') OR ${rawUrl} REGEXP '^/(quality|shop-floor)([?]|$)' THEN 'QUALITY'
    WHEN ${rawModule} IN ('RFQ','RFQS','QUOTATION','QUOTATIONS') OR ${rawUrl} REGEXP '(^/rfqs([?]|$)|[?&]view=rfqs(&|$))' THEN 'RFQ'
    ELSE ${rawModule} END)`;
  const linkedId=`COALESCE(NULLIF(${n}.linked_record_id,''),CASE WHEN ${rawUrl} REGEXP '[?&](id|record_id|instance_id|correction_id)=' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(${n}.action_url,'id=',-1),'&',1) END)`;
  const clauses=[`${n}.user_id=?`,`${n}.deleted_at IS NULL`,`${n}.dismissed_at IS NULL`,`(${n}.expires_at IS NULL OR ${n}.expires_at>NOW())`,`${module}<>'RETIRED'`,
    `NOT (LOWER(COALESCE(${n}.action_url,'')) REGEXP '^/(api/(banking|finance|high-risk-finance|erp)|banking([/.]|$)|erp([/.]|$)|finance([-/.]|$)|personal-finance([/.]|$)|financial-years([/.]|$))')`,`NOT (${rawUrl} REGEXP '[?&]view=(finance|banking|erp|personal-finance|financial-years)([-_&]|$)')`];
  if(respectPreferences)clauses.push(`NOT EXISTS (SELECT 1 FROM notification_preferences np WHERE np.user_id=${n}.user_id AND UPPER(np.category)=UPPER(${n}.category) AND np.in_app_enabled=0)`);
  function rule(names,enabled,scope='',scopeParams=[]) {
    const modules=names.map(value=>`'${value}'`).join(',');
    clauses.push(`(${module} NOT IN (${modules})${enabled?` OR (${scope || '1=1'})`:''})`);if(enabled)params.push(...scopeParams);
  }
  const finance=hasPermission(user,'VIEW_FINANCE');
  rule(['INVOICE','INVOICES','FINANCE'],finance,customerScoped(user)?`(${linkedId} IS NULL OR EXISTS (SELECT 1 FROM invoices ni WHERE ni.id=${linkedId} AND LOWER(ni.customer_email)=?))`:'',[customerEmail(user)].filter(()=>customerScoped(user)));
  rule(['EXPENSE','EXPENSES'],finance && !customerScoped(user));
  const jobsAll=hasPermission(user,'MANAGE_JOBS'),jobsTeam=hasPermission(user,'MANAGE_TEAM_JOBS'),jobsOwn=hasPermission(user,'VIEW_OWN_JOBS');
  const taskScope=jobsAll?'':`(${linkedId} IS NULL OR NOT EXISTS (SELECT 1 FROM tasks nt WHERE nt.id=${linkedId}) OR EXISTS (SELECT 1 FROM tasks nt LEFT JOIN users nu ON nu.id=nt.assigned_to WHERE nt.id=${linkedId} AND (nt.assigned_to=?${jobsTeam?' OR nu.manager_id=?':''})))`;
  rule(['TASK','TASKS'],jobsAll || jobsTeam || jobsOwn,taskScope,jobsAll?[]:jobsTeam?[actor,actor]:[actor]);
  const tsAll=hasPermission(user,'VIEW_ALL_TIMESHEETS'),tsTeam=hasPermission(user,'VIEW_TEAM_TIMESHEET'),tsOwn=hasPermission(user,'VIEW_OWN_TIMESHEET');
  const tsScope=tsAll?'':`(${linkedId} IS NULL OR NOT EXISTS (SELECT 1 FROM weekly_timesheets nw WHERE nw.id=${linkedId}) OR EXISTS (SELECT 1 FROM weekly_timesheets nw LEFT JOIN users nu ON nu.id=nw.user_id WHERE nw.id=${linkedId} AND (nw.user_id=?${tsTeam?' OR nu.manager_id=?':''})))`;
  rule(['TIMESHEET','TIMESHEETS','ATTENDANCE'],hasPermission(user,'VIEW_ATTENDANCE') && (tsAll || tsTeam || tsOwn),tsScope,tsAll?[]:tsTeam?[actor,actor]:[actor]);
  const correctionAll=hasAnyPermission(user,['EDIT_ATTENDANCE','APPROVE_ALL_TIMESHEETS']),correctionTeam=hasPermission(user,'APPROVE_TEAM_TIMESHEET');
  rule(['ATTENDANCE_CORRECTIONS'],hasPermission(user,'VIEW_ATTENDANCE'),correctionAll?'':`EXISTS (SELECT 1 FROM attendance_correction_requests nc JOIN users nu ON nu.id=nc.user_id WHERE nc.id=${linkedId} AND (nc.user_id=?${correctionTeam?' OR nu.manager_id=?':''}))`,correctionAll?[]:correctionTeam?[actor,actor]:[actor]);
  const workflowAll=hasPermission(user,'MANAGE_WORKFLOWS');
  const workflowScope=`(${linkedId} IS NULL OR NOT EXISTS (SELECT 1 FROM workflow_instances wi WHERE wi.id=${linkedId}) OR EXISTS (SELECT 1 FROM workflow_instances wi WHERE wi.id=${linkedId} AND UPPER(wi.module) NOT IN ('FINANCE','BANKING','ERP','PERSONAL_FINANCE')${workflowAll?'':' AND (wi.requester_id=? OR EXISTS (SELECT 1 FROM workflow_assignments wa WHERE wa.instance_id=wi.id AND wa.assignee_user_id=?))'}))`;
  rule(['WORKFLOW','APPROVAL','APPROVALS'],hasPermission(user,'VIEW_APPROVALS'),workflowScope,workflowAll?[]:[actor,actor]);
  rule(['PROCUREMENT','PURCHASE_ORDER','PURCHASE_ORDERS','PURCHASE_REQUISITION'],hasPermission(user,'VIEW_PROCUREMENT'),hasPermission(user,'MANAGE_PROCUREMENT_RECORDS')?'':`(${linkedId} IS NULL OR ${linkedId} NOT REGEXP '^[a-fA-F0-9]{8}-' OR EXISTS (SELECT 1 FROM procurement_records pr WHERE pr.id=${linkedId} AND pr.owner_user_id=?))`,hasPermission(user,'MANAGE_PROCUREMENT_RECORDS')?[]:[actor]);
  rule(['STAFF_MESSAGES','STAFF_WORK_REQUESTS'],jobsAll);
  rule(['QMS','QUALITY'],hasAnyPermission(user,['VIEW_QMS','VIEW_COMPLIANCE']));
  rule(['RFQ','RFQS','QUOTATION','QUOTATIONS'],hasPermission(user,'VIEW_RFQS'),customerScoped(user)?`(${linkedId} IS NULL OR EXISTS (SELECT 1 FROM rfqs nr WHERE nr.id=${linkedId} AND LOWER(nr.email)=?))`:'',customerScoped(user)?[customerEmail(user)]:[]);
  return {sql:clauses.join(' AND '),params};
}
function recordId(row) {
  let id=String(row.linked_record_id || '');
  if(!id && row.action_url){try{const query=new URL(row.action_url,'https://app.voxelveda.com').searchParams;id=query.get('id') || query.get('record_id') || query.get('correction_id') || query.get('instance_id') || '';}catch{}}
  return /^(?:[1-9]\d{0,15}|[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.test(id)?id:null;
}
async function resolveNotificationTarget(db,row,user) {
  const {hasPermission,hasAnyPermission,isManagerOf}=require('./authorizationService');
  const {ownsCustomerRecord}=require('./customerRecordScope');
  const kind=notificationKind(row),id=recordId(row),base=portalPath(user);
  const unavailable={action_url:null,target_status:'UNAVAILABLE',target_message:'This item is no longer available.'};
  const allowed=(view,record=null,detailUrl=null)=>({action_url:base+'?view='+view+(record && Number.isSafeInteger(Number(row.id))?'&notification_id='+Number(row.id):''),target_status:'AVAILABLE',target:record?{kind,record_id:String(record.id || id),record,detail_url:detailUrl}:null});
  if(kind==='RETIRED')return unavailable;
  if(row.action_url && !normaliseActionUrl(row.action_url))return unavailable;
  if(row.linked_record_id!=null && String(row.linked_record_id)!=='' && !id)return unavailable;
  if(kind==='INVOICE') {
    if(!hasPermission(user,'VIEW_FINANCE'))return unavailable;
    if(!id)return allowed('invoices');
    const [[record]]=await db.query('SELECT id,customer_email,deleted FROM invoices WHERE id=? LIMIT 1',[id]);
    if(!record || !ownsCustomerRecord(user,record.customer_email))return unavailable;
    if(Number(record.deleted))return {...unavailable,target_message:'This invoice has been archived.'};
    return {action_url:'/invoice/view?id='+encodeURIComponent(id),target_status:'AVAILABLE'};
  }
  if(kind==='TASK') {
    if(!hasAnyPermission(user,['VIEW_OWN_JOBS','MANAGE_JOBS','MANAGE_TEAM_JOBS']))return unavailable;
    if(id){const [[record]]=await db.query('SELECT id,title,description,status,priority,due_date,assigned_to,deleted FROM tasks WHERE id=? LIMIT 1',[id]);if(!record || Number(record.deleted))return unavailable;const permitted=Number(record.assigned_to)===Number(user.id) || hasPermission(user,'MANAGE_JOBS') || hasPermission(user,'MANAGE_TEAM_JOBS') && await isManagerOf(user.id,record.assigned_to,db);if(!permitted)return unavailable;return allowed('tasks',{id:record.id,title:record.title,description:record.description,status:record.status,priority:record.priority,due_date:record.due_date,can_manage:hasAnyPermission(user,['MANAGE_JOBS','MANAGE_TEAM_JOBS'])},'/api/tasks/'+encodeURIComponent(id)+'/history');}
    return allowed('tasks');
  }
  if(kind==='TIMESHEET') {
    if(!hasPermission(user,'VIEW_ATTENDANCE') || !hasAnyPermission(user,['VIEW_OWN_TIMESHEET','VIEW_TEAM_TIMESHEET','VIEW_ALL_TIMESHEETS']))return unavailable;
    if(id){const [[record]]=await db.query('SELECT id,user_id,week_start,week_end,status,total_hours FROM weekly_timesheets WHERE id=? LIMIT 1',[id]);if(!record)return unavailable;const permitted=hasPermission(user,'VIEW_ALL_TIMESHEETS') || Number(record.user_id)===Number(user.id) && hasPermission(user,'VIEW_OWN_TIMESHEET') || hasPermission(user,'VIEW_TEAM_TIMESHEET') && await isManagerOf(user.id,record.user_id,db);if(!permitted)return unavailable;return allowed('timesheets',{id:record.id,week_start:record.week_start,week_end:record.week_end,status:record.status,total_hours:record.total_hours},'/api/attendance/timesheets/'+encodeURIComponent(id));}
    return allowed('timesheets');
  }
  if(kind==='WORKFLOW') {
    if(!hasPermission(user,'VIEW_APPROVALS'))return unavailable;
    if(id){const [[record]]=await db.query('SELECT id,module,title,summary,status,requester_id FROM workflow_instances WHERE id=? LIMIT 1',[id]);if(!record || ['FINANCE','BANKING','ERP','PERSONAL_FINANCE'].includes(String(record.module).toUpperCase()))return unavailable;if(!hasPermission(user,'MANAGE_WORKFLOWS') && Number(record.requester_id)!==Number(user.id)){const [[assignment]]=await db.query('SELECT id FROM workflow_assignments WHERE instance_id=? AND assignee_user_id=? LIMIT 1',[id,Number(user.id)]);if(!assignment)return unavailable;}return allowed('approvals',{id:record.id,title:record.title,summary:record.summary,status:record.status,module:record.module},'/api/workflows/instances/'+encodeURIComponent(id));}
    return allowed('approvals');
  }
  if(kind==='ATTENDANCE_CORRECTION') {
    if(!id || !hasPermission(user,'VIEW_ATTENDANCE'))return unavailable;
    try{const {correction}=await require('./attendanceCorrectionService').getCorrection({user,id,db});if(correction.attendance_deleted)return {...unavailable,target_message:'The original attendance entry has been archived.'};return allowed(base==='/admin'?'workforce':'timesheets',correction,'/api/attendance/corrections/'+encodeURIComponent(id));}catch(error){if([403,404].includes(error.status || error.statusCode))return unavailable;throw error;}
  }
  if(kind==='PROCUREMENT') {
    if(!hasPermission(user,'VIEW_PROCUREMENT'))return unavailable;
    if(id && id.includes('-')){const [[record]]=await db.query('SELECT id,owner_user_id,archived_at,title,description,status FROM procurement_records WHERE id=? LIMIT 1',[id]);if(!record || !hasPermission(user,'MANAGE_PROCUREMENT_RECORDS') && Number(record.owner_user_id)!==Number(user.id))return unavailable;if(record.archived_at)return {...unavailable,target_message:'This procurement entry has been archived.'};return allowed('procurement',{id:record.id,title:record.title,description:record.description,status:record.status},'/api/procurement/entries/'+encodeURIComponent(id));}
    if(id){const type=String(row.type || '').toLowerCase();if(type==='goods_receipt_inspection'){const [[record]]=await db.query('SELECT id,receipt_no,status,received_date FROM goods_receipts WHERE id=? LIMIT 1',[id]);if(!record)return unavailable;return allowed('procurement',record);}if(type==='supplier_credit_pending'){const [[record]]=await db.query('SELECT id,return_no,status,total_amount,reason FROM purchase_returns WHERE id=? LIMIT 1',[id]);if(!record)return unavailable;return allowed('procurement',record);}return unavailable;}
    return allowed('procurement');
  }
  if(kind==='EXPENSE') {
    if(!hasPermission(user,'VIEW_FINANCE') || require('./customerRecordScope').customerScoped(user))return unavailable;
    if(!id)return allowed('expenses');
    const [[record]]=await db.query('SELECT id,expense_date,supplier_name,description,invoice_no,total_amount,status,deleted FROM expenses WHERE id=? LIMIT 1',[id]);if(!record || Number(record.deleted))return unavailable;return allowed('expenses',{id:record.id,title:record.invoice_no || 'Expense '+record.id,description:record.description,status:record.status,supplier_name:record.supplier_name,expense_date:record.expense_date,total_amount:record.total_amount});
  }
  if(kind==='RFQ') {
    if(!hasPermission(user,'VIEW_RFQS'))return unavailable;if(!id)return allowed('rfqs');
    const [[record]]=await db.query('SELECT id,customer_name,email,material,quantity,application,status,archived FROM rfqs WHERE id=? LIMIT 1',[id]);if(!record || !ownsCustomerRecord(user,record.email) || Number(record.archived))return unavailable;return allowed('rfqs',{id:record.id,title:'RFQ '+record.id,customer_name:record.customer_name,description:record.application,material:record.material,quantity:record.quantity,status:record.status},'/api/rfq/'+encodeURIComponent(id));
  }
  if(kind==='QUALITY') {
    if(!hasAnyPermission(user,['VIEW_QMS','VIEW_COMPLIANCE']))return unavailable;if(!id)return {action_url:'/quality',target_status:'AVAILABLE'};
    let register='records';try{register=new URL(row.action_url || '/quality','https://app.voxelveda.com').searchParams.get('register') || 'records';}catch{}
    const tables={records:'qms_records',ncrs:'ncrs',capa:'capas',capas:'capas'};if(!tables[register])return unavailable;
    const [[record]]=await db.query(`SELECT * FROM ${tables[register]} WHERE id=? LIMIT 1`,[id]);if(!record || Number(record.deleted))return unavailable;
    return {...allowed('quality',{id:record.id,title:record.document_title || record.ncr_no || record.capa_no || record.record_no || 'Quality record '+id,description:record.description || record.problem_statement || record.summary || null,status:record.status,register},register==='records'?'/api/qms/records/'+encodeURIComponent(id):null),action_url:'/quality?register='+encodeURIComponent(register)+'&record_id='+encodeURIComponent(id)+'&notification_id='+Number(row.id)};
  }
  if(['STAFF_MESSAGES','STAFF_WORK_REQUESTS'].includes(kind)) {
    if(!hasPermission(user,'MANAGE_JOBS') || !hasPermission(user,'VIEW_STAFF_HR') || base!=='/admin')return {action_url:null,target_status:'NONE'};
    if(!id)return unavailable;const table=kind==='STAFF_MESSAGES'?'staff_messages':'staff_work_requests';
    const [[record]]=await db.query(`SELECT * FROM ${table} WHERE id=? LIMIT 1`,[id]);if(!record || Number(record.deleted))return unavailable;
    return allowed('staff',{id:record.id,title:record.title || 'Staff message',description:record.body,status:record.status,priority:record.priority,created_at:record.created_at});
  }
  if(kind==='ANNOUNCEMENT') {
    if(!id)return {action_url:base,target_status:'AVAILABLE'};const [[record]]=await db.query('SELECT id,title,message,priority,audience_type,target_user_ids,deleted,starts_at,expires_at FROM announcements WHERE id=? LIMIT 1',[id]);if(!record || Number(record.deleted))return unavailable;
    let targets=[];try{targets=JSON.parse(record.target_user_ids || '[]');}catch{}
    if(record.audience_type!=='all' && !hasPermission(user,'MANAGE_JOBS') && (!Array.isArray(targets) || !targets.map(Number).includes(Number(user.id))))return unavailable;
    const day=value=>value instanceof Date?value.toISOString().slice(0,10):String(value || '').slice(0,10),today=new Date().toISOString().slice(0,10);
    if(day(record.starts_at)>today || day(record.expires_at)<today)return unavailable;
    return allowed('dashboard',{id:record.id,title:record.title,description:record.message,priority:record.priority});
  }
  const url=normaliseActionUrl(row.action_url);
  if(url){const parsed=new URL(url,'https://app.voxelveda.com');if(['/profile','/security'].includes(parsed.pathname))return {action_url:parsed.pathname,target_status:'AVAILABLE'};const view=parsed.searchParams.get('view');const views={customers:'VIEW_CUSTOMERS',suppliers:'VIEW_SUPPLIERS',stock:'VIEW_INVENTORY',meetings:'VIEW_MEETINGS',compliance:'VIEW_COMPLIANCE',roster:'VIEW_OWN_ROSTER'};if(view && views[view] && hasPermission(user,views[view]))return allowed(view);if([base,'/dashboard'].includes(parsed.pathname) && !view)return {action_url:base,target_status:'AVAILABLE'};}
  return {action_url:null,target_status:'NONE'};
}
module.exports={NOTIFICATION_CATEGORIES,NOTIFICATION_PRIORITIES,RETIRED_MODULES,createNotification,normaliseActionUrl,normaliseCategory,normalisePriority,eventKey,portalPath,notificationKind,visibleNotificationWhere,resolveNotificationTarget};
