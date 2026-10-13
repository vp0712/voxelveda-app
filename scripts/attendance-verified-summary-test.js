'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {DateTime}=require('luxon');
const policy=require('../services/weeklyTimesheetEligibility');
const summary=require('../services/attendanceVerifiedSummaryService');
const env={TIMESHEET_TIMEZONE:'Australia/Sydney',ATTENDANCE_STORAGE_TIMEZONE:''};
const staff={id:17,name:'Fixture employee',role:'staff',active:1,account_status:'ACTIVE',deleted_at:null};
const now=new Date('2026-10-13T01:00:00Z');
const start='2026-10-05',end='2026-10-11';
const row=(id,extra={})=>({id,user_id:17,work_date:'2026-10-06',clock_in:'2026-10-05T22:00:00Z',clock_out:'2026-10-05T23:00:00Z',total_minutes:60,total_hours:1,break_minutes:0,timestamp_basis:'UTC',recorded_timezone:'Australia/Sydney',entry_source:'CLOCK',notes:'',deleted:0,...extra});
const assess=records=>summary.assessVerifiedAttendance({staff,records,fromDate:start,toDate:end,now,env});
function loadScheduler(){
 const module={exports:{}};
 const deps={'node:crypto':require('node:crypto'),luxon:require('luxon'),'../config/db':{},'./documentDeliveryService':{},'./timesheetDocumentService':{},'./weeklyTimesheetDeliverySchema':{},'./backgroundJobService':{backgroundJobService:{createScheduler:()=>({})}},'./authorizationService':{},'./auditService':{},'./weeklyTimesheetEligibility':policy};
 const filename=path.join(__dirname,'../services/weeklyTimesheetScheduler.js');
 new vm.Script(fs.readFileSync(filename,'utf8'),{filename}).runInNewContext({module,exports:module.exports,process:{env},Date,console,Buffer,require(name){if(!Object.hasOwn(deps,name))throw new Error('Unexpected scheduler fixture dependency '+name);return deps[name];}});
 return module.exports;
}
async function main(){
 const source=[row(1),row(2),row(3,{attendance_status:'REJECTED',total_minutes:120,total_hours:2}),row(4,{attendance_status:'CANCELLED',total_minutes:180,total_hours:3}),row(5,{timestamp_basis:null,clock_in:'2026-10-06 12:00:00',clock_out:'2026-10-06 16:00:00',total_minutes:240,total_hours:4})];
 const original=JSON.stringify(source),mixed=assess(source);
 assert.equal(mixed.totalMinutes,60);assert.equal(mixed.actualHours,1);assert.equal(mixed.historicalSavedHours,11);assert.equal(mixed.duplicates,1);assert.equal(mixed.reviewRequired,true);assert.equal(mixed.eligibleRecords.length,1);assert.equal(mixed.reviewIssues[0].code,'ATTENDANCE_TIMEZONE_UNVERIFIED');
 assert.throws(()=>summary.assertReviewResolved(mixed),{code:'TIMESHEET_ATTENDANCE_REVIEW_REQUIRED'});assert.equal(JSON.stringify(source),original,'assessment preserves every original record and saved value');
 assert.equal(assess([row(1,{total_hours:null})]).historicalSavedHours,null,'an unknown saved total is not displayed as zero');
 assert.equal(assess([row(1,{clock_out:null,total_minutes:0,total_hours:0})]).reviewRequired,true,'an incomplete clock is reviewed rather than filled with hours');
 assert.equal(assess([row(1,{work_date:'2026-10-20'})]).actualHours,1,'verified reporting uses the actual local shift start, never a misdated saved label');
 assert.equal(assess([row(1,{clock_in:'2026-10-11T13:00:00Z',clock_out:'2026-10-11T14:00:00Z'})]).actualHours,0,'a Monday local shift cannot enter the prior week through its Sunday UTC date');
 const manual=row(7,{clock_in:null,clock_out:null,total_minutes:75,total_hours:1.25,break_minutes:null,entry_source:'MANUAL',manual_authorised_by:99,manual_authorised_at:'2026-10-07T01:00:00Z'});
 assert.equal(assess([manual]).actualHours,1.25);assert.equal(assess([{...manual,manual_authorised_by:null}]).reviewRequired,true);
 const scheduler=loadScheduler(),period={start,end,timezone:'Australia/Sydney',startUtc:DateTime.fromISO(start,{zone:'Australia/Sydney'}).startOf('day').toUTC().toISO(),endExclusiveUtc:DateTime.fromISO(end,{zone:'Australia/Sydney'}).plus({days:1}).startOf('day').toUTC().toISO()};
 let selected;
 await scheduler.loadWorkedAttendance({async query(sql,params){selected={sql,params};return [[]];}},17,period,true);
 assert.match(selected.sql,/FOR UPDATE/);assert.match(selected.sql,/OR \(a\.work_date BETWEEN \? AND \?\)/);assert.deepEqual(Array.from(selected.params),[17,'2026-10-03 23:00:00','2026-10-12 03:00:00',start,end],'UI/workflow reuse the PDF candidate query and its UTC ±14-hour legacy-review boundary');
 const clean=assess([row(1),row(2)]),assessment=policy.assessWorkedAttendance(staff,[row(1),row(2)],period,policy.configuration(env),now);
 const approved={id:31,status:'APPROVED',version_no:2,approved_by:99,approved_at:'2026-10-12T01:00:00Z',total_hours:1,approved_hours:1};
 const snapshot={attendance:clean.eligibleRecords,source_attendance:clean.records,verification:summary.diagnostics(clean)};
 const readVersion={async query(){return [[{created_by:99,snapshot_json:JSON.stringify(snapshot)}]];}};
 assert.equal((await scheduler._test.reviewProof(readVersion,approved,assessment,policy.configuration(env))).verified,true,'new canonical approval attendance is valid for the unchanged weekly PDF proof despite a separately retained duplicate source row');
 snapshot.attendance[0].total_minutes=59;
 assert.equal((await scheduler._test.reviewProof(readVersion,approved,assessment,policy.configuration(env))).verified,false,'source identity/duration changes invalidate the approval proof');
 assert.equal(JSON.stringify(source),original);
 console.log('PASS verified attendance summaries: completed minute totals, duplicate/excluded/legacy diagnostics, null/manual/misdated sources, original preservation, shared candidate boundary and exact weekly approval proof. Fixtures only; no transport.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
