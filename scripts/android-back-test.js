'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/android-app.js'),'utf8');
function fixture(){
 let owner='synthetic-staff-one',active=null,resolver=null,confirmations=0,closed=0,backs=0;
 const listeners={},field={name:'name',type:'text',value:'Unsaved synthetic value'},form={dataset:{nativeDirty:'true',nativeBeforeunload:'true'},isConnected:true,elements:[field]};
 const forms=[form],scopes=[],notices=[],documentListeners={};
 const feedback={confirm(){confirmations++;active='action-feedback';return new Promise(resolve=>{resolver=resolve;});},notify(message){notices.push(message);},get active(){return active==='action-feedback';}};
 const doc={forms,documentElement:{dataset:{}},body:{classList:{contains:()=>false}},getElementById:()=>null,querySelector:selector=>scopes.find(scope=>selector==='[data-native-dirty-scope="'+scope.dataset.nativeDirtyScope+'"]')||null,querySelectorAll:selector=>selector==='[data-native-dirty-scope]'?scopes:[],addEventListener(name,fn){(documentListeners[name]||=[]).push(fn);},dispatchEvent(){}};
 const context={document:doc,location:{origin:'https://app.voxelveda.com',pathname:'/portal/staff'},localStorage:{getItem:()=>null},history:{back(){backs++;}},TextDecoder,Uint8Array,MutationObserver:class{observe(){}},KeyboardEvent:class{},console,Promise};
 context.window=context;context.addEventListener=(name,fn)=>{(listeners[name]||=[]).push(fn);};context.Capacitor={isNativePlatform:()=>true,Plugins:{VoxelVedaApp:{async setAppearance(){},async openCameraSettings(){}}}};
 context.VoxelActions={account:()=>owner};context.VoxelFeedback=feedback;context.VoxelOverlay={get active(){return active;},close(){closed++;active=null;const finish=resolver;resolver=null;finish?.(false);return true;}};
 vm.runInNewContext(source,context,{filename:'public/android-app.js'});
 return {app:context.VoxelNativeApp,form,field,forms,scopes,context,notices,get confirmations(){return confirmations;},get backs(){return backs;},get closed(){return closed;},set owner(value){owner=value;},set overlay(value){active=value;},answer(value){const finish=resolver;resolver=null;active=null;assert(finish,'A managed confirmation is open');finish(value);},emit(name){for(const fn of listeners[name]||[])fn();},input(scope,name='input'){for(const fn of documentListeners[name]||[])fn({target:{closest:selector=>selector==='form,[data-native-dirty-scope]'?scope:null}});}};
}
const flush=async()=>{for(let n=0;n<5;n++)await Promise.resolve();};
async function run(){
 let f=fixture();f.forms.length=0;assert.equal(f.app.handleBack({canGoBack:true,requestId:'clean'}),false,'Clean native Back retains the synchronous false contract');
 f=fixture();assert.equal(f.app.handleBack({canGoBack:true,requestId:'first'}),true);assert.equal(f.app.takeBackDecision('first'),'pending');assert.equal(f.app.takeBackDecision('unrelated'),null);await flush();assert.equal(f.confirmations,1);
 assert.equal(f.app.handleBack({canGoBack:true,requestId:'repeated'}),true,'Repeated Back dismisses only the current confirmation');await flush();assert.equal(f.closed,1);assert.equal(f.app.takeBackDecision('first'),'cancelled');assert.equal(f.field.value,'Unsaved synthetic value');assert.equal(f.backs,0);
 assert.equal(f.app.handleBack({canGoBack:false,requestId:'cancelled'}),true);await flush();f.answer(false);await flush();assert.equal(f.app.takeBackDecision('cancelled'),'cancelled');assert.equal(f.backs,0);
 assert.equal(f.app.handleBack({canGoBack:false,requestId:'confirmed'}),true);await flush();f.answer(true);await flush();assert.equal(f.app.takeBackDecision('confirmed'),'continue','A confirmed cold-screen Back can finish through the native continuation');assert.equal(f.app.takeBackDecision('confirmed'),null,'The same confirmation cannot navigate twice');assert.equal(f.app.allowDiscardOnUnload(f.form),true);assert.equal(f.app.allowDiscardOnUnload(f.form),false,'The browser unload grant is one-shot');
 for(const change of ['new-input','changed-account','detached-form']){
  f=fixture();assert.equal(f.app.handleBack({canGoBack:true,requestId:change}),true);await flush();f.answer(true);await flush();
  if(change==='new-input')f.field.value='New unsaved value';else if(change==='changed-account')f.owner='synthetic-staff-two';else f.form.isConnected=false;
  assert.equal(f.app.takeBackDecision(change),'cancelled',change+' invalidates the outstanding discard');assert.equal(f.app.allowDiscardOnUnload(f.form),false);
 }
 f=fixture();f.app.handleBack({requestId:'unloaded'});await flush();f.emit('pagehide');f.answer(true);await flush();assert.equal(f.app.takeBackDecision('unloaded'),null,'A previous document cannot continue Back after navigation');
 f=fixture();f.overlay='existing-detail';assert.equal(f.app.handleBack({requestId:'overlay'}),true);assert.equal(f.closed,1);assert.equal(f.confirmations,0);assert.equal(f.app.takeBackDecision('overlay'),null,'Dismissing a layer cannot also navigate');
 f=fixture();delete f.context.VoxelFeedback;assert.equal(f.app.handleBack({requestId:'ui-missing'}),true,'Missing shared confirmation keeps unsaved values');assert.equal(f.app.takeBackDecision('ui-missing'),null);assert.equal(f.backs,0);
 f=fixture();assert.equal(f.app.handleBack({canGoBack:true}),true,'An installed old bridge still receives a synchronous boolean');await flush();f.answer(true);await flush();assert.equal(f.backs,1,'Old bridges with history continue after managed consent without a new plugin');assert.equal(f.app.allowDiscardOnUnload(f.form),true);
 f=fixture();assert.equal(f.app.handleBack({canGoBack:false}),true);await flush();f.answer(true);await flush();assert.equal(f.backs,0);assert.match(f.notices[0],/Press Back again/);assert.equal(f.app.handleBack({canGoBack:false}),false,'Old cold-screen bridge can finish on one explicit subsequent Back, without another confirmation');assert.equal(f.confirmations,1);
 f=fixture();f.app.handleBack({canGoBack:false});await flush();f.answer(true);await flush();f.field.value='New value after consent';assert.equal(f.app.handleBack({canGoBack:false}),true,'New edits invalidate old-bridge consent');await flush();assert.equal(f.confirmations,2);f.answer(false);await flush();
 f=fixture();f.form.dataset.nativeRequestState='pending';assert.equal(f.app.handleBack({requestId:'saving'}),true,'Pending writes hold native Back');await flush();assert.equal(f.confirmations,0,'Pending writes never offer Discard');assert.equal(f.app.takeBackDecision('saving'),null);assert.equal(f.app.allowDiscardOnUnload(f.form),false);assert.equal(f.backs,0);assert.match(f.notices[0],/still being saved/);
 f.form.dataset.nativeRequestState='uncertain';assert.equal(f.app.handleBack({requestId:'uncertain'}),true);await flush();assert.equal(f.confirmations,1,'A finished but uncertain request retains entered values through managed confirmation');f.answer(false);await flush();assert.equal(f.app.takeBackDecision('uncertain'),'cancelled');
 f=fixture();f.app.handleBack({requestId:'before-write'});await flush();f.answer(true);await flush();f.form.dataset.nativeRequestState='pending';assert.equal(f.app.takeBackDecision('before-write'),'cancelled','A write that starts after consent invalidates native continuation');assert.equal(f.app.allowDiscardOnUnload(f.form),false);
 f=fixture();f.forms.length=0;const gridField={id:'taskTitle',type:'text',value:'Task in a real formless write scope'};const grid={dataset:{nativeDirtyScope:'task-create'},isConnected:true,querySelectorAll:()=>[gridField]};f.scopes.push(grid);f.input(grid,'change');assert.equal(grid.dataset.nativeDirty,'true','Select and other change events are tracked in explicit write scopes');const saved=f.app.captureWrite(grid);assert.equal(f.app.handleBack({requestId:'grid'}),true);await flush();f.answer(false);await flush();assert.equal(f.app.takeBackDecision('grid'),'cancelled');assert.equal(gridField.value,'Task in a real formless write scope');assert.equal(f.app.markSaved(saved),true);assert.equal(f.app.handleBack({requestId:'saved-grid'}),false,'Confirmed unchanged saves clear the write scope');
 f.input(grid);const old=f.app.captureWrite(grid);gridField.value='New edits made while save runs';assert.equal(f.app.markSaved(old),false,'A completed save cannot clear later edits');assert.equal(grid.dataset.nativeDirty,'true');const otherAccount=f.app.captureWrite(grid);f.owner='synthetic-staff-two';assert.equal(f.app.markSaved(otherAccount),false,'A previous account cannot clear the current write scope');
 f=fixture();f.forms.length=0;f.input(null);assert.equal(f.app.handleBack({requestId:'filter'}),false,'Unmarked register/filter inputs cannot create dirty write scopes');
 await actualOperationalSaveHooks();
 console.log('Android managed Back tests passed: synchronous boolean contract; async one-shot native continuation; repeated Back/cancel preserve input; changed account/value/document rejection; pending-write hold and stale consent rejection; explicit formless write scopes; actual RFQ/task/settings successful, failed and later-edit save hooks; single-layer dismissal; missing-UI fail-closed; prior installed bridges with and without history. Fixtures only, no physical device or Play distribution claim.');
}
async function actualOperationalSaveHooks(){
 const dashboard=fs.readFileSync(path.join(__dirname,'../public/admin-dashboard.js'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,'../public/admin-dashboard.html'),'utf8');
 const names=[...html.matchAll(/data-native-dirty-scope="([^"]+)"/g)].map(match=>match[1]);
 assert.deepEqual(names,['rfq-create','task-create','company-settings'],'Only confirmed page write grids are marked; search/filter/sidebar markup remains excluded');
 for(const [name,scopeName]of [['submitRFQ','rfq-create'],['submitTask','task-create'],['saveSettings','company-settings']]){
  const source=dashboard.match(new RegExp('async function '+name+'\\(\\) \\{[\\s\\S]*?\\n\\}\\n'))?.[0];assert(source,'The actual '+name+' handler exists');
  for(const outcome of ['failed','saved','later-edit']){
   const success=outcome!=='failed';
   const f=fixture();f.forms.length=0;const field={id:scopeName,type:'text',value:'Saved source value'},scope={dataset:{nativeDirtyScope:scopeName,nativeDirty:'true'},isConnected:true,querySelectorAll:()=>[field]};f.scopes.push(scope);
   f.context.document.getElementById=id=>({value:id==='taskAssignedTo'?'42':id==='rfqQuantity'?'1':id==='rfqEmail'?'staff@fixture.invalid':id==='taskDueDate'?'2026-10-29':'Fixture '+id,setCustomValidity(){}});
   Object.assign(f.context,{fetch:async()=>{if(outcome==='later-edit')field.value='Later user edit';return{ok:success,status:success?200:422};},safeJson:async()=>({message:'Explicit fixture result'}),authHeaders:()=>({}),showToast(){},isValidEmail:value=>value.includes('@'),crypto:{randomUUID:()=> 'synthetic-request'},loadRFQs:async()=>{},loadTasks:async()=>{},loadDashboardStats:async()=>{},updateQrTargetFromType(){}});
   vm.runInNewContext(source,f.context);await f.context[name]();
   assert.equal(scope.dataset.nativeDirty,outcome==='saved'?undefined:'true',name+' clears only the authoritative successful unchanged save');
  }
 }
}
module.exports={run};
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
