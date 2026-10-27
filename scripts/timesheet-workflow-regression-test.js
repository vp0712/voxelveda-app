'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {DateTime}=require('luxon');
const auth=require('../services/authorizationService');
const plain=value=>JSON.parse(JSON.stringify(value));
const state={sheet:{id:1,user_id:4,staff_name:'Fixture employee',staff_email:'fixture@example.invalid',week_start:'2026-10-05',week_end:'2026-10-11',total_hours:9.96,status:'DRAFT',version_no:0},versions:[],approvals:[],audits:[],payroll:[],queries:[],failAudit:false};
state.attendance=Array.from({length:12},(_,index)=>{const start=DateTime.fromISO('2026-10-05T22:00:00Z').plus({hours:index}),end=start.plus({minutes:50});return{id:index+1,user_id:4,clock_in:start.toISO(),clock_out:end.toISO(),clock_in_utc_text:start.toUTC().toFormat('yyyy-MM-dd HH:mm:ss'),clock_out_utc_text:end.toUTC().toFormat('yyyy-MM-dd HH:mm:ss'),work_date:start.setZone('Australia/Sydney').toISODate(),total_minutes:50,total_hours:.83,break_minutes:0,entry_source:'CLOCK',timestamp_basis:'UTC',recorded_timezone:'Australia/Sydney',notes:'',deleted:0};});
async function query(sql,params=[]){
 const text=sql.replace(/\s+/g,' ').trim();state.queries.push(text);
 if(/^SELECT id,name,role,active,deleted_at,account_status,employee_number FROM users/.test(text))return[[{id:4,name:'Fixture employee',role:'staff',active:1,deleted_at:null,account_status:'ACTIVE'}]];
 if(/SELECT DATE_FORMAT\(UTC_TIMESTAMP/.test(text))return[[{server_utc:new Date().toISOString().slice(0,19).replace('T',' ')}]];
 if(/^SELECT user_id FROM weekly_timesheets/.test(text))return[[{user_id:4}]];
 if(/^SELECT version_no,status FROM weekly_timesheets/.test(text))return[[{version_no:state.sheet.version_no,status:state.sheet.status}]];
 if(/^SELECT id FROM users WHERE active=1 AND deleted_at IS NULL AND \(LOWER\(role\)/.test(text))return[[{id:99}]];
 if(/^SELECT id FROM users WHERE id=\? FOR UPDATE/.test(text))return[[{id:4}]];
 if(/^SELECT id FROM users WHERE id =/.test(text))return[[...(params[0]===4&&params[1]===10?[{id:4}]:[])]];
 if(/^SELECT wt\.\*/.test(text))return[[plain(state.sheet)]];
 if(/FROM staff_attendance/.test(text))return[[...state.attendance.map(plain)]];
 if(/^INSERT INTO timesheet_versions/.test(text)){state.versions.push({timesheet_id:params[0],version_no:params[1],status:params[2],snapshot_json:params[3],reason:params[4],created_by:params[5]});return[{affectedRows:1}];}
 if(/^INSERT INTO timesheet_approvals/.test(text)){state.approvals.push({action:params[1],from_status:params[2],to_status:params[3],comments:params[4],actor:params[5]});return[{affectedRows:1}];}
 if(/^UPDATE weekly_timesheets SET total_hours/.test(text)){Object.assign(state.sheet,{total_hours:params[0],ordinary_hours:params[1],overtime_hours:params[2],status:params[3],version_no:params[4]});return[{affectedRows:1}];}
 if(/^UPDATE weekly_timesheets SET status = 'APPROVED'/.test(text)||/^UPDATE weekly_timesheets SET approved_hours/.test(text)){Object.assign(state.sheet,{status:'APPROVED',approved_hours:params[0],ordinary_hours:params[1],overtime_hours:params[2],total_hours:params[3],approved_by:params[4],approved_at:'2026-10-12T01:00:00Z',version_no:params[5],manager_comments:params[6]});return[{affectedRows:1}];}
 if(/^UPDATE weekly_timesheets SET status = \?/.test(text)){Object.assign(state.sheet,{status:params[0],manager_comments:params[1],version_no:params[2],payroll_status:'NOT_READY'});return[{affectedRows:1}];}
 if(/^INSERT INTO payroll_ready/.test(text)){state.payroll=[{user_id:params[1],approved_hours:params[6]}];return[{affectedRows:1}];}
 if(/^UPDATE payroll_ready SET status/.test(text)){state.payroll[0].status='NOT_READY';return[{affectedRows:1}];}
 if(/^UPDATE payroll_ready/.test(text)){state.payroll[0].approved_hours=params[0];return[{affectedRows:1}];}
 if(/^INSERT INTO notifications/.test(text))return[{affectedRows:1}];
 throw new Error('Unexpected timesheet fixture query: '+text);
}
let serial=Promise.resolve();
const db={query,async getConnection(){let unlock,snapshot,active=false;return{query,async beginTransaction(){const previous=serial;serial=new Promise(resolve=>{unlock=resolve;});await previous;active=true;snapshot=plain({sheet:state.sheet,versions:state.versions,approvals:state.approvals,audits:state.audits,payroll:state.payroll});},async commit(){active=false;unlock();},async rollback(){if(active){Object.assign(state,snapshot);active=false;unlock();}},release(){assert(!active);}};}};
const dependencies={'../config/db':db,'./workforceSchema':{ensureWorkforceSchema:async()=>{}},'./weeklyTimesheetDeliverySchema':{ensureWeeklyTimesheetDeliverySchema:async()=>{}},'./attendanceRecordedTotals':require('../services/attendanceRecordedTotals'),'./attendanceVerifiedSummaryService':require('../services/attendanceVerifiedSummaryService'),'./authorizationService':auth,'./auditService':{async logAudit(_db,entry){if(state.failAudit)throw new Error('Fixture audit failure');state.audits.push(plain(entry));},logActivity:async()=>{}},'./notificationService':{createNotification:async()=>{}},'./emailTemplates':{renderEmailTemplate:()=>{throw new Error('No document/email rendering expected in fixture approval');}},'./emailQueue':{queueEmail:async()=>{throw new Error('No provider or queue message permitted in fixture');}}};
const fixture={exports:{}},filename=path.join(__dirname,'../services/timesheetWorkflowService.js');
new vm.Script(fs.readFileSync(filename,'utf8'),{filename}).runInNewContext({module:fixture,exports:fixture.exports,process:{env:{}},Date,console:{error(){}},require(name){if(!Object.hasOwn(dependencies,name))throw new Error('Unexpected timesheet dependency '+name);return dependencies[name];}});
async function main(){
 const workflow=fixture.exports,staff={id:4,role:'staff'},admin={id:99,role:'admin'};
 await assert.rejects(()=>workflow.submitTimesheet(1,{id:5,role:'staff'}),error=>error.code==='TIMESHEET_ACCESS_DENIED');assert.equal(state.versions.length,0);
 const submitted=await workflow.submitTimesheet(1,staff);assert.equal(submitted.total_hours,10);assert.equal(state.sheet.total_hours,10);assert.equal(state.versions[0].created_by,4);assert.equal(state.versions[0].status,'PENDING_APPROVAL');assert.equal(JSON.parse(state.versions[0].snapshot_json).attendance.length,12);
 await assert.rejects(()=>workflow.submitTimesheet(1,staff),error=>error.code==='TIMESHEET_ALREADY_SUBMITTED');assert.equal(state.versions.length,1);
 await assert.rejects(()=>workflow.approveTimesheet(1,{id:11,role:'manager'}),error=>error.code==='TIMESHEET_APPROVAL_DENIED');
 await assert.rejects(()=>workflow.approveTimesheet(1,admin,{requireVersion:true}),error=>error.code==='TIMESHEET_VERSION_REQUIRED');
 await assert.rejects(()=>workflow.approveTimesheet(1,admin,{requireVersion:true,expectedVersion:0,expectedSourceMinutes:600}),error=>error.code==='TIMESHEET_VERSION_CONFLICT');
 await assert.rejects(()=>workflow.approveTimesheet(1,admin,{requireVersion:true,expectedVersion:1,expectedSourceMinutes:599}),error=>error.code==='TIMESHEET_SOURCE_CONFLICT');
 await assert.rejects(()=>workflow.approveTimesheet(1,admin,{requireVersion:true,expectedVersion:1,expectedSourceMinutes:600,approvedHours:11}),error=>error.code==='TIMESHEET_ADJUSTMENT_REASON_REQUIRED');
 await assert.rejects(()=>workflow.approveTimesheet(1,admin,{requireVersion:true,expectedVersion:1,expectedSourceMinutes:600,approvedHours:''}),error=>error.code==='APPROVED_HOURS_INVALID');
 await assert.rejects(()=>workflow.approveTimesheet(1,admin,{requireVersion:true,expectedVersion:1,expectedSourceMinutes:''}),error=>error.code==='TIMESHEET_SOURCE_REQUIRED');
 await assert.rejects(()=>workflow.reviewTimesheet(1,admin,'REJECT','   '),error=>error.code==='TIMESHEET_REJECTION_REASON_REQUIRED');
 await assert.rejects(()=>workflow.reviewTimesheet(1,admin,'REQUEST_CORRECTION',null),error=>error.code==='TIMESHEET_CORRECTION_REASON_REQUIRED');
 state.attendance[0].review_required=1;state.attendance[0].review_reason='RECORDED_DURATION_INCONSISTENT';
 await assert.rejects(()=>workflow.approveTimesheet(1,admin,{requireVersion:true,expectedVersion:1,expectedSourceMinutes:600,approvedHours:10,comments:'This comment cannot authorise unresolved attendance.'}),error=>error.code==='TIMESHEET_ATTENDANCE_REVIEW_REQUIRED');
 delete state.attendance[0].review_required;delete state.attendance[0].review_reason;
 assert.equal(state.versions.length,1,'rejected stale decisions do not create versions');
 const before=plain({sheet:state.sheet,versions:state.versions,approvals:state.approvals,payroll:state.payroll});state.failAudit=true;
 await assert.rejects(()=>workflow.approveTimesheet(1,admin),/Fixture audit failure/);assert.deepEqual(plain({sheet:state.sheet,versions:state.versions,approvals:state.approvals,payroll:state.payroll}),before,'approval and version/payroll handoff roll back together on audit failure');state.failAudit=false;
 const results=await Promise.allSettled([workflow.approveTimesheet(1,admin,{requireVersion:true,expectedVersion:1,expectedSourceMinutes:600}),workflow.approveTimesheet(1,admin,{requireVersion:true,expectedVersion:1,expectedSourceMinutes:600})]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.find(result=>result.status==='fulfilled').value.approved_hours,10);assert.equal(state.versions.length,2);assert.equal(state.sheet.version_no,2);assert.equal(state.sheet.total_hours,10);assert.equal(state.payroll.length,1);assert.equal(state.payroll[0].approved_hours,10);
 const approvedVersion=state.versions[1];assert.equal(approvedVersion.created_by,99);const snapshot=JSON.parse(approvedVersion.snapshot_json);assert.equal(snapshot.calculated.actual_hours,10);assert(snapshot.attendance.every(row=>row.timestamp_basis==='UTC'&&row.user_id===4));
 assert.equal(approvedVersion.reason,null,'Routine approval at verified hours has no fabricated comment');assert.equal(state.approvals.at(-1).comments,null);assert.equal(state.sheet.manager_comments,null);assert.equal(state.sheet.approved_by,99);assert(state.sheet.approved_at);
 const locks=state.queries.filter(sql=>/FOR UPDATE/.test(sql));assert(/^SELECT id FROM users/.test(locks[0]));assert(locks.some(sql=>/FROM staff_attendance/.test(sql)),'approval snapshots must lock authoritative worked records');
 await assert.rejects(()=>workflow.amendApprovedTimesheet(1,admin,{approvedHours:10,reason:'  '}),error=>error.code==='TIMESHEET_AMENDMENT_REASON_REQUIRED');
 await assert.rejects(()=>workflow.amendApprovedTimesheet(1,admin,{approvedHours:10,reason:'Valid explanation',requireVersion:true,expectedVersion:2,expectedSourceMinutes:599}),error=>error.code==='TIMESHEET_SOURCE_CONFLICT');
 const amended=await workflow.amendApprovedTimesheet(1,admin,{approvedHours:10,reason:'Confirmed recorded minutes after review',requireVersion:true,expectedVersion:2,expectedSourceMinutes:600});assert.equal(amended.version_no,3);assert.equal(state.versions[1].snapshot_json,approvedVersion.snapshot_json);assert.equal(state.versions.length,3);assert.equal(state.audits.at(-1).actorId,99);
 // A separately submitted fixture decision carries its explicit adjustment reason
 // through every persisted reviewer surface, without replacing source minutes.
 state.sheet.status='PENDING_APPROVAL';
 const adjusted=await workflow.approveTimesheet(1,admin,{approvedHours:9.5,reason:'  Authorised adjustment; recorded work remains ten hours.  ',requireVersion:true,expectedVersion:3,expectedSourceMinutes:600});
 assert.equal(adjusted.approved_hours,9.5);assert.equal(state.sheet.total_hours,10);assert.equal(state.sheet.manager_comments,'Authorised adjustment; recorded work remains ten hours.');assert.equal(state.approvals.at(-1).comments,state.sheet.manager_comments);assert.equal(state.versions.at(-1).reason,state.sheet.manager_comments);assert.equal(state.audits.at(-1).newValue.reason,state.sheet.manager_comments);
 for(const [action,status,reason]of [['REJECT','REJECTED','Correct the missing job reference before resubmitting.'],['REQUEST_CORRECTION','CORRECTION_REQUIRED','Review the start time against the saved source attendance.']]){
  state.sheet.status='PENDING_APPROVAL';const current=state.sheet.version_no;
  await assert.rejects(()=>workflow.reviewTimesheet(1,admin,action,reason,null,{requireVersion:true,expectedVersion:current-1}),error=>error.code==='TIMESHEET_VERSION_CONFLICT');
  const reviewed=await workflow.reviewTimesheet(1,admin,action,'  '+reason+'  ',null,{requireVersion:true,expectedVersion:current});assert.equal(reviewed.status,status);assert.equal(state.sheet.manager_comments,reason);assert.equal(state.approvals.at(-1).comments,reason);assert.equal(state.versions.at(-1).reason,reason);
 }
 // The compatibility HTTP endpoint must apply the same contract. In particular,
 // it cannot manufacture review reasons or bypass optimistic concurrency.
 const calls=[],controllerFixture={exports:{}};
 new vm.Script(fs.readFileSync(path.join(__dirname,'../controllers/timesheetWorkflowController.js'),'utf8')).runInNewContext({module:controllerFixture,exports:controllerFixture.exports,console,require(name){assert.equal(name,'../services/timesheetWorkflowService');return{async reviewTimesheet(...args){calls.push(args);return{id:1};},async approveTimesheet(...args){calls.push(args);return{id:1};}};}});
 const res={json(value){this.body=value;return this;},status(value){this.statusCode=value;return this;}};
 for(const status of ['REJECTED','CORRECTION_REQUIRED']){await controllerFixture.exports.legacyStatus({body:{id:1,status,expected_version:7},user:admin},res);const args=calls.at(-1);assert.equal(args[3],undefined);assert.equal(args[5].requireVersion,true);assert.equal(args[5].expectedVersion,7);}
 await controllerFixture.exports.legacyStatus({body:{id:1,status:'APPROVED',expected_version:7,expected_source_minutes:600,reason:'Actual adjustment reason'},user:admin},res);assert.equal(calls.at(-1)[2].reason,'Actual adjustment reason');
 assert(!state.queries.some(sql=>/^(DELETE|DROP|TRUNCATE)/.test(sql)));
 console.log('Timesheet workflow tests passed: no-comment verified approval; explicit adjustment/rejection/correction/amendment reasons retained; no legacy fabricated reasons or version bypass; source-review and stale-source guards; authorised own/team boundaries; consolidated minutes; audit rollback; one concurrent approval/payroll handoff; immutable prior versions. Fixtures only; no staff email or transport.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
