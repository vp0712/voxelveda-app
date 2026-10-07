'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const nodemailer=require('nodemailer');
const ExcelJS=require('exceljs');
const vm=require('node:vm');
process.env.NODE_ENV='test';
process.env.FINANCE_ENCRYPTION_KEY=crypto.randomBytes(32).toString('hex');
process.env.PUBLIC_APP_URL='https://app.voxelveda.com';
delete process.env.FINANCE_REPORT_PUBLIC_BASE_URL;

const rows=new Map(),chunks=new Map();
const account={id:42,created_by:17,ownership_scope:'BUSINESS'};
const pool=require('../config/db');
async function query(sql,p=[]){
  if(sql.includes('INSERT INTO finance_report_snapshots')){
    const keys=['report_uid','created_by','report_type','workspace_scope','metadata_json','filters_json','accounts_json','summary_json','snapshot_sha256','snapshot_bytes','snapshot_chunks'];
    rows.set(p[0],{...Object.fromEntries(keys.map((key,i)=>[key,p[i]])),pdf_status:'NOT_GENERATED',created_at:new Date(),expires_at:null,revoked_at:null});return [{affectedRows:1}];
  }
  if(sql.includes('INSERT INTO finance_report_snapshot_chunks')){chunks.set(p.slice(0,3).join('|'),{report_uid:p[0],artifact_kind:p[1],chunk_index:p[2],content:Buffer.from(p[3])});return [{affectedRows:1}];}
  if(sql.includes('SELECT chunk_index,content'))return [[...chunks.values()].filter(r=>r.report_uid===p[0]&&r.artifact_kind===p[1]).sort((a,b)=>a.chunk_index-b.chunk_index)];
  if(sql.includes('SELECT * FROM bank_accounts'))return [[p[0]===42?account:undefined].filter(Boolean)];
  if(sql.includes('SELECT * FROM finance_report_snapshots')){const row=rows.get(p[0]);return [[row&&row.created_by===p[1]?{...row}:undefined].filter(Boolean)];}
  if(sql.includes('SELECT report_uid FROM finance_report_snapshots'))return [[rows.get(p[0])].filter(Boolean)];
  if(sql.includes('DELETE FROM finance_report_snapshot_chunks')){for(const [key,value] of chunks)if(value.report_uid===p[0]&&value.artifact_kind==='PDF')chunks.delete(key);return [{affectedRows:1}];}
  if(sql.includes("SET pdf_status='READY'")){Object.assign(rows.get(p[1]),{pdf_status:'READY',pdf_metadata_json:p[0]});return [{affectedRows:1}];}
  if(sql.includes("SET pdf_status='UNAVAILABLE'")){const row=rows.get(p[1]);if(row.pdf_status!=='READY')Object.assign(row,{pdf_status:'UNAVAILABLE',pdf_metadata_json:p[0]});return [{affectedRows:1}];}
  if(sql.includes('SET email_outcome_json')){rows.get(p[1]).email_outcome_json=p[0];return [{affectedRows:1}];}
  if(sql.includes('SET revoked_at')){rows.get(p[0]).revoked_at=new Date();return [{affectedRows:1}];}
  throw new Error('Unexpected fixture query: '+sql);
}
pool.query=query;pool.getConnection=async()=>({query,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}});
const audit=require('../services/auditService');audit.logAudit=async()=>{};
const email=require('../services/emailService'),actualSendMail=email.sendMail;
let sent;
email.sendMail=async message=>{sent=message;return {accepted:[message.to],transport:'test_mime',messageId:'fixture-provider-id'}};
const pdf=require('../services/financeReportPdfService'),actualBuildPdf=pdf.buildFinancePdfArtifact;
let failPdf=false;
pdf.buildFinancePdfArtifact=(...args)=>{if(failPdf)throw new Error('Forced renderer failure');return actualBuildPdf(...args)};
const controller=require('../controllers/financeReportBuilderController');
const html=require('../services/financeReportHtmlService');
const {validateReportPdf}=require('../services/financePdfValidationService');
let snapshots=require('../services/financeReportSnapshotService');
const owner={user:{id:17,role:'admin',permissions:['VIEW_FINANCE','EXPORT_FINANCIAL_DATA']},bankingAccessScope:{has_explicit_grants:true,allowed_business_account_ids:[42]},get:()=>null};
function fixture(count=105){return {
  metadata:{report_id:'RPT_TEST',report_version:3,report_type:'TRANSACTION_REGISTER',scope:'BUSINESS',account_ids:[42],from:'2026-09-30',to:'2026-10-06',currency:'AUD',transaction_type:null,generated_at:'2026-10-07T12:00:00.000Z',generated_by:17,source_transaction_count:count,currency_treatment:'Native currencies remain separate.',history_completeness:'COMPLETE',history_completeness_note:'Selected account history covers the requested period.'},
  transactions:Array.from({length:count},(_,i)=>({id:i+1,bank_account_id:42,transaction_date:'2026-10-01',posting_date:'2026-10-02',account_name:'Operating',institution:'CBA',description:'Record-'+String(i).padStart(3,'0')+' printer paper',merchant_name:'Officeworks',reference:'INV-'+i,category:'Office Supplies',ownership_scope:'BUSINESS',currency:'AUD',debit:'123.45',credit:'0.00',running_balance:100000-(i+1)*123.45,is_internal_transfer:0,source_type:'STATEMENT_IMPORT',reconciliation_status:'RECONCILED',has_receipt:1})),
  summary_by_currency:count?[{currency:'AUD',source_transaction_count:count,money_in:'0.00',ordinary_money_in:'0.00',linked_refund_inflow:'0.00',money_out:(count*123.45).toFixed(2),net_cash_flow:(-count*123.45).toFixed(2),net_economic_expense:(count*123.45).toFixed(2),transfer_movement:'0.00',cash_in:'0.00',cash_out:'0.00',unclassified:0}]:[],
  categories:count?[{currency:'AUD',category:'Office Supplies',source_transaction_count:count,split_line_count:0,spent:(count*123.45).toFixed(2)}]:[],merchants:[],monthly:[],gst_summary:[],reimbursements:[],reconciliation_summary:{RECONCILED:count},data_quality:{},
  coverage:{accounts:[{account_id:42,account_name:'Operating',currency:'AUD',status:'COMPLETE',history_start:'2026-01-01',history_end:'2026-10-06',last_statement_date:'2026-10-06'}]}};}
