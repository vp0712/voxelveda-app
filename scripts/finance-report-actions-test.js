'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const viewer=fs.readFileSync(require.resolve('../public/report-viewer.js'),'utf8');
const finance=fs.readFileSync(require.resolve('../public/finance-master.js'),'utf8');
const reportPath='/finance/reports/RPT_fixture/view?page=2#transactions';
const htmlName='Voxel-Veda-Register-2026-09-30-to-2026-10-06.html';
const htmlResponse=()=>new Response('<!doctype html><p>Saved immutable transaction</p>',{headers:{'Content-Type':'text/html; charset=utf-8','Content-Disposition':'inline; filename="'+htmlName+'"'}});

function viewerHarness({format='html',response=htmlResponse(),popup=null,fetchBody}={}){
  const attrs={href:'/api/finance/reports/snapshots/RPT_fixture/download/'+format},events={},printed={},saved=[],calls=[],timers=new Map();
  const feedback={textContent:'',setAttribute(k,v){this[k]=v;}};
  const link={href:'https://app.voxelveda.com'+attrs.href,getAttribute:k=>attrs[k],setAttribute:(k,v)=>attrs[k]=v,removeAttribute:k=>delete attrs[k],addEventListener:(k,fn)=>events[k]=fn};
  const button={disabled:false,dataset:{reportPrint:'/api/finance/reports/snapshots/RPT_fixture/download/print'},addEventListener:(k,fn)=>printed[k]=fn};
  const location={pathname:'/finance/reports/RPT_fixture/view',search:'?page=2',hash:'#transactions',assign(url){this.redirect=url;}};
  let timerId=0;
  const context={
    document:{getElementById:()=>feedback,querySelectorAll:selector=>selector==='[data-report-download]'?[link]:[],querySelector:selector=>selector==='[data-report-print]'?button:null,createElement:()=>({click(){saved.push(this.download);},remove(){}}),body:{appendChild(){}}},
    window:{open:()=>popup},location,AbortController,URL:class extends URL{static createObjectURL(){return 'blob:fixture';}static revokeObjectURL(){}},FormData,
    setTimeout(fn,ms){timers.set(++timerId,{fn,ms});return timerId;},clearTimeout(id){timers.delete(id);},
    fetch:async(url,options)=>{calls.push({url,options});return fetchBody?fetchBody(url,options):response;}
  };
  vm.runInNewContext(viewer,context);
  return {context,events,printed,feedback,link,button,attrs,saved,calls,timers,location};
}
async function viewerChecks(){
  let h=viewerHarness({format:'pdf',response:new Response('<p>Not PDF</p>',{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="Report.pdf"'}})});
  await h.events.click({preventDefault(){}});assert.equal(h.saved.length,0);assert.match(h.feedback.textContent,/PDF response is invalid/);assert.equal(h.feedback.role,'alert');
  h=viewerHarness({response:new Response('{}',{headers:{'Content-Type':'application/json','Content-Disposition':'attachment; filename="Report.html"'}})});
  await h.printed.click({currentTarget:h.button});assert.equal(h.saved.length,0);assert.match(h.feedback.textContent,/requested report format/);assert.equal(h.button.disabled,false);
  h=viewerHarness();await h.printed.click({currentTarget:h.button});assert.deepEqual(h.saved,[htmlName]);assert.match(h.feedback.textContent,/full print-friendly HTML was downloaded/);
  const popup={document:{body:{}},closed:false,focus(){},print(){this.printed=true;},close(){},location:{set href(value){assert.equal(typeof popup.onload,'function','Print listener must be attached before navigating the new window');this.value=value;popup.onload();}}};
  h=viewerHarness({popup});await h.printed.click({currentTarget:h.button});assert(popup.printed);assert.equal(popup.location.value,'blob:fixture');
  h=viewerHarness({response:new Response('{}',{status:401})});await h.events.click({preventDefault(){}});
  assert.equal(new URL(h.location.redirect,'https://app.voxelveda.com').searchParams.get('returnTo'),reportPath);assert.equal(h.saved.length,0);
  let bodyStarted=false;
  h=viewerHarness({fetchBody:async(url,{signal})=>({ok:true,status:200,headers:new Headers({'Content-Type':'text/html','Content-Disposition':'attachment; filename="Report.html"'}),blob:()=>new Promise((resolve,reject)=>{bodyStarted=true;signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})));})})});
  const pending=h.events.click({preventDefault(){}});for(let i=0;i<5&&!bodyStarted;i++)await Promise.resolve();
  assert(bodyStarted);const deadline=[...h.timers.values()].find(x=>x.ms===60000);assert(deadline,'The download timeout must remain active while reading attachment bytes');deadline.fn();await pending;
  assert.match(h.feedback.textContent,/action timed out/);assert.equal(h.saved.length,0);assert.equal(h.attrs['aria-busy'],undefined);
}
async function builderPrintChecks(){
  const code=finance.slice(finance.indexOf('async function printBuiltReport('),finance.indexOf('async function runReportPreset('));
  const saved=[],messages=[],calls=[];let popup=null,response=htmlResponse(),authChecks=0;
  const context={window:{open:()=>popup},document:{createElement:()=>({click(){saved.push(this.download);},remove(){}}),body:{appendChild(){}}},
    AbortController,URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL(){}},setTimeout:()=>1,clearTimeout(){},
    ensureBuiltReport:async()=>({report_id:'RPT_fixture'}),snapshotDownloadUrl:(report,format)=>'/api/finance/reports/snapshots/'+report.report_id+'/download/'+format,
    fetch:async(url,options)=>{calls.push({url,options});return response;},financeAuthError:()=>{authChecks++;return new Error('Secure session ended');},requestFinanceStepUp:async()=>{},notice:(message,bad)=>messages.push({message,bad})};
  vm.runInNewContext(code+'\nthis.print=printBuiltReport;',context);
  // No AbortSignal global is supplied: older Safari and WebViews still work.
  await context.print();assert.deepEqual(saved,[htmlName]);assert.match(messages.at(-1).message,/downloaded HTML/);
  assert(calls.every(call=>call.url==='/api/finance/reports/snapshots/RPT_fixture/download/print'&&call.options.credentials==='same-origin'&&call.options.signal));
  response=new Response('{}',{status:401});await context.print();assert.equal(authChecks,1);assert.match(messages.at(-1).message,/Secure session ended/);assert.equal(saved.length,1);
  response=htmlResponse();popup={document:{body:{}},closed:false,focus(){},print(){this.printed=true;},close(){},location:{set href(value){assert.equal(typeof popup.onload,'function');popup.onload();}}};
  await context.print();assert(popup.printed);
}
async function stepUpExpiryCheck(){
  const nativeFetch=async()=>new Response('{}',{status:401});let redirected;
  const fields=()=>({value:'',disabled:false,textContent:'',focus(){}}),selectors={};
  selectors['#stepUpPassword']=fields();selectors['#stepUpCode']=fields();selectors['#stepUpStatus']=fields();selectors['.step-up-confirm']=fields();selectors['#stepUpAction']=fields();selectors['.step-up-cancel']={addEventListener(){},removeEventListener(){}};
  let submit;
  selectors['#stepUpForm']={addEventListener:(event,fn)=>submit=fn,removeEventListener(){}};
  const dialog={querySelector:selector=>selectors[selector]},document={getElementById:()=>dialog,addEventListener(){}};
  const window={fetch:nativeFetch,location:{pathname:'/finance/reports/RPT_fixture/view',search:'?page=2',hash:'#transactions',assign(url){redirected=url;}}};
  const context={window,document,setTimeout:()=>1};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/step-up.js'),'utf8').replace('  function requestVerification(action) {','  window.testVerification=requestVerification;\n  function requestVerification(action) {'),context);
  window.testVerification('FINANCE_EXPORT');await submit({preventDefault(){}});
  assert.equal(new URL(redirected,'https://app.voxelveda.com').searchParams.get('returnTo'),reportPath,'Expired step-up must return to the same report and page after login');
}
(async()=>{await viewerChecks();await builderPrintChecks();await stepUpExpiryCheck();console.log('FINANCE_REPORT_ACTIONS_TEST_OK: invalid/empty formats denied, complete HTML popup fallback, print listener ordering, attachment-body timeout, Safari-compatible timeout and login return identity.');})().catch(error=>{console.error(error);process.exitCode=1;});
