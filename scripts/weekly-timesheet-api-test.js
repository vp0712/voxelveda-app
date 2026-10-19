'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const express = require('express');
const auth = require('../services/authorizationService');
const policy = require('../services/weeklyTimesheetEligibility');
const queries = [], revisions = [];
const row = { id: 12, user_id: 4, period_start: '2026-10-05', period_end: '2026-10-11', version: 1,
  status: 'SENT', total_minutes: 480, claim_token: 'private-claim', claim_expires_at: '2026-10-12 08:00:00',
  snapshot_json: JSON.stringify({ staff_id: 4, rows: [{ user_id: 4, total_minutes: 480 }] }) };
const db = { async query(sql, params = []) {
  queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
  if (/SELECT COUNT/.test(sql)) return [[{ total: 1 }]];
  if (/SELECT \* FROM weekly_timesheet_deliveries/.test(sql)) return [[row]];
  if (/SELECT id FROM users WHERE id/.test(sql)) return [[...(params[0] === 4 && params[1] === 10 ? [{id:4}] : [])]];
  if (/FROM weekly_timesheet_delivery_versions/.test(sql)) return [[{ version: 1, status: 'SENT' }]];
  return [[{ ...row, staff_name: 'Fixture employee 4' }]];
} };
const dependencies = { '../config/db': db, '../services/authorizationService': auth,
  '../utils/dateOnly': require('../utils/dateOnly'), '../services/weeklyTimesheetScheduler': {
    ensureWeeklyTimesheetDeliverySchema: async () => {}, getWeeklyTimesheetSchedule: () => policy.scheduleDetails(new Date('2026-10-12T02:00:00Z')),
    queueWeeklyTimesheetRevision: async (options) => { revisions.push(options); return { status: 'QUEUED', version: 2, source_sha256: 'fixture' }; }
  } };
const moduleFixture = { exports: {} }, filename = path.join(__dirname, '../controllers/weeklyTimesheetDeliveryController.js');
new vm.Script(fs.readFileSync(filename, 'utf8'), { filename }).runInNewContext({ module: moduleFixture, exports: moduleFixture.exports,
  console: { error() {} }, require(name) { if (!Object.hasOwn(dependencies, name)) throw new Error('Unexpected API dependency '+name); return dependencies[name]; } });
