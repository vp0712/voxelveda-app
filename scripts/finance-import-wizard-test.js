'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const assert=(ok,message)=>{if(!ok)throw new Error(message)};

const client=read('public/finance-master.js');
const css=read('public/finance-master.css');
const html=read('public/finance-intelligence.html');

assert(html.includes('/finance-master.js'),'canonical Finance OS client must be loaded');
assert(client.includes('function openStatementWizard()'),'single-file statement import workflow is missing');
assert(client.includes('function openHistoricalImport('),'multi-file historical import workflow is missing');
assert(client.includes('accept=".csv,.pdf,.png,.jpg,.jpeg,.ofx,.qfx,.qif,.xlsx"'),'supported statement formats must remain explicit');
assert(client.includes('multiple required'),'historical import must allow multiple files for one selected account');
assert(client.includes('uploadStatementFile')&&client.includes("body.append('file',file,file.name)"),'wizard must upload original bytes as multipart data');
assert(client.includes('/statement-imports`')&&client.includes('/status`'),'wizard must use durable ingestion and status endpoints');
assert(client.includes('NEEDS_PASSWORD')&&client.includes('NEEDS_MAPPING'),'wizard must support actionable intervention states');
assert(client.includes('openStatementReview'),'completed extraction must open explicit review');
assert(client.includes("const isDuplicate=row.validation_status==='DUPLICATE'")&&client.includes('data-review-override'),'duplicate/rejected rows must remain locked behind controlled review actions');
assert(client.includes('data-review-commit')&&client.includes('data-review-reject'),'review decision actions are missing');
assert(client.includes('No transaction reaches the ledger until review and approval.'),'single-file non-posting safety copy is missing');
assert(client.includes('Nothing is committed automatically.'),'multi-file non-posting safety copy is missing');
assert(client.includes('No imported row enters the canonical ledger until you review and commit it.'),'historical import safety explanation is missing');
assert(client.includes('fm-import-queue'),'multi-file import progress queue is missing');
assert(css.includes('.fm-import-queue')&&css.includes('.fm-ingestion-progress'),'ingestion progress styling is missing');
assert(css.includes('@media(max-width:700px)'),'Finance OS must include mobile layout rules');
assert(css.includes('.fm-table-wrap')&&css.includes('overflow:auto'),'compact review tables must remain horizontally usable');
assert(!html.includes('finance-bank-app-v3')&&!html.includes('premium-banking-app'),'retired Finance apps must stay removed');

assert(client.includes('function stageStatementFiles('),'multi-file statement processing must use the shared stable batch verifier');
assert(client.includes('name="files" type="file"')&&client.includes('multiple required'),'standard Statement Import must support multiple selected files/PDFs');
assert(client.includes('Promise.all(workers)')&&client.includes('Every selected file is queued to private storage first'),'multi-file selections must enqueue all accepted files before waiting for extraction');
assert(client.includes('duplicate(s) excluded'),'batch import must report duplicate exclusions to the user');
assert(client.includes('showFinancePopup'),'batch extraction/verification must finish with a centred result popup');
assert(client.includes('excluded from import, totals, screens and reports')||client.includes('blocked before they can enter Finance calculations'),'duplicate policy must be visible in the import UI');
assert(client.includes('waitForStatementImport')&&client.includes('DEAD_LETTER'),'batch import must surface durable job progress and safe terminal states');
assert(client.includes("['REMOVED','REVERSED','CANCELLED']")&&client.includes('function statementEntries()')&&client.includes('function statementFolderBody()'),'removed imports must stay out of the active statement folders while active batches remain accessible');
const vm=require('node:vm');
const folders=client.slice(client.indexOf('function statementEntries()'),client.indexOf('function statements(){'));
const folderState={scope:'ALL',account:'',statementBank:'',statementAccount:'',statementQuery:'',statementStatus:'ALL',accounts:[{id:1,institution:'ANZ',market_code:'AU',nickname:'Everyday',currency:'AUD'}],reviews:[{import_uid:'removed',bank_account_id:1,status:'REMOVED'},{import_uid:'pending',bank_account_id:1,status:'PENDING_REVIEW',original_name:'Waiting.pdf',ownership_scope:'PERSONAL'}],statements:Array.from({length:130},(_,index)=>({import_uid:'file-'+index,bank_account_id:1,original_name:'Archive-'+index+'.pdf',ownership_scope:'PERSONAL'}))};
const folderContext={state:folderState,num:value=>Number(value||0),esc:value=>String(value??''),date:()=>'',statusBadge:()=>'',emptyState:()=>''};
vm.createContext(folderContext);
vm.runInContext(folders+';this.entries=statementEntries;this.folderBody=statementFolderBody;',folderContext);
assert(folderContext.entries().length===131,'all active originals and pending reviews must remain accessible beyond the previous 25-file cutoff');
assert(!folderContext.folderBody().includes('Archive-0.pdf'),'root should display bank folders, not a flat file list');
folderState.statementBank='AU|anz';
assert(folderContext.folderBody().includes('Everyday')&&!folderContext.folderBody().includes('Archive-0.pdf'),'bank folder should open account folders');
folderState.statementAccount='1';
assert(folderContext.folderBody().includes('Archive-129.pdf')&&folderContext.folderBody().includes('Waiting.pdf'),'account folder must contain posted files and pending reviews');
folderState.statementQuery='Archive-129';
assert(folderContext.folderBody().includes('Archive-129.pdf')&&!folderContext.folderBody().includes('Waiting.pdf'),'folder search must find the matching file');
folderState.statementQuery='';folderState.statementStatus='PENDING_REVIEW';
assert(folderContext.folderBody().includes('Waiting.pdf')&&!folderContext.folderBody().includes('Archive-0.pdf'),'status filter should isolate pending files');
folderState.scope='BUSINESS';
assert(folderContext.entries().length===0,'workspace scope must apply to pending as well as posted statement folders');
const ingestion=read('controllers/financeStatementIngestionController.js');
assert(ingestion.includes('reused: true')&&ingestion.includes("parse_status<>'REMOVED'"),'exact re-uploads must reuse an active import instead of failing a multi-file batch');
const generic=require('../services/financeStatementAdapters/generic');
assert(
  generic.normaliseDate('25 May',{statementStartDate:'2026-05-01',statementEndDate:'2026-05-31'}).value==='2026-05-25',
  'PDF bank rows with day/month only must inherit the verified statement year'
);
const inferred=generic.parseLines([
  {page:1,text:'26 May WOOLWORTHS MELBOURNE',words:[]},
  {page:1,text:'20.00 970.00',words:[]},
  {page:1,text:'25 May COLES MELBOURNE 10.00 990.00',words:[]},
  {page:1,text:'24 May OPENING ACTIVITY 100.00 1000.00',words:[]}
],{statementStartDate:'2026-05-01',statementEndDate:'2026-05-31',currency:'AUD',allowUnsignedAmounts:false});
assert(inferred.length>=3,'split PDF transaction rows must be assembled into logical rows');
assert(inferred[0].debit==='20.00'&&inferred[0].credit==='0.00','unsigned PDF amount must infer debit only when running-balance movement proves it');
assert(inferred[1].debit==='10.00'&&inferred[1].credit==='0.00','running-balance inference must work across consecutive descending statement rows');

