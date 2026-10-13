'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const root=path.join(__dirname,'..');
const auth=require('../services/authorizationService');
const customerScope=require('../services/customerRecordScope');
const retirement=require('../services/applicationRetirement');
const plain=value=>JSON.parse(JSON.stringify(value));
function load(file,deps={},suffix=''){const filename=path.join(root,file),fallback=createRequire(filename),module={exports:{}};vm.runInNewContext(fs.readFileSync(filename,'utf8')+suffix,{module,exports:module.exports,require:key=>Object.hasOwn(deps,key)?deps[key]:fallback(key),console,process,Buffer,URL,setTimeout,clearTimeout},{filename});return module.exports;}
const staff={id:4,role:'staff',permissions:['VIEW_OWN_JOBS','VIEW_ATTENDANCE','VIEW_OWN_TIMESHEET'],permission_boundary:['VIEW_OWN_JOBS','VIEW_ATTENDANCE','VIEW_OWN_TIMESHEET'],email:'staff@example.invalid'};
const other={...staff,id:5,email:'other@example.invalid'};
const customer={id:6,role:'client',email:'client@example.invalid',permissions:['VIEW_FINANCE','VIEW_RFQS'],permission_boundary:['VIEW_FINANCE','VIEW_RFQS']};
const admin={id:9,role:'super_admin',permissions:[]};
let failTarget=false;
const tasks=new Map([[11,{id:11,title:'Actual assigned task',description:'Current scoped task detail',assigned_to:4,status:'pending',priority:'normal',due_date:'2026-10-15',deleted:0}],[12,{id:12,title:'Another staff task',assigned_to:5,status:'pending',deleted:0}],[13,{id:13,title:'Archived assigned task',assigned_to:4,status:'done',deleted:1}]]);
const invoices=new Map([[21,{id:21,customer_email:customer.email,deleted:0}],[22,{id:22,customer_email:'someone-else@example.invalid',deleted:0}]]);
const recordQueries=[];
const recordDb={async query(sql,params){recordQueries.push({sql,params});if(/FROM tasks WHERE/.test(sql)){if(failTarget)throw new Error('Fixture target read failure');return [[tasks.get(Number(params[0]))].filter(Boolean)];}if(/FROM invoices WHERE/.test(sql))return [[invoices.get(Number(params[0]))].filter(Boolean)];if(/FROM weekly_timesheets WHERE/.test(sql))return [[{id:31,user_id:Number(params[0])===32?5:4,week_start:'2026-10-05',week_end:'2026-10-11',status:'APPROVED',total_hours:8}]];if(/FROM workflow_instances WHERE/.test(sql))return [[{id:params[0],module:'PROCUREMENT',title:'Exact approval',summary:'Original workflow detail',status:'PENDING',requester_id:4}]];if(/FROM procurement_records WHERE/.test(sql))return [[{id:params[0],owner_user_id:4,title:'Saved plan',description:'Specific persisted plan',status:'CUSTOM_STORED_STATUS',archived_at:null}]];if(/FROM expenses WHERE/.test(sql))return [[{id:Number(params[0]),description:'Original expense record',invoice_no:'EXP-TEST',status:'unpaid',supplier_name:'Supplier fixture',total_amount:'12.50',deleted:0}]];if(/FROM rfqs WHERE/.test(sql))return [[{id:Number(params[0]),customer_name:'Original RFQ customer',email:customer.email,material:'Polymer',quantity:2,application:'Current RFQ details',status:'pending',archived:0}]];if(/FROM ncrs WHERE/.test(sql))return [[{id:Number(params[0]),ncr_no:'NCR-EXACT-7',description:'Exact current quality record',status:'OPEN',deleted:0}]];if(/FROM users WHERE id/.test(sql))return [[]];throw new Error('Unexpected record query: '+sql);}};
const service=load('services/notificationService.js',{'./notificationSchema':{ensureNotificationSchema:async()=>{}},'./authorizationService':auth,'./customerRecordScope':customerScope,'./applicationRetirement':retirement});
async function serviceBoundaries(){
  for(const url of ['//other.invalid','https://other.invalid','/\\other.invalid','/%5cbanking','/%2562anking','/banking','/api/finance/records','/admin?view=erp','/admin?view=%66inance'])assert.equal(service.normaliseActionUrl(url),null,url);
  assert.equal(service.normaliseActionUrl('/invoice/view?id=21'),'/invoice/view?id=21');
  const events=new Map(),db={async query(sql,params){assert.match(sql,/ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID\(id\)/);assert.match(params.at(-1),/^[a-f0-9]{64}$/);const key=params.at(-1);if(!events.has(key))events.set(key,{id:events.size+1,is_read:0,params});return [{insertId:events.get(key).id}];}};
  const event={userId:4,type:'task_assigned',category:'TASKS',title:'Assignment',linkedModule:'tasks',linkedRecordId:11,actionUrl:'/dashboard?view=tasks',dedupeKey:'assignment:11:v1'};
  const first=await service.createNotification(db,event);events.values().next().value.is_read=1;assert.equal(await service.createNotification(db,{...event,title:'Retry title changed'}),first);assert.equal(events.size,1);assert.equal(events.values().next().value.is_read,1);
  await service.createNotification(db,{...event,userId:5});await service.createNotification(db,{...event,dedupeKey:'assignment:11:v2'});assert.equal(events.size,3,'distinct recipients and later real events are preserved');
  await service.createNotification(db,{...event,linkedModule:'FINANCE',linkedRecordId:21,actionUrl:'/invoice/view?id=21',dedupeKey:'original-invoice:21'});assert.equal(events.size,4,'original finance notifications are retained');
  await assert.rejects(service.createNotification(db,{...event,linkedModule:'BANKING'}),error=>error.code==='MODULE_RETIRED');
  const scope=service.visibleNotificationWhere(staff);assert.match(scope.sql,/notification_preferences/);assert.match(scope.sql,/assigned_to=\?/);assert.match(scope.sql,/deleted_at IS NULL/);assert.match(scope.sql,/dismissed_at IS NULL/);assert.match(scope.sql,/expires_at>NOW/);assert.equal(scope.params[0],4);assert.ok(!/NOT IN \('FINANCE','BANKING'/.test(scope.sql));
  const task=await service.resolveNotificationTarget(recordDb,{id:101,linked_module:'TASKS',linked_record_id:11,action_url:'/dashboard?view=tasks'},staff);assert.equal(task.target_status,'AVAILABLE');assert.equal(task.target.record_id,'11');assert.equal(task.target.record.title,'Actual assigned task');assert.equal(task.target.record.can_manage,false);assert.equal(task.action_url,'/portal/staff?view=tasks&notification_id=101');
  assert.equal((await service.resolveNotificationTarget(recordDb,{linked_module:'TASKS',linked_record_id:12},staff)).target_status,'UNAVAILABLE');assert.equal((await service.resolveNotificationTarget(recordDb,{linked_module:'TASKS',linked_record_id:13},staff)).target_status,'UNAVAILABLE');
  assert.equal((await service.resolveNotificationTarget(recordDb,{linked_module:'INVOICE',linked_record_id:21},customer)).action_url,'/invoice/view?id=21');assert.equal((await service.resolveNotificationTarget(recordDb,{linked_module:'INVOICE',linked_record_id:22},customer)).target_status,'UNAVAILABLE');
  assert.equal((await service.resolveNotificationTarget(recordDb,{linked_module:'TIMESHEETS',linked_record_id:32},staff)).target_status,'UNAVAILABLE');const weekly=await service.resolveNotificationTarget(recordDb,{id:104,linked_module:'TIMESHEETS',linked_record_id:31},staff);assert.equal(weekly.target.detail_url,'/api/attendance/timesheets/31');assert.equal(weekly.target.record.week_start,'2026-10-05');
  const workflow=await service.resolveNotificationTarget(recordDb,{id:105,linked_module:'WORKFLOW',linked_record_id:'b5d44bc3-b1ad-4f15-a18b-d73e543a21a9'},admin);assert.equal(workflow.target.record.title,'Exact approval');assert.match(workflow.target.detail_url,/\/api\/workflows\/instances\//);
  const entry=await service.resolveNotificationTarget(recordDb,{id:106,linked_module:'PROCUREMENT',linked_record_id:'b5d44bc3-b1ad-4f15-a18b-d73e543a21a9'},admin);assert.equal(entry.target.record.status,'CUSTOM_STORED_STATUS');assert.match(entry.action_url,/notification_id=106/);
  const expense=await service.resolveNotificationTarget(recordDb,{id:107,linked_module:'EXPENSES',linked_record_id:41},admin);assert.equal(expense.target.record.description,'Original expense record');assert.equal(expense.target.record.total_amount,'12.50');
  const rfq=await service.resolveNotificationTarget(recordDb,{id:108,linked_module:'RFQ',linked_record_id:51},customer);assert.equal(rfq.target.record.material,'Polymer');
  const qms=await service.resolveNotificationTarget(recordDb,{id:109,linked_module:'QMS',linked_record_id:7,action_url:'/quality?register=ncrs&record_id=7'},admin);assert.equal(qms.target.record.title,'NCR-EXACT-7');assert.match(qms.action_url,/register=ncrs&record_id=7&notification_id=109/);
}
const notifications=[
  {id:101,user_id:4,linked_module:'TASKS',linked_record_id:11,title:'Own assignment',type:'task_assigned',category:'TASKS',priority:'NORMAL',is_read:0,created_at:'2026-10-13T01:00:00Z'},
  {id:102,user_id:5,linked_module:'TASKS',linked_record_id:12,title:'Other recipient',type:'task_assigned',category:'TASKS',is_read:0},
  {id:103,user_id:4,linked_module:'TASKS',linked_record_id:13,title:'Archived source',type:'task_assigned',category:'TASKS',is_read:0},
  {id:104,user_id:4,linked_module:'SYSTEM',title:'Disabled category',type:'system',category:'QUALITY',is_read:0},
  {id:105,user_id:4,linked_module:'BANKING',title:'Retired source',type:'system',category:'FINANCE',is_read:0},
  {id:106,user_id:4,linked_module:'SYSTEM',title:'Expired',type:'system',category:'SYSTEM',is_read:0,expires_at:'2000-01-01'},
  {id:107,user_id:4,linked_module:'SYSTEM',title:'Dismissed',type:'system',category:'SYSTEM',is_read:0,dismissed_at:'2026-10-10'},
  {id:108,user_id:4,linked_module:'SYSTEM',title:'Trashed',type:'system',category:'SYSTEM',is_read:0,deleted_at:'2026-10-10'}
];
const disabled=new Set(['4:QUALITY']);let transactionSnapshot=null,rollbacks=0;
function visible(row,actor){return row.user_id===actor && !row.deleted_at && !row.dismissed_at && (!row.expires_at || new Date(row.expires_at)>new Date()) && !['BANKING','ERP'].includes(row.linked_module) && !disabled.has(actor+':'+row.category);}
const pool={...recordDb,async getConnection(){return pool;},async beginTransaction(){transactionSnapshot=plain(notifications);},async commit(){transactionSnapshot=null;},async rollback(){rollbacks++;if(transactionSnapshot){notifications.splice(0,notifications.length,...transactionSnapshot);transactionSnapshot=null;}},release(){},async query(sql,params=[]){
  if(!/\bnotifications\b/.test(sql))return recordDb.query(sql,params);
  assert.ok(!/\b(?:DELETE|TRUNCATE|DROP)\b/.test(sql),'read actions retain event history');assert.match(sql,/notifications\.user_id=\?/);assert.match(sql,/notification_preferences/);
  if(sql.startsWith('SELECT')){const byId=/WHERE id=\?/.test(sql),actor=Number(params[byId?1:0]);let rows=notifications.filter(row=>visible(row,actor));if(byId)rows=rows.filter(row=>row.id===Number(params[0]));if(/AND is_read=0/.test(sql))rows=rows.filter(row=>!row.is_read);if(/COUNT\(\*\) AS unread/.test(sql))return [[{unread:rows.length}]];if(/COUNT\(\*\) AS total/.test(sql))return [[{total:rows.length}]];return [plain(rows)];}
  if(sql.startsWith('UPDATE')){let rows;if(/WHERE id=\?/.test(sql)){const setParameter=/SET is_read=\?/.test(sql),id=Number(params[setParameter?1:0]),actor=Number(params[setParameter?2:1]);rows=notifications.filter(row=>row.id===id && visible(row,actor));for(const row of rows){row.is_read=setParameter?params[0]:1;row.read_at=row.read_at || 'FIRST_READ';}}else{rows=notifications.filter(row=>visible(row,Number(params[0])) && !row.is_read);for(const row of rows){row.is_read=1;row.read_at=row.read_at || 'FIRST_READ';}}return [{affectedRows:rows.length}];}
  throw new Error('Unexpected notification statement');
}};
const controller=load('controllers/notificationController.js',{'../config/db':pool,'../services/notificationSchema':{ensureNotificationSchema:async()=>{}},'../services/notificationService':service,'../services/trashService':{TrashError:class extends Error{}}});
async function call(method,id,user=staff){const response={statusCode:200,status(value){this.statusCode=value;return this;},json(value){this.body=plain(value);return this;}};await controller[method]({user,params:{id},query:{},body:{}},response);return response;}
async function controllerBoundaries(){
  assert.equal((await call('unreadCount')).body.unread,2);const list=await call('list');assert.deepEqual(list.body.notifications.map(row=>row.id),[101,103]);assert.equal(list.body.unread,2);
  const before=plain(notifications);assert.equal((await call('open',102)).statusCode,404);assert.deepEqual(notifications,before,'a guessed other-user notification changes no row');
  failTarget=true;const failed=await call('open',101);assert.equal(failed.statusCode,500);assert.equal(notifications.find(row=>row.id===101).is_read,0);assert.equal(rollbacks,2,'target read failure rolls back rather than marking before validation');failTarget=false;
  const opened=await call('open',101);assert.equal(opened.body.target.record.title,'Actual assigned task');assert.equal(opened.body.unread,1);assert.equal(notifications.find(row=>row.id===101).read_at,'FIRST_READ');await call('open',101);assert.equal(notifications.find(row=>row.id===101).read_at,'FIRST_READ');
  const archived=await call('open',103);assert.equal(archived.body.target_status,'UNAVAILABLE');assert.match(archived.body.target_message,/no longer available/);assert.equal(archived.body.unread,0);
  notifications.find(row=>row.id===101).is_read=0;const all=await call('markAllRead');assert.equal(all.body.updated,1);assert.equal(all.body.unread,0);for(const id of [102,104,105,106,107,108])assert.equal(notifications.find(row=>row.id===id).is_read,0,'hidden/other-user history '+id+' is retained unchanged');
}
async function producerBoundary(){
  const sent=[],queries=[];let version=2;
  const connection={async query(sql,params){queries.push(sql);if(/SELECT version_no,status FROM weekly_timesheets/.test(sql))return [[{version_no:version,status:'CORRECTION_RESUBMITTED'}]];if(/SELECT id FROM users/.test(sql)){assert.match(sql,/active=1 AND deleted_at IS NULL/);return [[{id:9},{id:10}]];}throw new Error('Unexpected producer SQL');}};
  const noops={};for(const name of ['workforceSchema','weeklyTimesheetDeliverySchema','attendanceRecordedTotals','auditService','emailTemplates','emailQueue'])noops['./'+name]={};
  const workflow=load('services/timesheetWorkflowService.js',{'../config/db':connection,...noops,'./authorizationService':auth,'./notificationService':{async createNotification(db,event){assert.equal(db,connection,'notification insert stays on the original transaction connection');sent.push(plain(event));}}},'\nmodule.exports.__notifyAdmins=notifyAdmins;');
  await workflow.__notifyAdmins(connection,{id:31,user_id:4},'Awaiting approval','Submitted week');await workflow.__notifyAdmins(connection,{id:31,user_id:4},'Retry copy changed','Same real submission');assert.equal(sent.length,4);assert.equal(sent[0].dedupeKey,sent[2].dedupeKey);assert.equal(sent[0].userId,9);assert.equal(sent[1].userId,10);version=3;await workflow.__notifyAdmins(connection,{id:31,user_id:4},'Awaiting approval','Resubmitted');assert.notEqual(sent[0].dedupeKey,sent[4].dedupeKey,'a later submission version is a distinct legitimate event');assert.ok(queries.every(sql=>!/^INSERT INTO notifications/.test(sql)),'all recipient inserts use durable dedupe service');
}
(async()=>{await serviceBoundaries();await controllerBoundaries();await producerBoundary();console.log('PASS notification-center service, visibility/read state, specific targets and transaction dedupe');})().catch(error=>{console.error(error.stack);process.exitCode=1;});
