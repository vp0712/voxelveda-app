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
      if(sql.startsWith('SELECT id FROM finance_statement_import_jobs'))return [state.job?[state.job]:[]];
      if(sql.startsWith('INSERT INTO finance_statement_import_jobs')){
        if(state.failInsert)throw new Error('simulated queue failure');
        assert.equal(params[1],state.session.id);
        assert.equal(params.at(-1),1,'the authorised actor owns the resume request');
        state.job={id:11};
      }
      if(sql.startsWith('UPDATE finance_statement_import_jobs'))assert.ok(state.job,'a session cannot be queued without its durable worker job');
      if(sql.startsWith('UPDATE statement_import_sessions'))state.session.status='QUEUED';
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

    const client=fs.readFileSync(require.resolve('../public/finance-master.js'),'utf8');
    const start=client.indexOf('async function waitForStatementImport('),end=client.indexOf('async function openStatementWizard()',start);
    let attention,calls=0;
    const context={I:'/api/finance/intelligence',api:async()=>{calls++;return {import:{status:'EXTRACTING',current_stage:'EXTRACTING'},recovery_required:true}},num:Number,esc:String,
      renderStatementAttention:(_uid,record)=>{attention=record},statementDelay:()=>{throw new Error('Missing jobs must not poll forever')}};
    vm.createContext(context);vm.runInContext(client.slice(start,end),context);
    const outcome=await context.waitForStatementImport('anonymous-legacy',{});
    assert.equal(calls,1);assert.equal(outcome.status,'RECOVERY_REQUIRED');assert.equal(attention.status,'RECOVERY_REQUIRED');
    console.log('FINANCE_LEGACY_STATEMENT_RESUME_OK queue_creation, idempotency, terminal_states, rollback, source_guard, UI_recovery');
  }finally{
    pool.getConnection=saved.connection;pool.query=saved.query;worker.triggerFinanceStatementIngestion=saved.trigger;audit.logAudit=saved.audit;
    delete require.cache[require.resolve('../controllers/financeStatementIngestionController')];
  }
}
run().catch(error=>{console.error(error);process.exitCode=1});
