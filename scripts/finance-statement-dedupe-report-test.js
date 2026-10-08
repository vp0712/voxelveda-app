'use strict';

const assert=require('node:assert');
const fs=require('node:fs');
const path=require('node:path');

const statementReview=require('../controllers/statementImportController');
const { buildFinancePdfArtifact }=require('../services/financeReportPdfService');
const { relayAttachments }=require('../services/emailService');

function transaction(overrides){
  return {
    transaction_date:'2026-09-01',
    description:'WOOLWORTHS 1234',
    merchant_name:'Woolworths',
    reference:'OSKO REF 998877',
    debit:'42.50',
    credit:'0.00',
    running_balance:'1250.10',
    ...overrides
  };
}

async function main(){
  const semantic=statementReview._ingestion.semanticTransactionKey;
  assert.equal(typeof semantic,'function','semantic transaction key must be exported for regression coverage');

  const a=semantic(7,transaction({description:'Woolworths   1234'}));
  const same=semantic(7,transaction({description:'WOOLWORTHS-1234',running_balance:'1250.10'}));
  assert.equal(a,same,'same date, amount, place/reference and running balance must dedupe across overlapping statements');

  const differentBalance=semantic(7,transaction({description:'WOOLWORTHS-1234',running_balance:'999.99'}));
  assert.notEqual(a,differentBalance,'different running balances must protect legitimate same-day/same-reference activity from false dedupe');

  const differentReference=semantic(7,transaction({reference:'OSKO REF 112233'}));
  assert.notEqual(a,differentReference,'different stable references must not be collapsed');

  const noStrongIdentity=semantic(7,transaction({reference:'',running_balance:null}));
  assert.equal(noStrongIdentity,null,'same-day/same-amount activity without place/reference plus balance context must not be auto-collapsed');

  const explicitCategory=statementReview._ingestion.autoStatementCategory({category:'Bank supplied category',description:'WOOLWORTHS'});
  assert.equal(explicitCategory,'Bank supplied category','an explicit source-statement category must be preserved instead of overwritten by auto-classification');

  const report={
    metadata:{
      scope:'ALL',
      from:'2026-09-01',
      to:'2026-09-30',
      source_transaction_count:2
    },
    summary_by_currency:[{
      currency:'AUD',
      money_in:'1000.00',
      money_out:'142.50',
      net_cash_flow:'857.50'
    }],
    categories:[
      {currency:'AUD',category:'Groceries',source_transaction_count:1,spent:'42.50'},
      {currency:'AUD',category:'Fuel & Vehicle',source_transaction_count:1,spent:'100.00'}
    ],
    transactions:[
      {
        transaction_date:'2026-09-01',
        account_name:'Everyday',
        description:'WOOLWORTHS 1234',
        reference:'OSKO REF 998877',
        category:'Groceries',
        debit:'42.50',
        credit:'0.00',
        currency:'AUD'
      },
      {
        transaction_date:'2026-09-02',
        account_name:'Everyday',
        description:'AMPOL SERVICE STATION',
        reference:'CARD 554433',
        category:'Fuel & Vehicle',
        debit:'100.00',
        credit:'0.00',
        currency:'AUD'
      }
    ]
  };
  const profile={
    tradingName:'Voxel Veda',
    legalName:'Voxel Veda Pty Ltd',
    email:'info@voxelveda.com',
    website:'https://voxelveda.com',
    footer:'Confidential Financial Information'
  };
  const artifact=await buildFinancePdfArtifact(report,profile,'Transaction Register');
  assert(Buffer.isBuffer(artifact.buffer),'PDF renderer must return a Buffer');
  assert(artifact.buffer.length>1500,'generated PDF must contain a substantive report');
  assert.equal(artifact.buffer.subarray(0,4).toString(),'%PDF','generated artifact must be a PDF');
  assert(/\.pdf$/i.test(artifact.filename),'generated artifact must have a PDF filename');

  const routes=fs.readFileSync(path.join(__dirname,'..','routes','financeRoutes.js'),'utf8');
  assert(routes.includes("/reports/builder/email-pdf"),'secure PDF email route must exist');

  const ui=fs.readFileSync(path.join(__dirname,'..','public','finance-master.js'),'utf8');
  assert(ui.includes('reportEmailPdf'),'Finance report UI must expose Email PDF');
  assert(ui.includes('Description, Reference and Category columns'),'Finance report UI must explain separated audit columns');

  for(const content of [artifact.buffer,JSON.parse(JSON.stringify(artifact.buffer))]){
    const attachments=await relayAttachments([{filename:artifact.filename,content,contentType:'application/pdf',contentDisposition:'attachment'}]);
    assert.equal(attachments.length,1,'email relay must preserve the in-memory PDF attachment');
    assert.equal(attachments[0].filename,artifact.filename,'relay must preserve the meaningful PDF filename');
    assert.equal(attachments[0].contentType,'application/pdf');
    assert.equal(attachments[0].contentDisposition,'attachment');
    assert.equal(attachments[0].byte_length,artifact.buffer.length);
    assert.deepEqual(Buffer.from(attachments[0].content,'base64'),artifact.buffer,'relay JSON/base64 boundaries must preserve every PDF byte');
  }

  console.log('FINANCE_STATEMENT_DEDUPE_REPORT_TEST_OK');
}

main().catch(function(error){
  console.error(error);
  process.exit(1);
});
