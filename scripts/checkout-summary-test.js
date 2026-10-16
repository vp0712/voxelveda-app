'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const auth=require('../services/authorizationService'),p=require('../services/attendanceMobilePolicy');
function service() {
  const mod={exports:{}},deps={'../config/db':{},'./attendanceMobilePolicy':p,'./authorizationService':auth,'./checkoutSummarySchema':{ensureCheckoutSummarySchema:async()=>{}},'./attendanceQrService':{siteId:()=> 'fixture-workplace'},'./auditService':{},'../config/permissionCatalog':require('../config/permissionCatalog')};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../services/checkoutSummaryService.js'),'utf8'),{module:mod,exports:mod.exports,Date,console,require:k=>{if(!(k in deps))throw Error(k);return deps[k];}});return mod.exports;
}
(async()=>{
 const summary=service(),user={id:8101,role:'staff'},session={id:501,user_id:8101,clock_in:'2026-10-10 00:00:00',clock_in_utc_text:'2026-10-10 00:00:00',clock_out:'2026-10-10 08:00:00',clock_out_utc_text:'2026-10-10 08:00:00',timestamp_basis:'UTC',revision:2};
 const queries=[],db={async query(sql,args){queries.push({sql,args});if(sql.includes('FROM staff_attendance'))return [[session]];if(sql.includes('COUNT(*)'))return [[{total:1}]];if(sql.includes('FROM tasks'))return [[{id:61,title:'Synthetic finished assignment',status:'done'}]];if(sql.includes('FROM attendance_work_categories'))return [[{id:21,name:'Synthetic configured category'}]];throw Error(sql);}};
 const result=await summary.options({user,attendanceId:501,db});
 assert.equal(result.categories.items[0].id,21,'First-use employee receives company configuration without attendance history.');assert.equal(result.tasks.items[0].status,'done');assert.equal(result.attendance.id,501);
 assert(!queries.some(q=>q.sql.includes('DISTINCT checkout_category')));assert(queries.some(q=>q.sql.includes('t.assigned_to=?')&&q.args.includes(8101)));
 const fields={task_id:61,category_id:21,category:null,notes:'Synthetic note'};
 const validated=await summary.validateReferences(db,user,session,fields);assert.equal(validated.category,'Synthetic configured category');assert.equal(validated.task_title,'Synthetic finished assignment');
 assert(!auth.hasPermission(user,'MANAGE_JOBS'));assert(auth.hasPermission(user,'VIEW_OWN_JOBS'));
 const restricted={...user,permission_boundary:['VIEW_ATTENDANCE']};
 assert.equal((await summary.options({user:restricted,attendanceId:501,db})).tasks.state,'RESTRICTED');
 await assert.rejects(()=>summary.validateReferences(db,restricted,session,fields),{code:'ATTENDANCE_TASK_ACCESS_DENIED'});
 await assert.rejects(()=>summary.validateReferences({query:async()=>[[]]},user,session,fields),{code:'ATTENDANCE_TASK_UNAVAILABLE'});
 await assert.rejects(()=>summary.validateReferences({query:async()=>[[]]},user,session,{...fields,task_id:null}),{code:'ATTENDANCE_CATEGORY_UNAVAILABLE'});
 const historical={...session,checkout_category_id:21,checkout_category:'Original recorded label',checkout_task_id:61,checkout_task_title:'Original recorded task'};
 const kept=await summary.validateReferences({query:()=>{throw Error('Retained historical selection should not be resolved as a new choice');}},restricted,historical,fields);
 assert.equal(kept.category,'Original recorded label');assert.equal(kept.task_title,'Original recorded task');
 assert.equal((await summary.validateReferences(db,user,{...session,checkout_category:'Legacy saved selection'},{task_id:null,category_id:null,category:'Legacy saved selection'})).category,'Legacy saved selection');
 await assert.rejects(()=>summary.options({user,attendanceId:501,query:{task_page:-1},db}),{code:'ATTENDANCE_OPTIONS_PAGE_INVALID'});
 await assert.rejects(()=>summary.options({user,attendanceId:501,db:{query:async()=>[[]]}}),{code:'ATTENDANCE_SESSION_NOT_FOUND'});
 await assert.rejects(()=>summary.listCategories({user}),{code:'WORK_CATEGORY_ACCESS_DENIED'});
 const empty=await summary.options({user,attendanceId:501,db:{query:async sql=>sql.includes('FROM staff_attendance')?[[session]]:sql.includes('COUNT(*)')?[[{total:0}]]:[[]]}});
 assert.equal(empty.tasks.state,'EMPTY');assert.equal(empty.categories.state,'EMPTY');
 console.log('Checkout summary policy passed: first-use configured categories, completed assigned tasks, scoped permissions, historical snapshots, invalid new references, empty states and paging.');
})().catch(error=>{console.error(error);process.exitCode=1;});
