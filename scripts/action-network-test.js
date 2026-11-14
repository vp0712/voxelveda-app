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
 helpers:adminFunction('function timesheetLifecycleStatus(record)','\nfunction reviewPendingTimesheets(')+ '\n'+adminFunction('function timesheetClockLabel(row,name,zone)','\nasync function openTimesheetDetail('),
 detail:adminFunction('async function openTimesheetDetail(id) {','\nasync function openTimesheetEdit('),
 edit:adminFunction('async function openTimesheetEdit(id,attendanceId) {','\n// Retained function names'),
 delivery:adminFunction('async function openWeeklyDeliveryDetail(deliveryId) {','\nfunction openWeeklyDeliveryRevision('),
 list:adminFunction('async function loadWeeklyTimesheetDeliveries(page = 1) {','\nasync function openWeeklyDeliveryPdf('),
 decision:adminFunction('async function openTimesheetDecision(','\nfunction renderTimesheetReviewActions('),
 register:adminFunction('async function loadTimesheets(options={}) {','if (!window.__adminStaffMessagePoller)')
};
const weeklySource=fs.readFileSync(require('node:path').join(__dirname,'../public/weekly-delivery.js'),'utf8');
function reviewerFixture(names){
 const state={owner:'A',reads:[],readRequests:[],shown:[],errors:[],visible:null,list:{page:1,pages:1,deliveries:[]},nodes:{weeklyDeliveryBody:{innerHTML:''},weeklyDeliveryPageSummary:{textContent:''},weeklyDeliverySchedule:{textContent:''},timesheetAdminBody:{innerHTML:'Current register'}}};
 const permanent=new Set(Object.keys(state.nodes)),events={};
 function mount(html){
  for(const match of html.matchAll(/<([a-z]+)\b[^>]*\bid="([^"]+)"[^>]*>/gi)){
   const tag=match[1],id=match[2],markup=match[0];
   if(!state.nodes[id]){let content='';const node={value:'',textContent:'',addEventListener(){},focus(){},setAttribute(){},querySelector(){return null;},querySelectorAll(){return[];}};
    Object.defineProperty(node,'innerHTML',{get:()=>content,set:value=>{content=String(value);mount(content);}});state.nodes[id]=node;}
   if(['input','select'].includes(tag)){const value=markup.match(/\bvalue="([^"]*)"/);if(value)state.nodes[id].value=value[1];}
  }
 }
 function showDialog(...args){for(const id of Object.keys(state.nodes))if(!permanent.has(id))delete state.nodes[id];mount(args[1]);state.shown.push(args);state.visible={title:args[0],html:args[1],callback:args[2]};}
 function hideDialog(){state.visible=null;for(const id of Object.keys(state.nodes))if(!permanent.has(id))delete state.nodes[id];}
 const context={URLSearchParams,AbortController,setTimeout,clearTimeout,crypto:require('node:crypto'),window:{addEventListener:(name,handler)=>{events[name]=handler;}},weeklyDeliveryState:state.list,attendanceCompanyTimezone:'Australia/Sydney',currentUser:{id:900},token:'fixture',
  localStorage:{getItem:key=>key==='user'?JSON.stringify({id:state.owner}):'fixture-'+state.owner},
  fetch:(url,options={})=>{const read=defer();state.reads.push(read);state.readRequests.push({url,method:options.method||'GET'});return read.promise.then(response=>{if(!response.json)response.json=()=>{if(response.started)response.started.resolve();return response.bodyGate?response.bodyGate.promise:Promise.resolve(response.body);};return response;});},
  safeJson:response=>{if(response.started)response.started.resolve();return response.bodyGate?response.bodyGate.promise:Promise.resolve(response.body);},
  VoxelActions:{account:()=>state.owner,date:value=>String(value||'Date unavailable')},authHeaders:()=>({}),escapeHtml:String,formatDateTime:String,renderTimesheetNote:String,renderTimesheetStatusChip:String,
  weeklyDeliveryHours:()=> '8.00',weeklyDeliveryReasons:()=>'',canManageWeeklyDelivery:()=>false,formatWorkplaceSchedule:()=> 'Monday 07:00',enhanceResponsiveTables(){},populateTimesheetFilterStaffSelects(){},
  showToast:(...args)=>state.errors.push(args),showDialog,hideDialog,document:{addEventListener(){},getElementById:id=>state.nodes[id]||null,querySelector:()=>null,querySelectorAll:()=>[]}};
 Object.assign(context.window,{showDialog,hideDialog,VoxelActions:context.VoxelActions});
 context.VoxelActions.request=(...args)=>context.fetch(...args).then(response=>response.body);
 vm.runInNewContext(weeklySource,context);
 const selected=[...new Set(['helpers',...names,...(names.includes('decision')?['edit']:[])])];
 vm.runInNewContext(selected.map(name=>adminFunctions[name]).join('\n'),context);
 state.fireStorage=()=>events.storage?.({key:'user'});
 return{state,context};
}
const detailData=(overrides={})=>({timesheet:{id:77,user_id:77,name:'Synthetic previous-account employee',week_start:'2026-10-19',week_end:'2026-10-25',total_hours:8,status:'IN_PROGRESS',can_edit:false,version_no:3,...overrides},summary:{actualHours:8,verified_total_minutes:480,company_timezone:'Australia/Sydney',records:[]}});
const sourceData=id=>{const data=detailData({id,user_id:id,can_edit:true,status:'FINAL',final_hours:8,name:'Synthetic source employee '+id});data.summary.records=[{id:161,user_id:id,work_date:'2026-10-20',clock_in:'2026-10-19T22:00:00Z',clock_out:'2026-10-20T06:00:00Z',timestamp_basis:'UTC',clock_out_timestamp_basis:'UTC',break_minutes:0,total_hours:8,revision:4,can_edit_source:true}];return data;};
const deliveryData=(name='Synthetic delivery')=>({delivery:{user_id:77,version:1,status:'QUEUED',period_start:'2026-10-19',period_end:'2026-10-25',timezone:'Australia/Sydney',delivery_format:'HTML'},versions:[{version:1,status:'QUEUED',reason:name,created_at:'2026-10-26'}]});
async function reviewerReadIsolation(){
 for(const [name,entry,data]of[['detail','openTimesheetDetail',detailData()],['delivery','openWeeklyDeliveryDetail',deliveryData()]]){
  let f=reviewerFixture([name]),pending=f.context[entry](77);f.state.owner='B';f.state.reads[0].resolve({ok:true,body:data});await pending;assert.equal(f.state.shown.length,0,'A previous-account HTTP response never opens a detail');
  f=reviewerFixture([name]);const bodyGate=defer(),started=defer();pending=f.context[entry](77);f.state.reads[0].resolve({ok:true,bodyGate,started});await started.promise;f.state.owner='B';bodyGate.resolve(data);await pending;assert.equal(f.state.shown.length,0,'Account ownership is checked again after delayed JSON');
  f=reviewerFixture([name]);pending=f.context[entry](77);f.state.owner='B';f.state.reads[0].reject(new Error('Synthetic previous-account network failure'));await pending;assert.equal(f.state.errors.length,0,'An old request cannot show foreground errors in another account');
  f=reviewerFixture([name]);const old=f.context[entry](77),latest=f.context[entry](78),latestData=name==='detail'?detailData({id:78,user_id:78,name:'Latest selected employee'}):deliveryData('Latest selected delivery');f.state.reads[1].resolve({ok:true,body:latestData});await latest;const shown=f.state.shown.at(-1);f.state.reads[0].resolve({ok:true,body:data});await old;assert.equal(f.state.shown.length,1,'A late older read cannot replace the current detail');assert.equal(f.state.shown.at(-1),shown,'The newest selected record remains visible');
  f=reviewerFixture([name]);pending=f.context[entry](77);f.state.reads[0].resolve({ok:false,body:{message:'Synthetic current-account read failure'}});await pending;assert.equal(f.state.errors.length,1,'Current-account read errors remain actionable');
 }
 const mismatch=reviewerFixture(['detail']),mismatched=mismatch.context.openTimesheetDetail(78);mismatch.state.reads[0].resolve({ok:true,body:detailData()});await mismatched;assert.equal(mismatch.state.shown.length,0,'A response for another record cannot be displayed as the selected record');assert.match(mismatch.state.errors[0][0],/did not match/);
 for(const value of [null,undefined,'', ' ', 'invalid',false]){
  const view=reviewerFixture(['detail']),pending=view.context.openTimesheetDetail(77),data=detailData({total_hours:value,approved_hours:0});data.summary.actualHours=value;data.summary.records=[{total_hours:value}];view.state.reads[0].resolve({ok:true,body:data});await pending;
  assert.match(view.state.shown[0][1],/Verified completed source<\/small><strong>Not recorded/);assert.match(view.state.shown[0][1],/Saved recorded work<\/small><strong>Not recorded/);assert.match(view.state.shown[0][1],/Final hours<\/small><strong>Week in progress/);assert.doesNotMatch(view.state.shown[0][1],/0\.00 hrs/);
 }
 for(const status of ['FINAL','APPROVED']){const zero=reviewerFixture(['detail']),zeroRead=zero.context.openTimesheetDetail(77),zeroData=detailData({status,total_hours:0,final_hours:0,approved_hours:0});zeroData.summary={actualHours:0,records:[{total_hours:0}]};zero.state.reads[0].resolve({ok:true,body:zeroData});await zeroRead;assert.match(zero.state.shown[0][1],/Final hours<\/small><strong>0\.00 hrs/);assert.match(zero.state.shown[0][1],/Verified completed source<\/small><strong>0\.00 hrs/);}
 await sourceEditReadIsolation();
}
async function sourceEditReadIsolation(){
 // The compatibility entry must execute the actual shared module, not a mock
 // approval handler. It only opens source records and cannot approve a week.
 let f=reviewerFixture(['decision']),pending=f.context.openTimesheetDecision(77,'approve');assert.equal(f.state.readRequests[0].url,'/api/attendance/timesheets/77');f.state.owner='B';f.state.reads[0].reject(new Error('Synthetic stale source review error'));await pending;assert.equal(f.state.shown.length,1,'Only the initial loading dialog was opened');assert.doesNotMatch(f.state.visible.html,/Synthetic source employee/);assert.equal(f.state.errors.length,0);
 f=reviewerFixture(['edit']);pending=f.context.openTimesheetEdit(77,161);f.state.owner='B';f.state.reads[0].resolve({ok:true,body:sourceData(77)});await pending;assert.equal(f.state.shown.length,1,'A previous-account source HTTP response never opens an edit form');assert.equal(f.state.nodes.timesheetEditPanel,undefined);
 f=reviewerFixture(['edit']);const bodyGate=defer(),started=defer();pending=f.context.openTimesheetEdit(77,161);f.state.reads[0].resolve({ok:true,bodyGate,started});await started.promise;f.state.owner='B';bodyGate.resolve(sourceData(77));await pending;assert.equal(f.state.shown.length,1,'The source edit owner is rechecked after delayed JSON');assert.equal(f.state.nodes.timesheetEditPanel,undefined);
 f=reviewerFixture(['edit']);let old=f.context.openTimesheetEdit(77,161),latest=f.context.openTimesheetEdit(78,161);f.state.reads[1].resolve({ok:true,body:sourceData(78)});await latest;assert(f.state.nodes.timesheetEditPanel,'The latest legitimate source edit form is shown');assert.match(f.state.visible.html,/Synthetic source employee 78/);const displayed=f.state.visible;f.state.reads[0].resolve({ok:true,body:sourceData(77)});await old;assert.equal(f.state.visible,displayed,'A late previous selection cannot replace the newest source edit form');assert.equal(f.state.shown.length,3,'Two loading states and exactly one legitimate edit form');
 f=reviewerFixture(['edit']);old=f.context.openTimesheetEdit(77,161);latest=f.context.openTimesheetEdit(78,161);const latestLoading=f.state.nodes.weeklyReviewPanel.innerHTML;f.state.reads[0].reject(new Error('Older source read failed while the new selection loads'));await old;assert.equal(f.state.nodes.weeklyReviewPanel.innerHTML,latestLoading,'An older source error cannot overwrite the newer pending selection');f.state.reads[1].resolve({ok:true,body:sourceData(78)});await latest;assert.match(f.state.visible.html,/Synthetic source employee 78/);
 f=reviewerFixture(['edit']);const delayed=defer(),jsonStarted=defer();old=f.context.openTimesheetEdit(77,161);f.state.reads[0].resolve({ok:true,bodyGate:delayed,started:jsonStarted});await jsonStarted.promise;latest=f.context.openTimesheetEdit(78,161);f.state.reads[1].resolve({ok:true,body:sourceData(78)});await latest;const latestVisible=f.state.visible;delayed.reject(new Error('Old source JSON failed'));await old;assert.equal(f.state.visible,latestVisible,'An old source JSON failure cannot replace the current edit form or show a new error');assert.doesNotMatch(f.state.visible.html,/Old source JSON failed/);
 f=reviewerFixture(['edit']);pending=f.context.openTimesheetEdit(77,161);f.state.reads[0].resolve({ok:false,body:{message:'Synthetic current-account source read failure'}});await pending;assert.match(f.state.nodes.weeklyReviewPanel.innerHTML,/Synthetic current-account source read failure/,'Current source errors remain visible and retryable');assert(f.state.nodes.timesheetEditRetry,'A current source read has a retry control');
 assert(f.state.readRequests.every(request=>request.method==='GET'),'Opening/reviewing a source never performs a submission or approval write');
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
