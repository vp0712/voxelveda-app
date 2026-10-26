'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/android-app.js'),'utf8');
function fixture(){
 let owner='synthetic-staff-one',active=null,resolver=null,confirmations=0,closed=0,backs=0;
 const listeners={},field={name:'name',type:'text',value:'Unsaved synthetic value'},form={dataset:{nativeDirty:'true',nativeBeforeunload:'true'},isConnected:true,elements:[field]};
 const forms=[form],notices=[];
 const feedback={confirm(){confirmations++;active='action-feedback';return new Promise(resolve=>{resolver=resolve;});},notify(message){notices.push(message);},get active(){return active==='action-feedback';}};
 const doc={forms,documentElement:{dataset:{}},body:{classList:{contains:()=>false}},getElementById:()=>null,querySelector:()=>null,addEventListener(){},dispatchEvent(){}};
 const context={document:doc,location:{origin:'https://app.voxelveda.com',pathname:'/portal/staff'},localStorage:{getItem:()=>null},history:{back(){backs++;}},TextDecoder,Uint8Array,MutationObserver:class{observe(){}},KeyboardEvent:class{},console,Promise};
 context.window=context;context.addEventListener=(name,fn)=>{(listeners[name]||=[]).push(fn);};context.Capacitor={isNativePlatform:()=>true,Plugins:{VoxelVedaApp:{async setAppearance(){},async openCameraSettings(){}}}};
 context.VoxelActions={account:()=>owner};context.VoxelFeedback=feedback;context.VoxelOverlay={get active(){return active;},close(){closed++;active=null;const finish=resolver;resolver=null;finish?.(false);return true;}};
 vm.runInNewContext(source,context,{filename:'public/android-app.js'});
 return {app:context.VoxelNativeApp,form,field,forms,context,notices,get confirmations(){return confirmations;},get backs(){return backs;},get closed(){return closed;},set owner(value){owner=value;},set overlay(value){active=value;},answer(value){const finish=resolver;resolver=null;active=null;assert(finish,'A managed confirmation is open');finish(value);},emit(name){for(const fn of listeners[name]||[])fn();}};
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
 console.log('Android managed Back tests passed: synchronous boolean contract; async one-shot native continuation; repeated Back/cancel preserve input; changed account/value/document rejection; single-layer dismissal; missing-UI fail-closed; prior installed bridges with and without history. Fixtures only, no physical device or Play distribution claim.');
}
module.exports={run};
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
