'use strict';

const assert=require('node:assert');
const fs=require('node:fs');

const source=fs.readFileSync('public/finance-advanced-control.js','utf8');
const start=source.indexOf('const SOURCES=[');
const end=source.indexOf('\nfunction currencies()',start);
assert(start>=0&&end>start,'Advanced loading implementation must remain testable.');

const harnessSource=source.slice(start,end)
  .replace('const ADVANCED_REQUEST_TIMEOUT_MS=12000;','const ADVANCED_REQUEST_TIMEOUT_MS=30;')
  .replace('const ADVANCED_LOAD_BUDGET_MS=15000;','const ADVANCED_LOAD_BUDGET_MS=55;');

function createHarness(fetchImpl){
  const root={innerHTML:''};
  const document={getElementById:id=>id==='financeAdvancedControlMount'?root:null};
  const render=()=>{render.calls+=1};render.calls=0;
  const prelude="const MOUNT_ID='financeAdvancedControlMount';const state={loading:false,data:{},errors:{},statuses:{},progress:{resolved:0,total:0}};";
  const factory=new Function('fetch','document','AbortController','setTimeout','clearTimeout','render',
    prelude+harnessSource+';return {state,SOURCES,load,retrySource,get renderCount(){return render.calls}};'
  );
  const harness=factory(fetchImpl,document,AbortController,setTimeout,clearTimeout,render);harness.root=root;return harness;
}

async function run(){
  let hang=true;
  const fetchImpl=(_url,options)=>{
    if(!hang)return Promise.resolve({ok:true,json:async()=>({verified:true})});
    return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true}));
  };
  const harness=createHarness(fetchImpl);
  const started=Date.now();
  await harness.load();
  const elapsed=Date.now()-started;

  assert(elapsed<500,'Advanced Control must stop a fully stalled source set at the module-wide load budget.');
  assert.strictEqual(harness.state.loading,false,'Advanced Control must leave loading state after the budget expires.');
  assert.strictEqual(harness.state.progress.resolved,harness.SOURCES.length,'Every unresolved source must end in an explicit error state.');
  assert(Object.values(harness.state.errors).every(Boolean),'Stalled sources must expose retryable errors.');

  hang=false;
  await harness.retrySource('personal');
  assert.strictEqual(harness.state.statuses.personal,'loaded','A failed Advanced source must be independently retryable.');
  assert.deepStrictEqual(harness.state.data.personal,{verified:true},'A successful source retry must replace only that source data.');

  hang=true;
  const retained=harness.state.data.personal;
  await harness.load();
  assert.strictEqual(harness.state.data.personal,retained,'Refresh must preserve the last usable source data while replacements are loading.');
  assert(harness.renderCount>0,'Refresh with existing data must keep rendering the current control picture.');

  console.log('FINANCE_ADVANCED_LOADING_RESILIENCE_OK');
}

run().catch(error=>{console.error(error);process.exitCode=1});
