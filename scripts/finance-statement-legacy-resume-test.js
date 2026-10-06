'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const pool=require('../config/db');
const worker=require('../services/financeStatementIngestionWorker');
const audit=require('../services/auditService');

async function run(){
  const saved={connection:pool.getConnection,query:pool.query,trigger:worker.triggerFinanceStatementIngestion,audit:audit.logAudit};
  let state,queries,commits,rollbacks,triggers;
  const reset=(options={})=>{
    state={session:{id:7,import_uid:'anonymous-legacy',bank_account_id:3,status:'EXTRACTING',secure_document_id:'anonymous-original',content_hash:'a'.repeat(64),...options.session},job:options.job||null,active:options.active!==false,failInsert:options.failInsert};
    queries=[];commits=0;rollbacks=0;triggers=0;
  };
  const db={
    beginTransaction:async()=>{db.snapshot=structuredClone(state)},
    commit:async()=>{commits++},
    rollback:async()=>{state=db.snapshot;rollbacks++},
    release:()=>{},
    query:async(sql,params=[])=>{
      assert.equal((sql.match(/\?/g)||[]).length,params.length,'all recovery SQL binds its parameters');
      queries.push(sql);
      if(sql.startsWith('SELECT * FROM statement_import_sessions'))return [[{...state.session}]];
      if(sql.startsWith('SELECT id FROM bank_accounts'))return [state.active?[{id:3}]:[]];
      if(sql.startsWith('SELECT id,status,stage FROM finance_statement_import_jobs'))return [state.job?[state.job]:[]];
      if(sql.startsWith('INSERT INTO finance_statement_import_jobs')){
        if(state.failInsert)throw new Error('simulated queue failure');
        assert.equal(params[1],state.session.id);
        assert.equal(params.at(-1),1,'the authorised actor owns the resume request');
        state.job={id:11};
      }
      if(sql.startsWith('UPDATE finance_statement_import_jobs'))assert.ok(state.job,'a session cannot be queued without its durable worker job');
      if(sql.startsWith('UPDATE statement_import_sessions'))state.session.status=params.length===3?params[0]:'QUEUED';
      assert.ok(!/bank_transactions|DELETE FROM statement_import_rows/.test(sql),'resume cannot post money or delete review history');
      return [{affectedRows:1}];
    }
  };
  try{
    pool.getConnection=async()=>db;
    pool.query=async()=>{throw new Error('Resume must use its locked transaction')};
    worker.triggerFinanceStatementIngestion=async()=>{triggers++};
    audit.logAudit=async(_db,event)=>assert.equal(event.newValue.ledger_unchanged,true);
    delete require.cache[require.resolve('../controllers/financeStatementIngestionController')];
    const controller=require('../controllers/financeStatementIngestionController');
    const req={params:{uid:'anonymous-legacy'},user:{id:1},get:()=>undefined};
    const invoke=async()=>{
      const res={statusCode:200,status(code){this.statusCode=code;return this},json(body){this.body=body;return this}};
      await controller.retry(req,res);
      await new Promise(resolve=>setImmediate(resolve));
      return res;
    };
    reset();
    let result=await invoke();
    assert.equal(result.statusCode,202);
    assert.equal(state.session.status,'QUEUED');
    assert.ok(state.job);
    assert.equal(commits,1);assert.equal(rollbacks,0);assert.equal(triggers,1);
    assert.ok(queries.some(sql=>sql.includes('statement_import_sessions')&&sql.includes('FOR UPDATE')),'concurrent retries lock the same legacy session');
    assert.equal(queries.filter(sql=>sql.startsWith('INSERT INTO finance_statement_import_jobs')).length,1);
    queries=[];
    result=await invoke();
    assert.equal(result.statusCode,202);
    assert.ok(!queries.some(sql=>sql.startsWith('INSERT INTO finance_statement_import_jobs')),'repeat recovery reuses one job');
    for(const stage of ['VALID','NEEDS_REVIEW','NEEDS_MAPPING']){
      reset({job:{id:11,status:'COMPLETED',stage}});result=await invoke();
      assert.equal(result.statusCode,202);assert.equal(state.session.status,stage==='NEEDS_MAPPING'?'NEEDS_MAPPING':'PENDING_REVIEW');
      assert.equal(commits,1);assert.equal(triggers,0,'completed extraction must not run again and erase review corrections');
      assert.ok(!queries.some(sql=>/^(INSERT|UPDATE) (INTO )?finance_statement_import_jobs/.test(sql)));
    }

    for(const status of ['IMPORTED','CANCELLED','REVERSED','REMOVED']){
      reset({session:{status}});result=await invoke();
      assert.equal(result.statusCode,409);assert.equal(rollbacks,1);assert.equal(triggers,0);
      assert.ok(!queries.some(sql=>/^(UPDATE|INSERT)/.test(sql)),'terminal statements cannot be reactivated by retry');
    }
    reset({session:{secure_document_id:null}});result=await invoke();
    assert.equal(result.statusCode,422);assert.equal(state.session.status,'EXTRACTING');assert.equal(triggers,0);
    reset({active:false});result=await invoke();assert.equal(result.statusCode,409);assert.equal(triggers,0);
    reset({failInsert:true});result=await invoke();
    assert.equal(result.statusCode,500);assert.equal(state.session.status,'EXTRACTING');assert.equal(state.job,null);assert.equal(commits,0);assert.equal(rollbacks,1);assert.equal(triggers,0);

    const statusResponse=async(row)=>{
      pool.query=async()=>[[row]];
      const res={json(body){this.body=body;return this}};
      await controller.status(req,res);return res.body;
    };
    assert.equal((await statusResponse({status:'EXTRACTING'})).recovery_required,true);
    assert.equal((await statusResponse({status:'EXTRACTING',job_uuid:'existing-job'})).recovery_required,false);
    assert.equal((await statusResponse({status:'PENDING_REVIEW'})).recovery_required,false,'existing reviews are not re-read automatically');
    assert.equal((await statusResponse({status:'REMOVED'})).recovery_required,false);
    assert.equal((await statusResponse({status:'EXTRACTING',job_uuid:'existing-job',job_status:'COMPLETED'})).recovery_reason,'COMPLETED_JOB_STATUS');
    assert.equal((await statusResponse({status:'REJECTED',job_uuid:'existing-job',job_status:'COMPLETED'})).recovery_required,false,'intentional rejection is never restored as review automatically');
    for(const status of ['FAILED','DEAD_LETTER','NEEDS_PASSWORD','NEEDS_MAPPING']){
      const response=await statusResponse({status:'EXTRACTING',job_uuid:'existing-job',job_status:status});
      assert.equal(response.import.status,status,'durable job failures must be reachable from a stuck progress screen');
    }
    assert.equal((await statusResponse({status:'IMPORTED',job_uuid:'existing-job',job_status:'FAILED'})).import.status,'IMPORTED');

    const client=fs.readFileSync(require.resolve('../public/finance-master.js'),'utf8');
    const start=client.indexOf('async function waitForStatementImport('),end=client.indexOf('async function openStatementWizard()',start);
    let attention,calls=0;
    const context={I:'/api/finance/intelligence',api:async()=>{calls++;return {import:{status:'EXTRACTING',current_stage:'EXTRACTING'},recovery_required:true}},num:Number,esc:String,
      renderStatementAttention:(_uid,record)=>{attention=record},statementDelay:()=>{throw new Error('Missing jobs must not poll forever')}};
    vm.createContext(context);vm.runInContext(client.slice(start,end),context);
    const outcome=await context.waitForStatementImport('anonymous-legacy',{});
    assert.equal(calls,1);assert.equal(outcome.status,'RECOVERY_REQUIRED');assert.equal(attention.status,'RECOVERY_REQUIRED');
    context.api=async()=>({import:{status:'EXTRACTING'},recovery_required:true,recovery_reason:'COMPLETED_JOB_STATUS'});
    await context.waitForStatementImport('anonymous-legacy',{});
    assert.match(attention.last_error_summary,/existing review/);
    const workerSource=fs.readFileSync(require.resolve('../services/financeStatementIngestionWorker'),'utf8');
    const progressSource=workerSource.slice(workerSource.indexOf('async function progress('),workerSource.indexOf('async function persistResult('));
    let jobState={status:'PROCESSING',attempt:1},sessionState='EXTRACTING',releaseProgress;
    const progressGate=new Promise(resolve=>{releaseProgress=resolve});
    const progressContext={pool:{query:async(sql,params)=>{
      assert.equal((sql.match(/\?/g)||[]).length,params.length);
      if(sql.startsWith('UPDATE finance_statement_import_jobs')){assert.match(sql,/AND attempt=\?/);await progressGate;return [{affectedRows:0}]}
      assert.match(sql,/j.status='PROCESSING' AND j.attempt=\?/);
      assert.match(sql,/s.status NOT IN/);
      if(jobState.status==='PROCESSING'&&jobState.attempt===params.at(-1)&&!['IMPORTED','CANCELLED','REVERSED','REMOVED','PENDING_REVIEW','REJECTED'].includes(sessionState))sessionState=params[0];
      return [{affectedRows:1}];
    }}};
    vm.createContext(progressContext);vm.runInContext(progressSource,progressContext);
    const delayed=progressContext.progress({id:11,import_session_id:7,attempt:1},{stage:'EXTRACTING'});
    jobState.status='COMPLETED';sessionState='PENDING_REVIEW';releaseProgress();await delayed;
    assert.equal(sessionState,'PENDING_REVIEW','a delayed callback after completion cannot regress review to extracting');
    for(const status of ['IMPORTED','REMOVED','CANCELLED','REVERSED','REJECTED']){
      jobState={status:'PROCESSING',attempt:1};sessionState=status;
      await progressContext.progress({id:11,import_session_id:7,attempt:1},{stage:'EXTRACTING'});
      assert.equal(sessionState,status,'terminal session states survive late progress');
    }
    jobState={status:'PROCESSING',attempt:2};sessionState='QUEUED';
    await progressContext.progress({id:11,import_session_id:7,attempt:1},{stage:'EXTRACTING'});
    assert.equal(sessionState,'QUEUED','prior attempts cannot update the current extraction');
    const processSource=workerSource.slice(workerSource.indexOf('async function processClaimedJob('),workerSource.indexOf('async function processFinanceStatementQueueCycle('));
    let activeProgress=0,orderedStages=[];
    const processContext={progress:async(_job,event)=>{activeProgress++;await new Promise(resolve=>setImmediate(resolve));orderedStages.push(event.stage);activeProgress--},
      readDocumentBodyInternal:async()=>({contentSha256:'test-hash',body:Buffer.from('anonymous'),document:{mime_type:'text/csv'}}),
      parseStatementBuffer:async(_body,_file,_options,report)=>{report({stage:'EXTRACTING'});report({stage:'PARSING'});return {rows:[]}},
      evaluateStatement:()=>({}),persistResult:async()=>{assert.equal(activeProgress,0);return {status:'PENDING_REVIEW'}},failJob:async(_job,error)=>{throw error}};
    vm.createContext(processContext);vm.runInContext(processSource,processContext);
    await processContext.processClaimedJob({content_hash:'test-hash'});
    assert.deepEqual(orderedStages,['SECURITY_CHECKING','EXTRACTING','PARSING','VALIDATING','PERSISTING'],'parser progress settles in order before review is committed');
    console.log('FINANCE_LEGACY_STATEMENT_RESUME_OK queue_creation, idempotency, terminal_states, rollback, source_guard, UI_recovery, completed_review_recovery, late_progress_guards, progress_order');
  }finally{
    pool.getConnection=saved.connection;pool.query=saved.query;worker.triggerFinanceStatementIngestion=saved.trigger;audit.logAudit=saved.audit;
    delete require.cache[require.resolve('../controllers/financeStatementIngestionController')];
  }
}
run().catch(error=>{console.error(error);process.exitCode=1});
