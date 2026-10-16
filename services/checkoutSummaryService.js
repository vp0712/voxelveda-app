'use strict';
const pool = require('../config/db');
const p = require('./attendanceMobilePolicy');
const {hasAnyPermission,hasPermission} = require('./authorizationService');
const {ensureCheckoutSummarySchema} = require('./checkoutSummarySchema');
const {siteId} = require('./attendanceQrService');
const {logAudit} = require('./auditService');
const {ROLE_TEMPLATES} = require('../config/permissionCatalog');
const canTasks = user => hasAnyPermission(user,['VIEW_OWN_JOBS','MANAGE_JOBS','MANAGE_TEAM_JOBS']);
function site() { return siteId(); }
function categoryScope(user) {
  return {sql:'active=1 AND (site_id IS NULL OR site_id=?) AND (role_scope IS NULL OR role_scope=?)',params:[site(),String(user.role||'').trim().toLowerCase()]};
}
// Current assignment, or a retained status audit proving this employee's assignment
// during this exact UTC shift. An unrelated task never becomes selectable.
function taskScope(user,session) {
  const history = session.timestamp_basis === 'UTC' && session.clock_out;
  return {sql:`IFNULL(t.deleted,0)=0 AND LOWER(COALESCE(t.status,'')) NOT IN('cancelled','canceled')
    AND t.created_at<=? AND (t.assigned_to=?${history ? ` OR EXISTS(SELECT 1 FROM audit_logs h
      WHERE h.record_type='task' AND CAST(h.record_id AS BINARY)=CAST(t.id AS BINARY) AND LOWER(h.module)='tasks'
      AND h.action='TASK_STATUS_CHANGED' AND h.created_at BETWEEN ? AND ?
      AND JSON_VALID(h.new_value) AND JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(h.new_value),h.new_value,'{}'),'$.assigned_to'))=?)` : ''})`,
    params:[session.clock_out_utc_text||session.clock_out||new Date(),Number(user.id),...(history?[session.clock_in_utc_text,session.clock_out_utc_text,String(user.id)]:[])]};
}
function page(query,prefix) {
  const n=Number(query[prefix+'_page']||1),size=50,search=p.text(query[prefix+'_search'],prefix+'_search',120)||'';
  if(!Number.isSafeInteger(n)||n<1||n>200000)throw p.fail('Choose a valid options page.','ATTENDANCE_OPTIONS_PAGE_INVALID');
  return {page:n,page_size:size,search};
}
async function ownSession(db,user,id) {
  const userId=p.actor(user);
  const [[row]]=await db.query(`SELECT ${p.SELECT} FROM staff_attendance a WHERE a.id=? AND a.user_id=? AND IFNULL(a.deleted,0)=0`,[p.positiveId(id),userId]);
  if(!row)throw p.fail('This attendance session is unavailable.','ATTENDANCE_SESSION_NOT_FOUND',404);
  if(!row.clock_out)throw p.fail('Complete this exact session before adding a summary.','ATTENDANCE_SESSION_NOT_COMPLETED',409);
  return row;
}
async function options({user,attendanceId,query={},db=pool}) {
  await ensureCheckoutSummarySchema();
  const session=await ownSession(db,user,attendanceId),taskPage=page(query,'task'),categoryPage=page(query,'category');
  let tasks={...taskPage,state:'RESTRICTED',items:[],total:null,pages:1};
  if(canTasks(user)) {
    const scope=taskScope(user,session),filter=taskPage.search?' AND t.title LIKE ?':'',params=[...scope.params,...(taskPage.search?['%'+taskPage.search+'%']:[])];
    const [[count]]=await db.query(`SELECT COUNT(*) total FROM tasks t WHERE ${scope.sql}${filter}`,params);
    const [rows]=await db.query(`SELECT t.id,t.title,t.status,t.due_date FROM tasks t WHERE ${scope.sql}${filter} ORDER BY t.title,t.id LIMIT ? OFFSET ?`,[...params,taskPage.page_size,(taskPage.page-1)*taskPage.page_size]);
    tasks={...taskPage,state:Number(count.total)?'AVAILABLE':'EMPTY',items:rows,total:Number(count.total),pages:Math.max(1,Math.ceil(Number(count.total)/taskPage.page_size))};
  }
  const scope=categoryScope(user),filter=categoryPage.search?' AND name LIKE ?':'',params=[...scope.params,...(categoryPage.search?['%'+categoryPage.search+'%']:[])];
  const [[count]]=await db.query(`SELECT COUNT(*) total FROM attendance_work_categories WHERE ${scope.sql}${filter}`,params);
  const [rows]=await db.query(`SELECT id,name FROM attendance_work_categories WHERE ${scope.sql}${filter} ORDER BY name,id LIMIT ? OFFSET ?`,[...params,categoryPage.page_size,(categoryPage.page-1)*categoryPage.page_size]);
  return {user_id:Number(user.id),attendance:p.publicAttendance(session),tasks,
    categories:{...categoryPage,state:Number(count.total)?'AVAILABLE':'EMPTY',items:rows,total:Number(count.total),pages:Math.max(1,Math.ceil(Number(count.total)/categoryPage.page_size))},
    can_manage_categories:hasPermission(user,'MANAGE_USERS')};
}
// The same policy is used for dropdowns and writes. Retained selections may be
// kept even after reassignment/deactivation; they are not valid new selections.
async function validateReferences(db,user,session,fields) {
  let title=null,category=null,categoryId=fields.category_id;
  if(fields.task_id!=null) {
    if(Number(session.checkout_task_id)===fields.task_id)title=session.checkout_task_title||null;
    else {
      if(!canTasks(user))throw p.fail('Task access is not enabled for your account.','ATTENDANCE_TASK_ACCESS_DENIED',403);
      const scope=taskScope(user,session);
      const [[row]]=await db.query(`SELECT t.id,t.title FROM tasks t WHERE t.id=? AND ${scope.sql} FOR UPDATE`,[fields.task_id,...scope.params]);
      if(!row)throw p.fail('Choose a task assigned to you for this shift.','ATTENDANCE_TASK_UNAVAILABLE',422,{task_id:'Refresh the tasks available for this shift'});
      title=row.title;
    }
  }
  if(categoryId!=null&&Number(session.checkout_category_id)===categoryId)category=session.checkout_category;
  else if(categoryId==null&&fields.category&&fields.category===session.checkout_category) {
    category=fields.category;categoryId=session.checkout_category_id||null;
  } else if(categoryId!=null||fields.category) {
    const scope=categoryScope(user),byId=categoryId!=null;
    const [[row]]=await db.query(`SELECT id,name FROM attendance_work_categories WHERE ${byId?'id=?':'name=?'} AND ${scope.sql} FOR UPDATE`,[byId?categoryId:fields.category,...scope.params]);
    if(!row)throw p.fail('Choose an active work category available to your account.','ATTENDANCE_CATEGORY_UNAVAILABLE',422,{category_id:'Refresh available company categories'});
    categoryId=Number(row.id);category=row.name;
  }
  return {...fields,category_id:categoryId||null,category,task_title:title};
}
function manager(user) {
  if(!Number.isSafeInteger(Number(user?.id))||!hasPermission(user,'MANAGE_USERS'))throw p.fail('Company settings access is required.','WORK_CATEGORY_ACCESS_DENIED',403);
}
async function listCategories({user,query={},db=pool}) {
  manager(user);await ensureCheckoutSummarySchema();
  const paging=page({category_page:query.page,category_search:query.search},'category');
  const filter=paging.search?' WHERE name LIKE ?':'',params=paging.search?['%'+paging.search+'%']:[];
  const [[count]]=await db.query('SELECT COUNT(*) total FROM attendance_work_categories'+filter,params);
  const [items]=await db.query('SELECT * FROM attendance_work_categories'+filter+' ORDER BY name,id LIMIT ? OFFSET ?',[...params,paging.page_size,(paging.page-1)*paging.page_size]);
  return {...paging,total:Number(count.total),pages:Math.max(1,Math.ceil(Number(count.total)/paging.page_size)),items,site_id:site(),roles:Object.keys(ROLE_TEMPLATES).filter(role=>hasPermission({role},'VIEW_ATTENDANCE'))};
}
async function saveCategory({user,id,input,req}) {
  manager(user);await ensureCheckoutSummarySchema();
  const requestId=p.requestId(input.request_id),name=p.text(input.name,'name',120,true),reason=p.text(input.reason,'reason',1000,true);
  const siteId=p.text(input.site_id,'site_id',120),role=p.text(input.role_scope,'role_scope',80),active=input.active===undefined?true:input.active;
  if(siteId&&siteId!==site()||role&&!Object.hasOwn(ROLE_TEMPLATES,role)||typeof active!=='boolean')throw p.fail('Choose valid workplace, role and active settings.','WORK_CATEGORY_SCOPE_INVALID');
  const categoryId=id?p.positiveId(id,'category_id'):null,expected=input.expected_revision;
  const payload={id:categoryId,name,site_id:siteId,role_scope:role,active,expected_revision:expected??null,reason},hash=p.hash(payload),db=await pool.getConnection();
  try {
    await db.beginTransaction();await db.query('SELECT id FROM users WHERE id=? FOR UPDATE',[user.id]);
    const [[prior]]=await db.query('SELECT * FROM attendance_category_requests WHERE user_id=? AND request_id=?',[user.id,requestId]);
    if(prior){if(prior.payload_sha256!==hash)throw p.fail('This request was already used for different settings.','WORK_CATEGORY_REQUEST_CONFLICT',409);await db.commit();return {...p.parsed(prior.response_json),existing:true};}
    let before=null;
    if(categoryId){[[before]]=await db.query('SELECT * FROM attendance_work_categories WHERE id=? FOR UPDATE',[categoryId]);if(!before)throw p.fail('This category is unavailable.','WORK_CATEGORY_NOT_FOUND',404);p.revision(expected,before.revision);}
    const nameKey=p.hash([name.toLocaleLowerCase('en'),siteId,role]);let savedId=categoryId;
    try {
      if(categoryId)await db.query('UPDATE attendance_work_categories SET name=?,site_id=?,role_scope=?,active=?,name_key=?,revision=revision+1 WHERE id=?',[name,siteId,role,active?1:0,nameKey,categoryId]);
      else {const [insert]=await db.query('INSERT INTO attendance_work_categories(name,site_id,role_scope,active,name_key,created_by) VALUES(?,?,?,?,?,?)',[name,siteId,role,active?1:0,nameKey,user.id]);savedId=insert.insertId;}
    } catch(error){if(error.code==='ER_DUP_ENTRY')throw p.fail('A category with this name and scope already exists.','WORK_CATEGORY_DUPLICATE',409,{name:'Use the existing category or a different name'});throw error;}
    const [[item]]=await db.query('SELECT * FROM attendance_work_categories WHERE id=?',[savedId]);
    await logAudit(db,{actorId:Number(user.id),module:'Settings',recordType:'attendance_work_category',recordId:savedId,action:before?'WORK_CATEGORY_UPDATED':'WORK_CATEGORY_CREATED',oldValue:before,newValue:item,metadata:{reason},requestId:req?.requestId,ipAddress:req?.ip,userAgent:req?.get?.('user-agent')});
    const response={item,request_id:requestId,existing:false};
    await db.query('INSERT INTO attendance_category_requests(user_id,request_id,payload_sha256,response_json) VALUES(?,?,?,?)',[user.id,requestId,hash,JSON.stringify(response)]);
    await db.commit();return response;
  } catch(error){await db.rollback();throw error;}finally{db.release();}
}
module.exports={options,validateReferences,canTasks,taskScope,listCategories,saveCategory};