const profile={legalName:'Voxel Veda Pty Ltd',tradingName:'Voxel Veda',email:'info@voxelveda.com',website:'voxelveda.com',footer:'Confidential Financial Information',logo_data_uri:html.originalLogoData()};
function response(){return {statusCode:200,status(value){this.statusCode=value;return this},json(value){this.body=value;return this},set(){return this},type(){return this},send(value){this.body=value;return this}};}
async function run(){
  const original=fixture(),saved=await snapshots.capture(owner,original,profile),id=saved.report.metadata.report_id;
  assert.equal(saved.row.pdf_status,'NOT_GENERATED');assert(saved.view_url.startsWith('https://app.voxelveda.com/finance/reports/'));
  const pageAuth=require('../middleware/pageAuth');let loginLocation;
  const returnPath=snapshots.reportPath(id)+'?page=2';
  await pageAuth()({headers:{},query:{},hostname:'app.voxelveda.com',originalUrl:returnPath},{clearCookie(){},redirect(code,url){assert.equal(code,302);loginLocation=url}},()=>assert.fail('Unauthenticated page cannot proceed'));
  assert.equal(new URL(loginLocation,'https://app.voxelveda.com').searchParams.get('returnTo'),returnPath,'normal navigation preserves exact report identity and page through login');
  const master=fs.readFileSync(path.join(__dirname,'..','public','finance-master.js'),'utf8');
  const dateCode=master.slice(master.indexOf('function isoDay('),master.indexOf('function filterQuery('));
  const savedTimezone=process.env.TZ;process.env.TZ='Australia/Melbourne';
  class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-10-07T02:00:00Z']))}}
  const dateContext={Date:FixedDate,state:{period:'month',setup:{}}};vm.runInNewContext(dateCode+'\nthis.range=dateRange();',dateContext);
  assert.equal(dateContext.range.from,'2026-10-01');assert.equal(dateContext.range.to,'2026-10-07','local calendar dates cannot shift backwards at Australian midnight');
  if(savedTimezone===undefined)delete process.env.TZ;else process.env.TZ=savedTimezone;
  original.transactions[0].debit='99999';original.summary_by_currency[0].money_out='99999';
  delete require.cache[require.resolve('../services/financeReportSnapshotService')];snapshots=require('../services/financeReportSnapshotService');
  const loaded=await snapshots.load(owner,id);assert.equal(loaded.report.transactions[0].debit,'123.45','restart reload uses saved bytes, not rerun data');
  assert(![...chunks.values()][0].content.includes(Buffer.from('printer paper')),'financial snapshot contents must be encrypted');
  await assert.rejects(()=>snapshots.load({...owner,user:{id:18,role:'admin'}},id),e=>e.code==='REPORT_UNAVAILABLE');
  await assert.rejects(()=>snapshots.load({...owner,bankingAccessScope:{has_explicit_grants:true,allowed_business_account_ids:[]}},id),e=>e.code==='BANK_ACCOUNT_NOT_FOUND');
  const row=rows.get(id);row.expires_at=new Date(Date.now()-1000);await assert.rejects(()=>snapshots.load(owner,id),e=>e.code==='REPORT_EXPIRED');row.expires_at=null;
  const paged1=html.reportContent(loaded,{query:{page:'1'}}),paged2=html.reportContent(loaded,{query:{page:'2'}}),full=html.standaloneHtml(loaded);
  assert(paged1.includes('Record-099')&&!paged1.includes('Record-100'));assert(paged2.includes('Record-100')&&paged2.includes('Record-104'));
  assert(paged1.includes('Rows 1–100 of 105')&&paged2.includes('Rows 101–105 of 105'));assert(full.includes('Record-104'));
  assert(!/<script|<iframe|<canvas|src="https?:\/\//i.test(full),'download HTML has no external dependencies or plugin reader');
  const malicious=structuredClone(loaded);malicious.report.transactions[0].description='<img src=x onerror=alert(1)>';
  assert(html.standaloneHtml(malicious).includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert(!html.standaloneHtml(malicious).includes('<img src=x'));
  const sameNamedAccounts=structuredClone(loaded);
  sameNamedAccounts.report.metadata.account_ids=[];
  sameNamedAccounts.report.coverage.accounts=[{account_id:42,account_name:'Viral',institution:'ANZ',currency:'AUD'},{account_id:43,account_name:'Viral',institution:'Commonwealth Bank',currency:'AUD'}];
  sameNamedAccounts.report.transactions=[];
  assert(html.standaloneHtml(sameNamedAccounts).includes('Viral · ANZ · AUD; Viral · Commonwealth Bank · AUD'),'same-named accounts remain identifiable in saved scope');
  sameNamedAccounts.report.metadata.account_ids=[42];
  assert(!html.standaloneHtml(sameNamedAccounts).includes('Commonwealth Bank'),'account labels retain selected scope');
  const artifact=await controller._test.ensureSnapshotPdf(loaded);assert(artifact&&artifact.buffer.length>5000);
  const validation=await validateReportPdf(artifact,loaded.report);assert(validation.pages>1);
  assert.deepEqual(await snapshots.pdfBytes(await snapshots.authorise(owner,id)),artifact.buffer);
  const unrelated=structuredClone(loaded.report);unrelated.transactions[0].description='Missing expected record';await assert.rejects(()=>validateReportPdf(artifact,unrelated),e=>e.code==='PDF_CONTENT_INVALID');
  await assert.rejects(()=>validateReportPdf({buffer:Buffer.from('%PDF-'+'.'.repeat(200)),filename:'fake.pdf'},loaded.report));
  const dataset=controller._test.csvDataset(loaded.report);assert.equal(dataset.rows.length,105);
  assert.equal(dataset.rows.reduce((sum,r)=>sum+Number(r[dataset.header.indexOf('Debit')]||0),0).toFixed(2),(105*123.45).toFixed(2));
  const workbook=await controller._test.createReportWorkbook(loaded.report,loaded.profile,'Transaction Register');
  const xlsxBytes=await workbook.xlsx.writeBuffer(),xlsx=new ExcelJS.Workbook();await xlsx.xlsx.load(xlsxBytes);
  const tx=xlsx.getWorksheet('Transactions');assert.equal(tx.rowCount-11,105);
  let debit=0;for(let r=12;r<=tx.rowCount;r++)debit+=tx.getCell(r,11).value;assert.equal(debit.toFixed(2),loaded.report.summary_by_currency[0].money_out);
  assert(full.includes('AUD 12,962.25'),'HTML agrees with CSV/XLSX/PDF totals');
  for(const input of ['=HYPERLINK("bad")',' +SUM(1,2)','\t@SUM(1,2)','\r-1'])assert(controller._test.csvCell(input).startsWith('"\''));
  malicious.report.transactions[0].description='=HYPERLINK("bad")';const safeWorkbook=await controller._test.createReportWorkbook(malicious.report,profile,'Register');assert.equal(typeof safeWorkbook.getWorksheet('Transactions').getCell(12,6).value,'string');
  const fallbackSaved=await snapshots.capture(owner,fixture(1),profile),fallbackId=fallbackSaved.report.metadata.report_id;
  failPdf=true;const res=response();await controller.emailPdf({...owner,body:{to:'owner@example.test',report_id:fallbackId}},res);failPdf=false;
  assert.equal(res.statusCode,200);assert.equal(res.body.pdf_status,'UNAVAILABLE');assert.equal(res.body.delivery_mode,'web_report');assert.equal(res.body.email_outcome.status,'PROVIDER_ACCEPTED');
  assert.equal(sent.attachments.length,0);assert(sent.text.includes('Your report is ready to view online; PDF is currently unavailable.'));assert(sent.html.includes('>View report</a>'));assert(sent.text.includes(res.body.view_url));
  assert.equal((await snapshots.load(owner,fallbackId)).report.transactions.length,1,'forced PDF failure retains durable viewer data');
  const viewRes=response();await controller.viewSnapshot({...owner,params:{reportId:fallbackId},query:{}},viewRes);assert.equal(viewRes.statusCode,200);assert(viewRes.body.includes('Record-000')&&viewRes.body.includes('primarySidebar'));
  const empty=await snapshots.capture(owner,fixture(0),profile);assert(html.standaloneHtml(empty).includes('No transactions in this period'));
  const emptyPdf=await controller._test.ensureSnapshotPdf(empty);assert(emptyPdf&&await validateReportPdf(emptyPdf,empty.report));
  const statement=fixture(1);statement.metadata.report_type='ACCOUNT_STATEMENT';statement.account_statement={account_id:42,account_holder:'Voxel Veda',account_name:'Operating',account_type:'Savings',account_number_masked:'***1234',currency:'AUD',statement_from:'2026-09-30',statement_to:'2026-10-06',opening_running_balance:100000,closing_running_balance:99876.55,total_debits:123.45,total_credits:0,transaction_count:1};
  const statementSaved=await snapshots.capture(owner,statement,profile),statementPdf=await controller._test.ensureSnapshotPdf(statementSaved);assert(statementPdf&&await validateReportPdf(statementPdf,statementSaved.report));
  assert(html.standaloneHtml(statementSaved).includes('Opening balance'));assert(controller._test.csvDataset(statementSaved.report).header.includes('Running Balance'));
  const statementWorkbook=await controller._test.createReportWorkbook(statementSaved.report,profile,'Account Statement');assert(statementWorkbook.getWorksheet('Account Statement').getColumn(9).values.includes(99876.55),'XLSX statement retains recorded running balances');
  const multi=fixture(4),currencies=['AUD','USD','INR','EUR'];multi.metadata.currency=null;
  multi.transactions.forEach((t,i)=>t.currency=currencies[i]);multi.summary_by_currency=currencies.map(currency=>({...multi.summary_by_currency[0],currency,source_transaction_count:1,money_out:'123.45',net_cash_flow:'-123.45',net_economic_expense:'123.45'}));
  const multiSaved=await snapshots.capture(owner,multi,profile),multiPdf=await controller._test.ensureSnapshotPdf(multiSaved);assert(multiPdf&&await validateReportPdf(multiPdf,multiSaved.report),'every currency including the fourth must remain in the parsed PDF');
  const queue=require('../services/emailQueue')._test;
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'finance-attachment-')),temporary=path.join(directory,'tmp');fs.writeFileSync(temporary,artifact.buffer);
  const serialized=await queue.serializableAttachments([{filename:artifact.filename,path:temporary,contentType:'application/pdf',contentDisposition:'attachment'}]);fs.rmSync(directory,{recursive:true});
  const restored=queue.restoreAttachments(JSON.parse(JSON.stringify(serialized)));assert.deepEqual(restored[0].content,artifact.buffer);assert.equal(restored[0].filename,artifact.filename);
  const bufferSaved=await queue.serializableAttachments([{filename:artifact.filename,content:artifact.buffer,contentType:'application/pdf'}]);assert.deepEqual(queue.restoreAttachments(JSON.parse(JSON.stringify(bufferSaved)))[0].content,artifact.buffer);
  const corrupt=JSON.parse(JSON.stringify(bufferSaved));corrupt[0].content='AAAA';assert.throws(()=>queue.restoreAttachments(corrupt),/integrity/);
  const mime=await nodemailer.createTransport({streamTransport:true,buffer:true}).sendMail({from:'info@voxelveda.com',to:'owner@example.test',subject:'Snapshot MIME regression',text:'View report: '+saved.view_url,attachments:restored});
  const source=mime.message.toString('utf8'),unfolded=source.replace(/\r?\n[ \t]+/g,' ');
  assert(unfolded.includes('Content-Type: application/pdf'));assert(unfolded.includes('Content-Disposition: attachment;'));
  const disposition=unfolded.match(/Content-Disposition: attachment;([^\r\n]+)/)[1];
  const pieces=[...disposition.matchAll(/filename\*(\d+)(\*)?=(?:"([^"]*)"|([^;]*))/g)].sort((a,b)=>Number(a[1])-Number(b[1]));
  const decodedName=pieces.length?decodeURIComponent(pieces.map(p=>p[3]||p[4].trim()).join('').replace(/^utf-8''/i,'')):disposition.match(/filename=(?:"([^"]*)"|([^;]*))/)?.slice(1).find(Boolean);
  assert.equal(decodedName,artifact.filename,'received MIME filename including RFC2231 continuations must survive');
  const pdfPart=source.split(/\r?\n(?=Content-Type:)/).find(part=>part.startsWith('Content-Type: application/pdf'));
  const encoded=pdfPart.split(/\r?\n\r?\n/)[1].split(/\r?\n--/)[0];assert.deepEqual(Buffer.from(encoded.replace(/\s/g,''),'base64'),artifact.buffer,'MIME decoded binary bytes must match parsed PDF');
  const actualFetch=global.fetch;let relayPayload;
  process.env.WORDPRESS_MAIL_RELAY_URL='https://relay.example.test/mail';process.env.WORDPRESS_MAIL_RELAY_TOKEN='fixture-only';process.env.PDF_EMAIL_TRANSPORT='https_relay';delete process.env.WORDPRESS_MAIL_RELAY_PDF_FILENAME_VERIFIED;
  global.fetch=async(_url,options)=>{relayPayload=JSON.parse(options.body);return new Response(JSON.stringify({sent:true,request_id:'fixture'}),{status:200})};
  const relay=await actualSendMail({to:'owner@example.test',subject:'Report',text:'PDF attached',attachments:[{filename:artifact.filename,content:artifact.buffer,contentType:'application/pdf'}],attachmentFallback:{html:'<a href="'+saved.view_url+'">View report</a>',text:'View report: '+saved.view_url}});
  global.fetch=actualFetch;assert.equal(relay.attachmentOmitted,true);assert.equal(relayPayload.attachments.length,0);assert(!relayPayload.text.includes('PDF attached'));assert.equal(relay.attachmentFilenameGuaranteed,false);
  await snapshots.revoke(owner,id);await assert.rejects(()=>snapshots.load(owner,id),e=>e.code==='REPORT_REVOKED');
  console.log('FINANCE_REPORT_SNAPSHOT_TEST_OK: encrypted immutable restart, scope denial/revocation/expiry, 105-row pagination, self-contained escaped HTML, parsed multi-page/empty PDFs and expected records, HTML/CSV/XLSX/PDF totals, formula protection, forced PDF-failure viewer/email, durable buffer/path queue, decoded MIME integrity, truthful unverified-relay fallback.');
}
run().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>pool.end());
