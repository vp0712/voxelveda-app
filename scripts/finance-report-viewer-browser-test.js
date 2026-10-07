'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

async function run(){
  const href='/api/finance/reports/snapshots/RPT_fixture/download/html';
  const events={},attrs={href},calls=[];
  const feedback={textContent:'',setAttribute(){}};
  const link={href:'https://app.voxelveda.com'+href,getAttribute:k=>attrs[k],setAttribute:(k,v)=>attrs[k]=v,removeAttribute:k=>delete attrs[k],addEventListener:(k,fn)=>events[k]=fn};
  const fields={value:'',disabled:false,textContent:'',focus(){}};
  let verified=false,savedName=null,verificationShown=false;
  const form={addEventListener:(event,fn)=>{if(event==='submit')Promise.resolve().then(()=>fn({preventDefault(){}}));},removeEventListener(){}};
  const cancel={addEventListener(){},removeEventListener(){}};
  const selectors={'#stepUpForm':form,'#stepUpPassword':{...fields,value:'fixture'},'#stepUpCode':{...fields,value:'123456'},'#stepUpStatus':{...fields},'.step-up-confirm':{...fields},'#stepUpAction':{...fields},'.step-up-cancel':cancel};
  const dialog={hidden:true,querySelector:selector=>selectors[selector]};
  const document={
    getElementById:id=>id==='vrFeedback'?feedback:id==='stepUpDialog'?(verificationShown=true,dialog):null,
    querySelectorAll:selector=>selector==='[data-report-download]'?[link]:[],
    querySelector:()=>null,addEventListener(){},
    createElement:()=>({remove(){},click(){savedName=this.download;}}),body:{appendChild(){}}
  };
  const nativeFetch=async(input)=>{calls.push(input);if(input==='/api/auth/step-up'){verified=true;return new Response('{}',{status:200});}assert.equal(input,href,'download must use the same-origin path recognised by step-up.js');if(!verified)return new Response(JSON.stringify({code:'STEP_UP_REQUIRED',action:'FINANCE_EXPORT'}),{status:403});return new Response('<!doctype html><p>Snapshot rows</p>',{headers:{'Content-Type':'text/html; charset=utf-8','Content-Disposition':'attachment; filename="Voxel-Veda-Register-2026-09-30-to-2026-10-06.html"'}});};
  const url=class extends URL{static createObjectURL(){return 'blob:fixture';}static revokeObjectURL(){}};
  const context={window:{fetch:nativeFetch},document,URL:url,AbortController,Response,FormData,setTimeout:()=>1,clearTimeout(){},location:{assign(){throw new Error('Unexpected login redirect');}}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../public/step-up.js'),'utf8'),context);
  context.fetch=(...args)=>context.window.fetch(...args);
  vm.runInContext(fs.readFileSync(require.resolve('../public/report-viewer.js'),'utf8'),context);
  await events.click({preventDefault(){}});
  assert(verificationShown&&verified,'download must show and complete existing security verification');
  assert.deepEqual(calls,[href,'/api/auth/step-up',href]);
  assert(savedName.endsWith('.html'));assert.match(feedback.textContent,/HTML download ready/);assert(!attrs['aria-busy']);
  console.log('FINANCE_REPORT_VIEWER_BROWSER_TEST_OK: protected HTML download prompts step-up, retries same saved report, validates format and meaningful filename.');
}
run().catch(error=>{console.error(error);process.exitCode=1});