const parser=require('../services/financeStatementParser');
const anzClassification=parser.classify(
  'ANZ ACCESS ADVANTAGE 28 January 2025 to 27 February 2025 Date Transaction Details Withdrawals Deposits Balance',
  {pageCount:2,selectableText:true}
);
assert(anzClassification.statement_start_date==='2025-01-28'&&anzClassification.statement_end_date==='2025-02-27','ANZ standalone statement ranges must be detected for short transaction dates');

const anzRows=generic.parseLines([
  {page:1,text:'27 JAN OPENING BALANCE 1,000.00',words:[]},
  {page:1,text:'28 JAN WOOLWORTHS 50.00 950.00',words:[]},
  {page:1,text:'29 JAN SALARY 100.00 1,050.00',words:[]}
],{statementStartDate:'2025-01-27',statementEndDate:'2025-02-27',currency:'AUD',allowUnsignedAmounts:false});
assert(anzRows.length===3,'ANZ opening balance and transaction rows must remain available to the parser');
assert(anzRows[0].running_balance==='1000.00'&&anzRows[0].force_rejected===true,'opening balance must be retained as balance context but never imported as a transaction');
assert(anzRows[1].debit==='50.00'&&anzRows[1].credit==='0.00'&&!anzRows[1].force_rejected,'first ANZ transaction after opening balance must infer debit from exact running-balance movement');
assert(anzRows[2].credit==='100.00'&&anzRows[2].debit==='0.00'&&!anzRows[2].force_rejected,'ANZ credit direction must infer from exact running-balance movement');

const statementController=read('controllers/statementImportController.js');
const intelligenceController=read('controllers/financeIntelligenceController.js');
assert(statementController.includes("COALESCE(NULLIF(sd.original_name,''),s.original_name) AS original_name"),'active import list must prefer the original secure upload filename');
assert(intelligenceController.includes("COALESCE(NULLIF(sis.original_name,''),NULLIF(sd.original_name,''),sif.original_name) AS original_name"),'Statement Vault must recover the original user-facing filename when available');
assert(client.includes("const allRejectedPdf=status==='PENDING_REVIEW'")&&client.includes("num(row.rejected_rows)>=num(row.total_rows)"),'all-rejected PDF reviews must receive one safe parser-upgrade retry');

const ingestionController=read('controllers/financeStatementIngestionController.js');
assert(ingestionController.includes("fields.push('attempt=0', 'completed_at=NULL')"),'explicit retry must reset exhausted failed/dead-letter attempts');
assert(client.includes("STATEMENT_PARSER_RECOVERY_VERSION='20261002-anz-pdf-v2'")&&client.includes("PDF_NO_SAFE_TRANSACTIONS")&&client.includes("OCR_NO_SAFE_TRANSACTIONS"),'legacy parser failures must receive one versioned automatic recovery retry');
assert(client.includes("localStorage.setItem(key,new Date().toISOString())"),'automatic parser recovery must be loop-protected per import and parser version');

console.log('Unified secure Finance statement import and historical migration checks passed.');
