'use strict';

const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');
const parser = require('../services/financeStatementParser');
const generic = require('../services/financeStatementAdapters/generic');
const { evaluateStatement } = require('../services/financeStatementValidation');
const ingestion = require('../controllers/statementImportController')._ingestion;
const { planSourceRepair } = require('../services/financeStatementSourceRepair');

// Anonymous generated fixture reproduces table geometry, not customer data.
function sourcePdf() {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({size:'A4',margin:25});
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(15).text('ANZ TRANSACTION REPORT AUD',25,35);
    doc.fontSize(10).text('3 June 2024 to 1 Oct 2024',25,60);
    doc.text('Branch Number (BSB)',25,90).text('Account Number',160,90).text('Balance as of 1 Oct 2024',385,90);
    doc.text('123456',25,110).text('000001234',160,110).text('$121.23',470,110);
    const header = y => {
      doc.text('Date',25,y).text('Transaction Details',110,y).text('Withdrawals',340,y).text('Deposits',470,y);
    };
    const row = (y,date,description,debit,credit) => {
      doc.text(date,25,y).text(description,110,y);
      if(debit) doc.text(debit,355,y);
      if(credit) doc.text(credit,475,y);
    };
    header(145);
    row(170,'30 SEP 2024','Refund',null,'$50.50');
    row(200,'24 SEP 2024','Repeated purchase','$12.50');
    row(230,'24 SEP 2024','Repeated purchase','$12.50');
    doc.addPage();
    doc.text('Account Number 000001234',25,45);
    header(75);
    row(100,'23 SEP 2024','TOTAL TOOLS purchase','$5.00');
    doc.text('Total',25,135).text('$30.00',355,135).text('$50.50',475,135);
    doc.end();
  });
}