dependencies['../services/weeklyTimesheetReconciliation']={reconcileWeek:async options=>({period:{start:'2026-10-12',end:'2026-10-18',timezone:'Australia/Sydney'},outcomes:[{user_id:options.actor.id,staff_name:'Fixture own staff',status:'REVIEW_REQUIRED',eligibility:'REVIEW_REQUIRED',recipient_configured:false,verified_minutes:120}],counts:{NO_WORK:1}})};
const controller = moduleFixture.exports;
async function call(method, { user, params = {}, query = {}, body = {} } = {}) {
  const result = { statusCode: 200, set(){return this;}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = JSON.parse(JSON.stringify(value)); return this; } };
  await controller[method]({ user, params, query, body }, result); return result;
}
async function mountedAttendanceBoundary(){
  const app=express();app.use(express.json());const invoked=[];
  const own={id:4,role:'staff',permissions:['VIEW_OWN_TIMESHEET'],permission_boundary:['VIEW_OWN_TIMESHEET']};
  const attendanceOnly={id:4,role:'staff',permission_boundary:['VIEW_ATTENDANCE']};
  const authFixture=(req,res,next)=>{req.user=req.get('x-fixture-scope')==='attendance'?attendanceOnly:req.get('x-fixture-scope')==='none'?{id:4,role:'staff',permission_boundary:['VIEW_CUSTOMERS']}:own;next();};
  const handlers=new Proxy({}, {get(_target,name){return(req,res)=>{invoked.push(String(name));return res.json({fixture:true,user_id:req.user.id});};}});
  const routeDependencies={'express':express,'../controllers/attendanceController':handlers,'../controllers/timesheetWorkflowController':handlers,'../controllers/weeklyTimesheetDeliveryController':controller,'../middleware/auth':authFixture,'../middleware/inputPermissionMiddleware':()=>require('../middleware/authorizationMiddleware').requireAnyPermission('EDIT_ATTENDANCE'),'../middleware/authorizationMiddleware':require('../middleware/authorizationMiddleware'),'../middleware/requestContractMiddleware':require('../middleware/requestContractMiddleware')};
  const routeModule={exports:{}},routeFile=path.join(__dirname,'../routes/attendanceRoutes.js');
  new vm.Script(fs.readFileSync(routeFile,'utf8'),{filename:routeFile}).runInNewContext({module:routeModule,exports:routeModule.exports,require(name){if(!Object.hasOwn(routeDependencies,name))throw new Error('Unexpected attendance route fixture dependency '+name);return routeDependencies[name];}});
  const appFile=path.join(__dirname,'../app.js'),appSource=fs.readFileSync(appFile,'utf8');
  const mount=appSource.match(/for\(const \[module,permission\] of originalModules\)app\.use\([^\n]+\);/);
  assert(mount,'The original application must mount attendance through its protected module graph.');
  new vm.Script(mount[0],{filename:appFile}).runInNewContext({app,auth:authFixture,originalModules:[['attendance','VIEW_ATTENDANCE']],routeFiles:{},requirePermission:require('../middleware/permissionMiddleware'),require(name){if(name==='./middleware/attendanceAccessMiddleware')return require('../middleware/attendanceAccessMiddleware');if(name==='./routes/attendanceRoutes')return routeModule.exports;throw new Error('Unexpected attendance mount fixture dependency '+name);}});
  const server=http.createServer(app);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try{
    const base=`http://127.0.0.1:${server.address().port}`;
    const request=async(pathname,method='GET',scope='own')=>{const response=await fetch(base+'/api/attendance'+pathname,{method,headers:{'x-fixture-scope':scope,...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify({request_id:'530a5b9c-1ac9-4637-aa93-5d9d30d6aaf0',action:'CHECK_IN'})}:{})});return{status:response.status,body:await response.json().catch(()=>({}))};};
    const week=await request('/week');assert.equal(week.status,200);assert.equal(week.body.user_id,4);assert.equal((await request('/week/')).status,200);
    const list=await request('/timesheets/weekly-deliveries');assert.equal(list.status,200);assert.equal(list.body.deliveries[0].user_id,4,'The unchanged weekly controller still enforces the current own-staff query.');
    assert.equal((await request('/timesheets/weekly-deliveries/12')).status,200);
    for(const [pathname,method] of [['/today','GET'],['/actions','POST'],['/all','GET'],['/my','GET'],['/sessions?scope=all','GET'],['/admin/save','POST'],['/timesheets-other','GET']])assert.equal((await request(pathname,method)).status,403,`Own-timesheet authority must not reach ${pathname}`);
    assert.deepEqual(invoked,['weekAttendance','weekAttendance'],'Denied attendance paths cannot dispatch a data-read or mutation controller.');
    assert.equal((await request('/today','GET','attendance')).status,200,'Existing VIEW_ATTENDANCE access remains available.');
    assert.equal((await request('/week','GET','none')).status,403);assert.equal((await request('/timesheets/weekly-deliveries','GET','none')).status,403);
  }finally{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
}
async function main() {
  const own = { id: 4, role: 'staff', permissions: ['VIEW_OWN_TIMESHEET'] };
  const ownList = await call('list', { user: own, query: { page: 1, page_size: 10 } });
  assert.equal(ownList.statusCode, 200); assert.equal(ownList.body.total, 1); assert.equal(ownList.body.schedule.timezone, 'Australia/Sydney');
  assert(queries.filter(entry => /FROM weekly_timesheet_deliveries d/.test(entry.sql)).every(entry => /d.user_id=\?/.test(entry.sql) && entry.params[0] === 4), 'own lists must bind the authenticated staff identity in both totals and rows');
  await call('list',{user:{id:10,role:'manager',permission_boundary:['VIEW_TEAM_TIMESHEET']}});assert(queries.at(-1).sql.includes('(u.manager_id=? AND d.user_id<>?)'),'team-only permission boundary cannot silently grant own timesheet access');
  const detail = await call('detail', { user: own, params: { id: 12 } });
  assert.equal(detail.statusCode, 200); assert(!Object.hasOwn(detail.body.delivery, 'claim_token')); assert(!Object.hasOwn(detail.body.delivery, 'claim_expires_at'));
  assert.equal((await call('detail', { user: { id: 5, role: 'staff' }, params: { id: 12 } })).statusCode, 403);
  assert.equal((await call('detail', { user: { id: 10, role: 'manager' }, params: { id: 12 } })).statusCode, 200);
  assert.equal((await call('detail', { user: { id: 11, role: 'manager' }, params: { id: 12 } })).statusCode, 403);
  for (const query of [{page:-1},{page_size:101},{from_date:'2026-02-30'},{status:'SENT;DROP'},{user_id:'Infinity'}]) assert.equal((await call('list', { user: own, query })).statusCode, 422);
  for (const body of [{recipient:'other@example.invalid'},{to:['other@example.invalid']},{cc:[]},{bcc:[]},{include_employee:true}]) {
    assert.equal((await call('revise', { user: {id:99,role:'admin'}, params:{id:12}, body:{expected_version:1,reason:'Correct actual work',...body} })).statusCode,422);
  }
  assert.equal(revisions.length,0,'recipient overrides cannot reach revision generation or queueing');
  const revision=await call('revise',{user:{id:99,role:'admin'},params:{id:12},body:{expected_version:1,reason:'Correct actual work',confirm_possible_previous_delivery:true}});
  assert.equal(revision.statusCode,202);assert.equal(revision.body.email_sent,false);assert.equal(revisions[0].confirmPossiblePreviousDelivery,true);assert.equal(revisions[0].retryGeneration,false);
  const retry=await call('retryGeneration',{user:{id:99,role:'admin'},params:{id:12},body:{expected_version:1,reason:'Retry corrected parser error'}});
  assert.equal(retry.statusCode,202);assert.equal(revisions[1].retryGeneration,true);
  assert.equal((await call('reconciliation',{user:own})).body.outcomes[0].user_id,4);
  assert.equal((await call('reconciliation',{user:own,query:{status:'NO_RECIPIENT'}})).body.total,1,'Missing address remains discoverable while attendance review also blocks delivery');
  for(const query of [{status:'unknown-state'},{sort:'untrusted'},{page:0},{page_size:101},{from_date:'2026-10-12'},{from_date:'invalid',to_date:'2026-10-18'}])assert.equal((await call('reconciliation',{user:own,query})).statusCode,422);
  for(const role of ['viewer','view_only','sales','finance_admin','finance_user','accountant'])assert.equal((await call('reconciliation',{user:{id:99,role}})).statusCode,403,role+' cannot obtain workforce reconciliation');
  for(const role of ['staff','production','manager','supervisor','hr','admin','super_admin'])assert.equal((await call('reconciliation',{user:{id:99,role}})).statusCode,200,role+' retains scoped workforce access');
  await mountedAttendanceBoundary();
  console.log('Weekly timesheet API tests passed: own/team staff isolation; bound search, date/status and pagination validation; hidden claim metadata; controlled revision and generation retry; recipient overrides/copies blocked before generation. Fixtures only, no mail transport.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
