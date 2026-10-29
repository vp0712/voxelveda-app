'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let owner='11',calls=0,uncertain=0,releases=[],rejections=[],fieldWrites=[];
const field={name:'reason',id:'reason',setAttribute(name,value){fieldWrites.push([name,value]);},focus(){fieldWrites.push(['focus']);}};
const fieldLabel={set textContent(value){fieldWrites.push(['message',value]);}};
const fieldRoot={querySelectorAll(){return[field];},querySelector(){return field;}};
const sandbox={Request,Response,AbortController,setTimeout,clearTimeout,localStorage:{getItem(key){return key==='user'?JSON.stringify({id:owner}):'fixture-'+owner;}},document:{addEventListener(){},querySelector(){return fieldRoot;},querySelectorAll(){return[];},getElementById(){return fieldLabel;}},window:{fetch:async()=>{calls++;return new Promise((resolve,reject)=>{releases.push(resolve);rejections.push(reject);});},VoxelDialog:{markUncertain(){uncertain++;}}}};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../public/operations-ui.js'),'utf8'),sandbox);
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const adminSource=fs.readFileSync(require('node:path').join(__dirname,'../public/admin-dashboard.js'),'utf8');
function adminFunction(start,end){const at=adminSource.lastIndexOf(start),until=adminSource.indexOf(end,at);assert(at>=0&&until>at,'The actual reviewer function is required');return adminSource.slice(at,until);}
const adminFunctions={
 detail:adminFunction('async function openTimesheetDetail(id) {','\nasync function approveTimesheetRecord('),
 delivery:adminFunction('async function openWeeklyDeliveryDetail(deliveryId) {','\nfunction openWeeklyDeliveryRevision('),
 list:adminFunction('async function loadWeeklyTimesheetDeliveries(page = 1) {','\nasync function openWeeklyDeliveryPdf('),
 decision:adminFunction('async function openTimesheetDecision(','\nfunction renderTimesheetReviewActions('),
 register:adminFunction('async function loadTimesheets(options={}) {','if (!window.__adminStaffMessagePoller)')
};
function reviewerFixture(names){
 const state={owner:'A',reads:[],shown:[],errors:[],list:{page:1,pages:1,deliveries:[]},nodes:{weeklyDeliveryBody:{innerHTML:''},weeklyDeliveryPageSummary:{textContent:''},weeklyDeliverySchedule:{textContent:''},timesheetAdminBody:{innerHTML:'Current register'}}};
 const context={URLSearchParams,window:{},weeklyDeliveryState:state.list,attendanceCompanyTimezone:'Australia/Sydney',token:'fixture',
  fetch:()=>{const read=defer();state.reads.push(read);return read.promise;},safeJson:response=>{if(response.started)response.started.resolve();return response.bodyGate?response.bodyGate.promise:Promise.resolve(response.body);},
  VoxelActions:{account:()=>state.owner},authHeaders:()=>({}),escapeHtml:String,formatDateTime:String,renderTimesheetNote:String,renderTimesheetStatusChip:String,
  weeklyDeliveryHours:()=> '8.00',weeklyDeliveryReasons:()=>'',canManageWeeklyDelivery:()=>false,formatWorkplaceSchedule:()=> 'Monday 07:00',enhanceResponsiveTables(){},populateTimesheetFilterStaffSelects(){},
  showToast:(...args)=>state.errors.push(args),showDialog:(...args)=>state.shown.push(args),hideDialog(){},document:{getElementById:id=>state.nodes[id]||null,querySelector:()=>null}};
 context.VoxelActions.request=(...args)=>context.fetch(...args).then(response=>response.body);
 vm.runInNewContext(names.map(name=>adminFunctions[name]).join('\n'),context);
 return{state,context};
}
const detailData=(overrides={})=>({timesheet:{id:77,name:'Synthetic previous-account employee',week_start:'2026-10-19',week_end:'2026-10-25',total_hours:8,status:'DRAFT',...overrides},summary:{actualHours:8,records:[]}});
const deliveryData=(name='Synthetic delivery')=>({delivery:{user_id:77,version:1,status:'QUEUED',period_start:'2026-10-19',period_end:'2026-10-25',timezone:'Australia/Sydney',delivery_format:'HTML'},versions:[{version:1,status:'QUEUED',reason:name,created_at:'2026-10-26'}]});
async function reviewerReadIsolation(){
 for(const [name,entry,data]of[['detail','openTimesheetDetail',detailData()],['delivery','openWeeklyDeliveryDetail',deliveryData()]]){
  let f=reviewerFixture([name]),pending=f.context[entry](77);f.state.owner='B';f.state.reads[0].resolve({ok:true,body:data});await pending;assert.equal(f.state.shown.length,0,'A previous-account HTTP response never opens a detail');
  f=reviewerFixture([name]);const bodyGate=defer(),started=defer();pending=f.context[entry](77);f.state.reads[0].resolve({ok:true,bodyGate,started});await started.promise;f.state.owner='B';bodyGate.resolve(data);await pending;assert.equal(f.state.shown.length,0,'Account ownership is checked again after delayed JSON');
  f=reviewerFixture([name]);pending=f.context[entry](77);f.state.owner='B';f.state.reads[0].reject(new Error('Synthetic previous-account network failure'));await pending;assert.equal(f.state.errors.length,0,'An old request cannot show foreground errors in another account');
  f=reviewerFixture([name]);const old=f.context[entry](77),latest=f.context[entry](78);f.state.reads[1].resolve({ok:true,body:data});await latest;f.state.reads[0].resolve({ok:true,body:data});await old;assert.equal(f.state.shown.length,1,'A late older read cannot replace the current detail');
  f=reviewerFixture([name]);pending=f.context[entry](77);f.state.reads[0].resolve({ok:false,body:{message:'Synthetic current-account read failure'}});await pending;assert.equal(f.state.errors.length,1,'Current-account read errors remain actionable');
 }
 const f=reviewerFixture(['decision']);const failed=f.context.openTimesheetDecision(77,'approve');f.state.owner='B';f.state.reads[0].reject(new Error('Synthetic stale review error'));await failed;assert.equal(f.state.errors.length,0);
 for(const value of [null,undefined,'', ' ', 'invalid',false]){
  const view=reviewerFixture(['detail']),pending=view.context.openTimesheetDetail(77),data=detailData({total_hours:value,approved_hours:0});data.summary.actualHours=value;data.summary.records=[{total_hours:value}];view.state.reads[0].resolve({ok:true,body:data});await pending;
  assert.match(view.state.shown[0][1],/Verified completed source<\/small><strong>Not recorded/);assert.match(view.state.shown[0][1],/Saved \/ submitted<\/small><strong>Not recorded/);assert.match(view.state.shown[0][1],/Approved hours<\/small><strong>Not approved/);assert.doesNotMatch(view.state.shown[0][1],/0\.00 hrs/);
 }
 const zero=reviewerFixture(['detail']),zeroRead=zero.context.openTimesheetDetail(77),zeroData=detailData({status:'APPROVED',total_hours:0,approved_hours:0});zeroData.summary={actualHours:0,records:[{total_hours:0}]};zero.state.reads[0].resolve({ok:true,body:zeroData});await zeroRead;assert.match(zero.state.shown[0][1],/Approved hours<\/small><strong>0\.00 hrs/);assert.match(zero.state.shown[0][1],/Verified completed source<\/small><strong>0\.00 hrs/);
}
const listData=(name,page=1)=>({page,page_size:25,total:26,schedule:{timezone:'Australia/Sydney',weekday:1,hour:7,minute:0,enabled:true},deliveries:[{id:77,user_id:77,staff_name:name,version:1,status:'QUEUED',period_start:'2026-10-19',period_end:'2026-10-25'}]});
async function weeklyListIsolation(){
 let f=reviewerFixture(['list']),old=f.context.loadWeeklyTimesheetDeliveries(1),latest=f.context.loadWeeklyTimesheetDeliveries(2);f.state.reads[1].resolve({ok:true,body:listData('Latest filtered employee',2)});await latest;const displayed=f.state.nodes.weeklyDeliveryBody.innerHTML;f.state.reads[0].resolve({ok:true,body:listData('Old filtered employee')});await old;assert.equal(f.state.nodes.weeklyDeliveryBody.innerHTML,displayed);assert.equal(f.state.list.page,2);
 f=reviewerFixture(['list']);let pending=f.context.loadWeeklyTimesheetDeliveries();f.state.reads[0].resolve({ok:true,body:listData('Account A employee')});await pending;assert.equal(f.state.list.deliveries.length,1);old=f.context.loadWeeklyTimesheetDeliveries();f.state.owner='B';latest=f.context.loadWeeklyTimesheetDeliveries();assert.equal(f.state.list.deliveries.length,0,'A new account never inherits the previous cached cohort while loading');f.state.reads[2].resolve({ok:true,body:listData('Account B employee')});await latest;f.state.reads[1].reject(new Error('Account A old error'));await old;assert.match(f.state.nodes.weeklyDeliveryBody.innerHTML,/Account B employee/);assert.doesNotMatch(f.state.nodes.weeklyDeliveryBody.innerHTML,/Account A/);
 f=reviewerFixture(['list']);const bodyGate=defer(),started=defer();old=f.context.loadWeeklyTimesheetDeliveries();f.state.reads[0].resolve({ok:true,bodyGate,started});await started.promise;f.state.owner='B';latest=f.context.loadWeeklyTimesheetDeliveries();f.state.reads[1].resolve({ok:true,body:listData('Account B after delayed JSON')});await latest;bodyGate.reject(new Error('Old JSON failed'));await old;assert.match(f.state.nodes.weeklyDeliveryBody.innerHTML,/Account B after delayed JSON/);
 f=reviewerFixture(['register']);const child=defer();f.context.loadWeeklyTimesheetDeliveries=()=>child.promise;pending=f.context.loadTimesheets();f.state.owner='B';f.state.nodes.timesheetAdminBody.innerHTML='Account B register';child.resolve();await pending;assert.equal(f.state.nodes.timesheetAdminBody.innerHTML,'Account B register','A completed old child read cannot clear the current register');assert.equal(f.state.reads.length,0);
}
async function staleWriteEffects(){
 let before=uncertain;owner='A';let pending=sandbox.window.fetch('/api/late-500',{method:'POST',body:'{}'});owner='B';releases.at(-1)(Response.json({message:'Old failure'},{status:503}));assert.equal((await pending).status,503);assert.equal(uncertain,before);
 owner='A';pending=sandbox.window.fetch('/api/late-rejection',{method:'POST',body:'{}'});owner='B';rejections.at(-1)(new Error('Synthetic old-account rejection'));await assert.rejects(pending,/old-account rejection/);assert.equal(uncertain,before);
 owner='A';const invalidBody=defer(),invalidStarted=defer(),invalidResponse=new Response('null',{headers:{'Content-Type':'application/json'}});invalidResponse.clone=()=>({json:()=>{invalidStarted.resolve();return invalidBody.promise;}});pending=sandbox.window.fetch('/api/late-json',{method:'POST',body:'{}'});releases.at(-1)(invalidResponse);await invalidStarted.promise;owner='B';invalidBody.resolve(null);assert.equal((await pending).status,502,'The original caller retains its uncertain response');assert.equal(uncertain,before,'Delayed old JSON cannot mark another account form uncertain');
 owner='A';const errors=defer(),errorsStarted=defer(),response=Response.json({fields:{reason:'Previous account validation'}},{status:422});response.clone=()=>({json:()=>{errorsStarted.resolve();return errors.promise;}});fieldWrites=[];pending=sandbox.window.fetch('/api/late-validation',{method:'POST',body:'{}'});releases.at(-1)(response);await errorsStarted.promise;owner='B';errors.resolve({fields:{reason:'Previous account validation'}});const original=await pending;assert.equal(original.status,422);assert.deepEqual((await original.json()).fields,{reason:'Previous account validation'});assert.equal(fieldWrites.length,0,'Old fields are never painted into the new account form');
 pending=sandbox.window.fetch('/api/current-validation',{method:'POST',body:'{}'});releases.at(-1)(Response.json({fields:{reason:'Current account validation'}},{status:422}));await pending;assert(fieldWrites.length>0,'Current-owner field validation still appears');assert.equal(uncertain,before);
}
(async()=>{
 const one=sandbox.window.fetch('/api/record',{method:'POST',body:'{"request_id":"same"}'}),same=sandbox.window.fetch('/api/record',{method:'POST',body:'{"request_id":"same"}'});assert.equal(calls,1);
 owner='22';const other=sandbox.window.fetch('/api/record',{method:'POST',body:'{"request_id":"same"}'});assert.equal(calls,2,'another authenticated account must never inherit the previous account write or response');
 releases[0](Response.json({owner:11}));releases[1](Response.json({owner:22}));assert.deepEqual(await(await one).json(),{owner:11});assert.deepEqual(await(await same).json(),{owner:11});assert.deepEqual(await(await other).json(),{owner:22});
 const before=calls,failed=sandbox.window.fetch('/api/failed',{method:'POST',body:'{}'});releases.at(-1)(Response.json({message:'Not saved or approved'},{status:503}));assert.equal((await failed).status,503);assert.equal(calls,before+1,'uncertain writes must never be automatically retried');assert.equal(uncertain,1);
 const html=sandbox.window.fetch('/api/html',{method:'POST',body:'{}'});releases.at(-1)(new Response('<html>login</html>',{headers:{'Content-Type':'text/html'}}));assert.equal((await html).status,502);assert.equal(uncertain,2,'an HTML success response is uncertain, not a committed write or PDF');
 await staleWriteEffects();await reviewerReadIsolation();await weeklyListIsolation();
 console.log('Action network tests passed: account-scoped writes and delayed reviewer reads; old response/error/field/uncertainty effects never cross accounts; current cohort and selection preserved; missing versus zero hours; duplicate prevention and original response outcomes retained. No business records or transport used.');
})().catch(error=>{console.error(error);process.exitCode=1;});