async function run() {
  const parsed = await parser.parseStatementBuffer(await sourcePdf(),{originalName:'anonymous-report.pdf',mimeType:'application/pdf'},{currency:'AUD'});
  assert.equal(parsed.rows.length,4,'metadata dates, balance as of, account IDs and printed totals are not transactions');
  assert.equal(parsed.classification.document_type,'BANK_STATEMENT');
  assert.equal(parsed.classification.multiple_accounts,false,'repeated headers describe one account');
  assert.equal(parsed.classification.reported_balance_as_of,'121.23');
  assert.ok(parsed.rows.every(row => !row.force_rejected));
  const account={id:7,currency:'AUD',account_type:'BANK'};
  const verification = evaluateStatement({rows:parsed.rows,classification:parsed.classification,account});
  assert.equal(verification.totals.total_debits,'30.00');
  assert.equal(verification.totals.total_credits,'50.50');
  for(const key of ['PRINTED_TOTAL_DEBITS','PRINTED_TOTAL_CREDITS']) assert.equal(verification.validations.find(item=>item.check===key)?.status,'PASS');
  assert.equal(verification.reconciliationStatus,'INCOMPLETE','a balance-as-of report does not invent an opening balance');
  const absent = evaluateStatement({rows:parsed.rows.filter((_,index)=>index!==2),classification:parsed.classification,account});
  assert.equal(absent.validations.find(item=>item.check==='PRINTED_TOTAL_DEBITS').status,'FAIL');
  assert.equal(absent.reconciliationStatus,'MISMATCH','printed totals must fail even when opening balance is absent');

  const emptyDb={query:async()=>[[]]};
  const prepared=await ingestion.normalizeAndDedupe(emptyDb,account,parsed.rows,{contentHash:parsed.fileHash});
  assert.notEqual(prepared.normalized[1].row_hash,prepared.normalized[2].row_hash);
  assert.equal(prepared.counts.duplicate,0,'two physical purchases without a reference/balance remain two transactions');
  const originalHash=ingestion.statementRowHash(account.id,parsed.rows[1]);
  assert.equal(prepared.normalized[1].row_hash,originalHash,'first occurrence keeps existing ledger identity');
  const repeatDb={query:async(sql,params)=> sql.includes('SELECT row_hash FROM bank_transactions') ? [prepared.normalized.filter(row=>params.includes(row.row_hash)).map(row=>({row_hash:row.row_hash}))] : [[]]};
  const reimport=await ingestion.normalizeAndDedupe(repeatDb,account,parsed.rows);
  assert.equal(reimport.counts.duplicate,4,'same file/overlapping source occurrences cannot double-post');
  const strong={...parsed.rows[1],reference:'bank-unique-reference-1'};
  const strongPrepared=await ingestion.normalizeAndDedupe(emptyDb,account,[strong,strong]);
  assert.equal(strongPrepared.normalized[1].validation_status,'DUPLICATE');

  const ledger=prepared.normalized.filter((_,index)=>index!==2).map((row,index)=>({...row,id:index+1,statement_import_uid:'old-report',reconciliation_status:'UNRECONCILED',original_payload_json:row.raw_payload_json}));
  const artifact={id:99,transaction_date:'2024-10-01',description:'123456 000001234',debit:'121.23',credit:'0.00',running_balance:null,reconciliation_status:'UNRECONCILED',original_payload_json:JSON.stringify({source_snippet:'Branch Number Account Number Balance as of 1 Oct 2024 123456 000001234 $121.23'})};
  const damaged=[...ledger,artifact];
  const plan=planSourceRepair(account,parsed,damaged,damaged);
  assert.equal(plan.artifacts.length,1);
  assert.equal(plan.missing.length,1,'printed debit and credit totals prove a source occurrence was incorrectly collapsed');
  assert.equal(plan.missing[0].row_hash,prepared.normalized[2].row_hash);
  const withoutTotals=planSourceRepair(account,{...parsed,classification:{...parsed.classification,reported_totals:[]}},damaged,damaged);
  assert.equal(withoutTotals.missing.length,0,'unverified additional rows cannot change the ledger');
  assert.equal(withoutTotals.unverifiedMissing,1);
  const intentionalExclusion={...prepared.normalized[2],selected:0,validation_status:'VALID'};
  assert.equal(planSourceRepair(account,parsed,damaged,damaged,[intentionalExclusion]).missing.length,0,'an explicitly deselected transaction is not recovered automatically');
  const correctedArtifact={...artifact,manual_override:1};
  assert.equal(planSourceRepair(account,parsed,[...ledger,correctedArtifact],[...ledger,correctedArtifact]).artifacts.length,0,'manual corrections are never overwritten');
  const archived=prepared.normalized.map((row,index)=>({...row,id:index+1,archived_at:index===2?'2024-10-01':null}));
  assert.equal(planSourceRepair(account,parsed,archived,archived).missing.length,0,'intentional archive is never reactivated');
  const complete=[...archived,{...artifact,archived_at:'2024-10-01',reconciliation_status:'IGNORED'}];
  assert.equal(planSourceRepair(account,parsed,complete,complete).artifacts.length,0,'repeated verification is idempotent');
  const manuallyEdited=archived.map((row,index)=>({...row,archived_at:null,manual_override:index===1?1:0,reference:index===1?'user-added-reference':null,running_balance:index===1?'999.00':null,original_transaction_date:row.transaction_date,original_description:row.description,original_reference:null,original_debit:row.debit,original_credit:row.credit,original_running_balance:null}));
  assert.equal(planSourceRepair(account,parsed,manuallyEdited,manuallyEdited).missing.length,0,'null original reference/balance must stay null when current values were manually edited');

  const chronological=[
    {transaction_date:'2024-09-01',description:'Payment',debit:'10.00',credit:'0.00',running_balance:'90.00'},
    {transaction_date:'2024-09-02',description:'Receipt',debit:'0.00',credit:'25.00',running_balance:'115.00'},
    {transaction_date:'2024-09-02',description:'Payment',debit:'5.00',credit:'0.00',running_balance:'110.00'}
  ];
  const classification={opening_balance:'100.00',closing_balance:'110.00',classification_confidence:1};
  for(const rows of [chronological,[...chronological].reverse()]) {
    const check=evaluateStatement({rows,classification,account});
    assert.equal(check.reconciliationStatus,'BALANCED');
    assert.equal(check.validations.find(item=>item.check==='RUNNING_BALANCE_CONTINUITY').status,'PASS');
  }
  const wrongClose=evaluateStatement({rows:chronological,classification:{...classification,closing_balance:'111.00'},account});
  assert.equal(wrongClose.validations.find(item=>item.check==='CLOSING_BALANCE').status,'FAIL','commit must see the mismatch, not just a summary status');
  const dotted=generic.parseLines([{page:1,text:'29.02.2024 Shop 10.00 DR'},{page:1,text:'31.02.2024 Bad date 10.00 DR'}],{dateFormat:'DMY',currency:'AUD'});
  assert.equal(dotted[0].transaction_date,'2024-02-29');
  assert.equal(dotted[1].transaction_date,null,'impossible calendar dates must not silently roll over');
  assert.equal(dotted[1].force_rejected,true);

  // Exercise the transactional repair with the same anonymous source and a
  // recording database. Guard SQL arity and rollback as well as the pure plan.
  const pdf=await sourcePdf();
  const crypto=require('node:crypto');
  const file={id:4,import_uid:'old-report',bank_account_id:7,secure_document_id:5,content_hash:crypto.createHash('sha256').update(pdf).digest('hex'),source_format:'PDF',original_name:'anonymous-report.pdf',currency:'AUD',parse_status:'IMPORTED',uploaded_by:1};
  const reviews=prepared.normalized.map((row,index)=>({...row,id:20+index,selected:index===2?0:1,validation_status:index===2?'DUPLICATE':row.validation_status,final_posted_transaction_id:index===2?null:index+1}));
  const queries=[];
  let committed=0,rolledBack=0,released=0;
  const db={beginTransaction:async()=>{},commit:async()=>{committed++},rollback:async()=>{rolledBack++},release:()=>{released++},query:async(sql,params=[])=>{
    assert.equal((sql.match(/\?/g)||[]).length,params.length,'every SQL placeholder must have a bound value');
    if (sql.startsWith('UPDATE statement_import_rows') && sql.includes("review_status='POSTED'")) {
      assert.doesNotMatch(sql,/duplicate_status\s*=\s*NULL/i,'production duplicate_status is NOT NULL; recovering a duplicate must retain a concrete status');
      assert.match(sql,/duplicate_status\s*=\s*'NOT_DUPLICATE'/i,'a recovered source transaction is no longer an excluded duplicate');
    }
    queries.push(sql);
    if(sql.startsWith('SELECT * FROM bank_accounts'))return [[{...account,status:'ACTIVE',history_end_date:'2024-09-30'}]];
    if(sql.startsWith('SELECT * FROM statement_import_files'))return [[file]];
    if(sql.startsWith('SELECT * FROM statement_import_sessions'))return [[{id:13,created_by:1}]];
    if(sql.includes('FROM bank_transactions bt LEFT JOIN'))return [damaged.map(row=>({...row,statement_import_uid:file.import_uid,import_batch_uid:'original-batch'}))];
    if(sql.startsWith('SELECT * FROM statement_import_rows'))return [reviews];
    if(sql.startsWith('INSERT IGNORE INTO bank_transactions'))return [{affectedRows:1,insertId:101}];
    return [{affectedRows:1,insertId:500}];
  }};
  const pool=require('../config/db');
  const documentSecurity=require('../services/documentSecurityService');
  const auditService=require('../services/auditService'),auditEvents=[];
  const savedAudit=auditService.logAudit;
  auditService.logAudit=async(_db,event)=>{auditEvents.push(event)};
  const savedConnection=pool.getConnection, savedRead=documentSecurity.readDocumentBodyInternal;
  pool.getConnection=async()=>db;
  documentSecurity.readDocumentBodyInternal=async()=>({body:pdf,contentSha256:file.content_hash,document:{mime_type:'application/pdf'}});
  delete require.cache[require.resolve('../services/financeStatementSourceRepair')];
  const {verifyStoredStatement}=require('../services/financeStatementSourceRepair');
  try {
    const repaired=await verifyStoredStatement(file,{apply:true,actorId:1});
    assert.equal(repaired.archived,1);
    assert.equal(repaired.added,1);
    assert.equal(repaired.applied,true);
    assert.equal(committed,1);
    assert.ok(queries.some(sql=>sql.includes('pre_archive_reconciliation_status')),'artifact removal is reversible');
    assert.ok(queries.some(sql=>sql.startsWith('INSERT INTO bank_transaction_original_data')),'new rows retain immutable source evidence');
    assert.deepEqual(auditEvents.map(event=>event.action),['STATEMENT_SOURCE_ARTIFACT_ARCHIVED','STATEMENT_SOURCE_TRANSACTION_RECOVERED'],'both corrections have explicit audit events');
    assert.ok(auditEvents.every(event=>event.actorId===1&&event.newValue.source_file_hash===file.content_hash));
    db.query=async()=>{throw new Error('simulated database failure')};
    await assert.rejects(()=>verifyStoredStatement(file,{apply:true,actorId:1}),/simulated database failure/);
    assert.equal(rolledBack,1);
    assert.equal(released,2);
    const {attachOriginalSource}=require('../services/financeStatementOriginalRecovery');
    const sourceQueries=[];
    let legacySession={id:13,status:'IMPORTED',secure_document_id:null};
    let legacyFile={id:4,parse_status:'IMPORTED',secure_document_id:null};
    let activeAccount=true;
    const sourceDb={query:async(sql,params=[])=>{
      assert.equal((sql.match(/\?/g)||[]).length,params.length,'restoration SQL binds every value');
      sourceQueries.push({sql,params});
      if(sql.startsWith('SELECT id FROM bank_accounts'))return [activeAccount?[{id:7}]:[]];
      if(sql.startsWith('SELECT * FROM statement_import_sessions'))return [legacySession?[legacySession]:[]];
      if(sql.startsWith('SELECT * FROM statement_import_files'))return [legacyFile?[legacyFile]:[]];
      return [{affectedRows:1}];
    }};
    const restoration={accountId:7,importUid:file.import_uid,contentHash:file.content_hash,document:{id:'anonymous-original',content_sha256:file.content_hash},detection:{detectedMime:'application/pdf',sizeBytes:pdf.length},actor:{actorId:1}};
    const attached=await attachOriginalSource(sourceDb,restoration);
    assert.deepEqual(attached,{attached:true,queued:false,status:'IMPORTED'});
    assert.equal(sourceQueries.filter(item=>item.sql.startsWith('UPDATE statement_import_')).length,2,'both posted source links are restored under the same import identity');
    assert.ok(!sourceQueries.some(item=>/bank_transactions|INSERT INTO finance_statement_import_jobs/.test(item.sql)),'restoring a posted original cannot alter money or queue reposting');
    assert.equal(auditEvents.at(-1).action,'STATEMENT_ORIGINAL_RESTORED');
    assert.equal(auditEvents.at(-1).newValue.posted_transactions_unchanged,true);
    sourceQueries.length=0;
    legacyFile.secure_document_id='already-retained';
    assert.equal((await attachOriginalSource(sourceDb,restoration)).attached,false,'a concurrent existing original is never replaced');
    assert.ok(!sourceQueries.some(item=>item.sql.startsWith('UPDATE')));
    legacyFile=null;legacySession={id:13,status:'PENDING_REVIEW',secure_document_id:null};sourceQueries.length=0;
    const pending=await attachOriginalSource(sourceDb,restoration);
    assert.deepEqual(pending,{attached:true,queued:true,status:'QUEUED'});
    assert.ok(sourceQueries.some(item=>item.sql.includes('ON DUPLICATE KEY UPDATE')&&item.sql.includes('attempt=0')),'pending legacy sources obtain a resumable current-reader job');
    legacySession=null;legacyFile={id:4,parse_status:'IMPORTED',secure_document_id:null};
    assert.equal((await attachOriginalSource(sourceDb,restoration)).queued,false,'a posted file without review history restores its evidence without creating a new import');
    legacyFile=null;
    await assert.rejects(()=>attachOriginalSource(sourceDb,restoration),error=>error.code==='STATEMENT_CHANGED');
    activeAccount=false;
    await assert.rejects(()=>attachOriginalSource(sourceDb,restoration),error=>error.code==='BANK_ACCOUNT_NOT_ACTIVE');
    sourceQueries.length=0;
    await assert.rejects(()=>attachOriginalSource(sourceDb,{...restoration,document:{id:'wrong-original',content_sha256:'different'}}),error=>error.code==='STATEMENT_FILE_HASH_MISMATCH');
    assert.equal(sourceQueries.length,0,'wrong source bytes are rejected before any database action');
  } finally {pool.getConnection=savedConnection;documentSecurity.readDocumentBodyInternal=savedRead;auditService.logAudit=savedAudit}
  console.log('FINANCE_STATEMENT_SOURCE_EVIDENCE_OK metadata, columns, printed_totals, source_occurrences, overlapping_imports, reverse_balances, source_repairs, original_recovery, calendar');
}

run().catch(error=>{console.error(error);process.exitCode=1;});
