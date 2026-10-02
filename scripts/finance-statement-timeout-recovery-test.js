'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const parser=require('../services/financeStatementParser');

(async()=>{
  let timeoutHookCalled=false;
  const started=Date.now();
  await assert.rejects(
    parser._test.withTimeout(
      new Promise(()=>{}),
      25,
      async()=>{timeoutHookCalled=true;},
      ()=>Object.assign(new Error('bounded timeout'),{code:'TEST_TIMEOUT'})
    ),
    error=>error&&error.code==='TEST_TIMEOUT'
  );
  assert(timeoutHookCalled,'timeout cleanup hook must run before rejecting');
  assert(Date.now()-started<2000,'timeout helper must settle promptly');

  const worker=fs.readFileSync(path.join(__dirname,'..','services','financeStatementIngestionWorker.js'),'utf8');
  const parserSource=fs.readFileSync(path.join(__dirname,'..','services','financeStatementParser.js'),'utf8');

  assert.match(parserSource,/FINANCE_OCR_TIMEOUT_MS/);
  assert.match(parserSource,/FINANCE_PDF_RENDER_TIMEOUT_MS/);
  assert.match(parserSource,/shutdownOcrWorker\(\)/);
  assert.match(parserSource,/renderTask\.cancel\(\)/);
  assert.match(worker,/OCR_TIMEOUT/);
  assert.match(worker,/PDF_RENDER_TIMEOUT/);
  assert.match(worker,/STALE_JOB_RECOVERY/);

  console.log('FINANCE_STATEMENT_TIMEOUT_RECOVERY_OK');
})().catch(error=>{
  console.error(error);
  process.exit(1);
});
