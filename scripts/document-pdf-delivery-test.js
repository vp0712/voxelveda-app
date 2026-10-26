'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const nodemailer = require('nodemailer');
const { createDocumentPdf, validatePdf, safePdfFilename, sendPdfResponse, storedDocumentArtifact } = require('../services/documentPdfService');
const { invoiceDocumentData, statementDocumentData, blankInvoiceDocumentData } = require('../services/invoiceDocumentService');
const { timesheetDocumentData } = require('../services/timesheetDocumentService');

async function main() {
  const originalLogo = await fs.readFile(path.join(__dirname, '..', 'public', 'Frame 1.png'));
  const scanned = await storedDocumentArtifact(originalLogo,'fixture-scan.png');
  assert.equal(scanned.converted_from,'image/png');assert.match(scanned.filename,/\.pdf$/);await validatePdf(scanned.buffer);
  await assert.rejects(()=>storedDocumentArtifact(Buffer.from('preserve unsupported original'),'historical.docx'),{code:'PDF_SOURCE_FORMAT_UNSUPPORTED'});
  const items = Array.from({ length: 45 }, (_, i) => ({ description: `Fixture precision part ${i + 1}: inspect against the approved drawing and retain its complete traceability record.`, quantity: 2, unit_price: 12.5, amount: 25 }));
  const data = invoiceDocumentData({ id: 42, invoice_no: 'FIXTURE-INV-042', created_at: '2026-10-01', customer_name: 'Fixture Customer', customer_email: 'fixture@example.invalid', status: 'approved', gst_rate: 10, total: 1237.5, paid_amount: 100, balance_due: 1137.5, rfq_id: 8 }, items);
  const invoice = await createDocumentPdf(data);
  assert.ok(invoice.validation.pages > 1, 'All 45 invoice items must render across multiple pages.');
  assert.match(invoice.validation.text, /Fixture precision part 45/);
  assert.match(invoice.validation.text, /AUD 1,237.50/);
  assert.match(invoice.validation.text, /Page 1 of/);
  assert.ok((invoice.validation.text.match(/DESCRIPTION/gi) || []).length >= 3, 'Table headers repeat on every page containing invoice items.');
  const statement = await createDocumentPdf(statementDocumentData({ customer: { name: 'Fixture Customer', email: 'fixture@example.invalid' }, issueDate: '2026-10-03', invoices: Array.from({length:35},(_,i)=>({id:i+1,invoice_no:`FIXTURE-${i+1}`,created_at:'2026-10-01',status:'paid',total:25,paid_amount:25,balance_due:0})),payments:Array.from({length:40},(_,i)=>({invoice_no:`FIXTURE-${i+1}`,payment_date:'2026-10-02',method:'Recorded payment',reference:`REF-${i+1}`,amount:25})),totals:{invoice_value:875,paid:875,balance_due:0} }));
  assert.match(statement.validation.text, /FIXTURE-35/); assert.match(statement.validation.text,/REF-40/);
  const blank = await createDocumentPdf(blankInvoiceDocumentData());
  const timesheet = await createDocumentPdf(timesheetDocumentData({ rows:[{ name:'Fixture Staff',work_date:'2026-10-01',clock_in:'2026-10-01T01:00:00Z',clock_out:'2026-10-01T09:00:00Z',total_hours:8 }],fromDate:'2026-09-28',toDate:'2026-10-04',staffName:'Fixture Staff',totalHours:8,status:'APPROVED' }));
  assert.match(timesheet.validation.text,/8.00/);
  assert.throws(()=>timesheetDocumentData({rows:[{work_date:'2026-10-01',total_hours:8}],fromDate:'2026-10-01',toDate:'2026-10-01',totalHours:7}),{code:'PDF_TOTAL_MISMATCH'});
  assert.throws(()=>timesheetDocumentData({rows:[{total_hours:Infinity}],fromDate:'2026-10-01',toDate:'2026-10-01'}),{code:'PDF_DATA_INVALID'});
  const employee = await createDocumentPdf({title:'EMPLOYEE IDENTIFICATION',reference:'FIXTURE-EMP-001',issueDate:'2026-10-01',party:'Fixture Staff',columns:[{label:'Field',width:2},{label:'Value',width:4}],rows:[['Role','Operator'],['Credential status','ACTIVE']],verificationUrl:'https://fixture.invalid/employee/verify/fixture-token'});
  assert.equal(employee.validation.pages,1);assert.match(employee.validation.text,/Scan to verify the current credential/);assert.doesNotMatch(employee.validation.text,/fixture-token/);
  const release = await createDocumentPdf(require('../services/releasePdfVerificationService').releaseVerificationData('fixture-only'));
  assert.match(release.validation.text,/RELEASE-fixture-only/);assert.match(release.validation.text,/does not represent a customer/);
  const purchaseOrder={id:42,po_number:'FIXTURE-PO-042',status:'APPROVED',issue_date:'2026-10-01',expected_date:'2026-11-01',supplier_name:'Fixture Supplier',email:'fixture@example.invalid',currency:'AUD',subtotal:1000,tax_amount:100,total_amount:1100,payment_terms:'Fixture approved terms only'};
  const purchaseItems=Array.from({length:40},(_,index)=>({description:`Fixture purchase part ${index+1}: retain supplier traceability and inspect against the approved order.`,quantity:2,unit:'EA',unit_price:12.5,line_subtotal:25,line_tax:2.5,line_total:27.5}));
  const purchaseDb={async query(sql){return sql.includes('JOIN suppliers')?[[purchaseOrder]]:[purchaseItems];}};
  const loadPurchaseOrder=require('../controllers/procurementDocumentController')._test.load;
  const purchase=await createDocumentPdf((await loadPurchaseOrder(42,purchaseDb)).data);
  assert.ok(purchase.validation.pages>1);assert.match(purchase.validation.text,/Fixture purchase part 40/);assert.match(purchase.validation.text,/AUD 1,100.00/);
  // Valid quality descriptions can exceed one page. Exercise two independently
  // long cells and an unbroken reference, then prove every source token survives
  // exactly once without repeating numeric values as additional business rows.
  const descriptionTokens=Array.from({length:160},(_,i)=>`STEP${String(i+1).padStart(4,'0')} inspect the retained requirement.`);
  const evidenceTokens=Array.from({length:190},(_,i)=>`CHECK${String(i+1).padStart(4,'0')} preserve the original review evidence.`);
  const longReference='FIXTURE-TRACE-'+Array.from({length:120},(_,i)=>String(i).padStart(3,'0')).join('');
  const longRows=await createDocumentPdf({title:'QUALITY REGISTER',reference:'FIXTURE-LONG-ROWS',issueDate:'2026-10-25',tables:[{title:'Complete authorised selection',columns:[{label:'Reference',width:1},{label:'Description',width:3},{label:'Evidence',width:3},{label:'Amount',width:1,align:'right'}],rows:[[longReference,descriptionTokens.join(' '),evidenceTokens.join(' '),'AUD 123.45'],['LAST','Final authorised record.','Complete.','AUD 9.87']]}]});
  assert(longRows.validation.pages>=3,'Oversized cells must continue across complete readable pages');
  for(const token of [...descriptionTokens,...evidenceTokens].map(value=>value.split(' ')[0]))assert.equal((longRows.validation.text.match(new RegExp('\\b'+token+'\\b','g'))||[]).length,1,'Each complete source token must appear exactly once: '+token);
  assert.equal((longRows.validation.text.match(/AUD 123\.45/g)||[]).length,1,'A row continuation cannot duplicate its amount');
  assert.match(longRows.validation.text,/Final authorised record/);
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs'),longTask=getDocument({data:new Uint8Array(longRows.buffer),isEvalSupported:false,useSystemFonts:true,disableFontFace:true});
  try{
    const parsed=await longTask.promise,referenceParts=[];
    for(let n=1;n<=parsed.numPages;n++){
      const page=await parsed.getPage(n),layer=await page.getTextContent(),text=layer.items.map(item=>item.str||'').join(' ');
      assert.match(text,/Description/,'Every page containing the continued row repeats its column headings');
      assert.match(text,new RegExp('Page '+n+' of '+parsed.numPages));
      for(const item of layer.items){
        if(Math.abs(item.transform[4]-49)<0.1&&!['Reference','LAST'].includes(item.str))referenceParts.push(item.str);
        if(/STEP\d|CHECK\d|FIXTURE-TRACE|AUD (123|9)\./.test(item.str)){
          assert(item.transform[5]>=64,'Table content cannot enter the footer');
          assert(item.transform[4]>=41.5&&item.transform[4]+item.width<=553.8,'Data text must stay inside the page table bounds');
        }
      }
      page.cleanup();
    }
    assert.equal(referenceParts.join('').replace(/\s/g,''),longReference,'An unbroken long reference is preserved without lost or duplicated characters');
  }finally{await longTask.destroy();}
  const partyTokens=Array.from({length:180},(_,i)=>`PARTY${String(i+1).padStart(4,'0')} authorised customer details.`);
  const noteTokens=Array.from({length:260},(_,i)=>`NOTE${String(i+1).padStart(4,'0')} retain the agreed document terms.`);
  const longParagraphs=await createDocumentPdf({title:'EXTENDED TERMS',reference:'FIXTURE-LONG-PARAGRAPH',issueDate:'2026-10-25',party:partyTokens.join(' '),period:'19 to 25 October 2026',columns:[{label:'Reference',width:2},{label:'Status',width:2}],rows:[['SOURCE-ONE','Recorded source only']],notes:[noteTokens.join(' ')]});
  assert(longParagraphs.validation.pages>=4,'Long authorised party details and notes must span readable pages');
  for(const token of [...partyTokens,...noteTokens].map(value=>value.split(' ')[0]))assert.equal((longParagraphs.validation.text.match(new RegExp('\\b'+token+'\\b','g'))||[]).length,1,'Every party/note token is preserved exactly once: '+token);
  assert.match(longParagraphs.validation.text,/SOURCE-ONE/);
  const paragraphTask=getDocument({data:new Uint8Array(longParagraphs.buffer),isEvalSupported:false,useSystemFonts:true,disableFontFace:true});
  try{
    const parsed=await paragraphTask.promise;
    for(let n=1;n<=parsed.numPages;n++){
      const page=await parsed.getPage(n),layer=await page.getTextContent(),text=layer.items.map(item=>item.str||'').join(' ');
      assert.match(text,/EXTENDED TERMS/);assert.match(text,/FIXTURE-LONG-PARAGRAPH/);assert.match(text,new RegExp('Page '+n+' of '+parsed.numPages));
      if(n>1)assert.match(text,/Continued/,'Paragraph continuation keeps its document header');
      for(const item of layer.items)if(/PARTY\d|NOTE\d/.test(item.str)){
        assert(item.transform[5]>=64,'Paragraphs cannot overlap the footer');
        assert(item.transform[4]>=41.5&&item.transform[4]+item.width<=553.8,'Paragraph text must stay within document margins');
        assert(Math.abs(item.height-(/PARTY\d/.test(item.str)?11:8))<0.1,'Continuation restores the intended party/note typography after the page header');
      }
      page.cleanup();
    }
  }finally{await paragraphTask.destroy();}
  purchaseOrder.total_amount+=1;await assert.rejects(()=>loadPurchaseOrder(42,purchaseDb),{code:'PDF_TOTAL_MISMATCH'});purchaseOrder.total_amount-=1;
  await assert.rejects(()=>validatePdf(Buffer.from('<html>not a pdf</html>')),{code:'PDF_DOCUMENT_INVALID'});
  await assert.rejects(()=>validatePdf(Buffer.from('%PDF-1.7\n'+ 'corrupt '.repeat(80)+'%%EOF')),{code:'PDF_PARSE_FAILED'});
  await assert.rejects(()=>validatePdf(invoice.buffer,{expectedText:['Unrelated document identity']}),{code:'PDF_CONTENT_MISMATCH'});
  const boundaryPdf=await createDocumentPdf({title:'IDENTITY CHECK',reference:'FIXTURE-BOUNDARY',party:'Staff 10',columns:[{label:'Field'},{label:'Value'}],rows:[['Hours','18.00'],['Status','INACTIVE']]});
  for(const expected of ['8.00','ACTIVE','Staff 1'])await assert.rejects(()=>validatePdf(boundaryPdf.buffer,{expectedText:[expected]}),{code:'PDF_CONTENT_MISMATCH'},'Identity selectors cannot accept a longer value containing '+expected);
  assert.throws(()=>invoiceDocumentData({id:1,total:999,gst_rate:10},items),{code:'PDF_TOTAL_MISMATCH'});
  assert.equal(safePdfFilename('bad\r\n"/file.PDF'),'bad----file.pdf');
  const mail = require('../services/emailService');
  await assert.rejects(()=>mail.assertAttachmentIntegrity([{filename:'report.tmp',content:invoice.buffer}]),{code:'PDF_ATTACHMENT_FILENAME_INVALID'});
  await assert.rejects(()=>mail.assertAttachmentIntegrity([{filename:'report.pdf',content:Buffer.from('<html>fake</html>')}]),{code:'PDF_DOCUMENT_INVALID'});
  for (const content of [invoice.buffer,JSON.parse(JSON.stringify(invoice.buffer)),new Uint8Array(invoice.buffer),invoice.buffer.toString('base64')]) {
    const attachment = await mail.assertAttachmentIntegrity([{filename:'fixture-report.pdf',content,encoding:typeof content==='string'?'base64':undefined}]);
    assert.deepEqual(attachment[0].content,invoice.buffer);
    assert.equal(attachment[0].contentType,'application/pdf'); assert.equal(attachment[0].contentDisposition,'attachment');
  }
  const normalized = await mail.assertAttachmentIntegrity([{filename:'FIXTURE-INV-042.pdf',path:await (async()=>{const temp='/tmp/voxel-temporary-source.tmp';await fs.writeFile(temp,invoice.buffer);return temp;})()}]);
  assert.equal(normalized[0].path,undefined);
  const result = await nodemailer.createTransport({streamTransport:true,buffer:true,newline:'unix'}).sendMail({from:'Voxel Veda <info@voxelveda.com>',to:'fixture@example.invalid',subject:'Fixture PDF only',text:'The validated fixture PDF is attached.',attachments:normalized});
  const mime = result.message.toString('utf8');
  assert.match(mime,/Content-Type: application\/pdf; name=FIXTURE-INV-042.pdf/);
  assert.match(mime,/Content-Disposition: attachment; filename=FIXTURE-INV-042.pdf/);
  assert.doesNotMatch(mime,/temporary-source|\.tmp|application\/octet-stream/);
  const pdfPart=mime.split(/--[^\n]+\n/).find(part=>/Content-Type: application\/pdf/.test(part));
  assert.ok(pdfPart); const decoded=Buffer.from(pdfPart.split('\n\n')[1].trim(),'base64');
  assert.deepEqual(decoded,invoice.buffer); await validatePdf(decoded,{expectedText:['FIXTURE-INV-042','Fixture precision part 45','AUD 1,237.50']});
  assert.equal((mime.match(/Content-Disposition: attachment/g)||[]).length,1);
  const headers = {}; let downloaded;
  await sendPdfResponse({setHeader:(k,v)=>{headers[k]=v;},send:b=>{downloaded=b;}},invoice,true);
  assert.equal(headers['Content-Type'],'application/pdf'); assert.equal(headers['Content-Disposition'],'attachment; filename="FIXTURE-INV-042.pdf"'); assert.deepEqual(downloaded,invoice.buffer);
  const oldFetch=global.fetch, oldUrl=process.env.WORDPRESS_MAIL_RELAY_URL,oldToken=process.env.WORDPRESS_MAIL_RELAY_TOKEN,oldTransport=process.env.EMAIL_PRIMARY_TRANSPORT;
  process.env.EMAIL_PRIMARY_TRANSPORT='https_relay';process.env.WORDPRESS_MAIL_RELAY_URL='https://fixture.invalid/mail';process.env.WORDPRESS_MAIL_RELAY_TOKEN='fixture-only-token';let sent=0;
  global.fetch=async(_url,options)=>{if(options.method==='POST')sent+=1;return {ok:true,json:async()=>({attachment_contract_version:2}),text:async()=>JSON.stringify({sent:true})};};
  try {
    await assert.rejects(()=>mail.sendMail({to:'fixture@example.invalid',subject:'Blocked unsafe relay',attachments:normalized}),{code:'PDF_RELAY_CONTRACT_REQUIRED'});assert.equal(sent,0,'An unverified receiver cannot send before failing the PDF filename contract.');
    const health={attachment_contract_version:3,pdf_bytes_validated:true,attachment_filename_preserved:true};let outcome='VALID';
    global.fetch=async(_url,options)=>{
      if(options.method==='GET')return {ok:true,json:async()=>health};
      sent+=1;const payload=JSON.parse(options.body);
      if(outcome==='TIMEOUT')throw Object.assign(new Error('Fixture lost response.'),{name:'AbortError'});
      const response=outcome==='REVIEW'?{code:'DELIVERY_REVIEW_REQUIRED',message:'Prior attempt requires provider review.'}:outcome==='UNCONFIRMED'?{sent:true}:outcome==='WRONG_BYTES'?{sent:true,...health,attachments:payload.attachments.map(part=>({...part,sha256:'0'.repeat(64),pages:1}))}:{sent:true,...health,attachments:payload.attachments.map(part=>({filename:part.filename,contentType:part.contentType,byte_length:part.byte_length,sha256:part.sha256,pages:invoice.validation.pages}))};
      return {ok:outcome!=='REVIEW',status:outcome==='REVIEW'?409:200,text:async()=>JSON.stringify(response)};
    };
    const accepted=await mail.sendMail({to:'fixture@example.invalid',subject:'Confirmed exact PDF fixture',attachments:normalized});assert.equal(accepted.receivedVerified,false);assert.equal(accepted.attachmentContractVersion,3);
    for(const test of ['UNCONFIRMED','WRONG_BYTES']){outcome=test;await assert.rejects(()=>mail.sendMail({to:'fixture@example.invalid',subject:'Unconfirmed attachment fixture',attachments:normalized}),error=>error.code==='DELIVERY_REVIEW_REQUIRED' && error.providerAccepted===true);}
    outcome='REVIEW';await assert.rejects(()=>mail.sendMail({to:'fixture@example.invalid',subject:'Preserved review fixture',attachments:normalized}),{code:'DELIVERY_REVIEW_REQUIRED'});
    outcome='TIMEOUT';await assert.rejects(()=>mail.sendMail({to:'fixture@example.invalid',subject:'Uncertain response fixture',attachments:normalized}),{code:'DELIVERY_REVIEW_REQUIRED'});
  }
  finally {global.fetch=oldFetch;if(oldTransport===undefined)delete process.env.EMAIL_PRIMARY_TRANSPORT;else process.env.EMAIL_PRIMARY_TRANSPORT=oldTransport;if(oldUrl===undefined)delete process.env.WORDPRESS_MAIL_RELAY_URL;else process.env.WORDPRESS_MAIL_RELAY_URL=oldUrl;if(oldToken===undefined)delete process.env.WORDPRESS_MAIL_RELAY_TOKEN;else process.env.WORDPRESS_MAIL_RELAY_TOKEN=oldToken;}
  const apiEnvironment=['EMAIL_PRIMARY_TRANSPORT','HOSTINGER_MAIL_API_BASE_URL','HOSTINGER_MAIL_API_TOKEN','HOSTINGER_MAILBOX_RESOURCE_ID'],savedApiEnv=new Map(apiEnvironment.map(name=>[name,process.env[name]]));
  let apiPosts=0,apiMode='TIMEOUT',fixtureProviderAccepted=false;
  try{
    Object.assign(process.env,{EMAIL_PRIMARY_TRANSPORT:'hostinger_mail_api',HOSTINGER_MAIL_API_BASE_URL:'https://fixture.invalid',HOSTINGER_MAIL_API_TOKEN:'fixture-only-token',HOSTINGER_MAILBOX_RESOURCE_ID:'fixture-mailbox'});
    global.fetch=async(url,options)=>{
      assert.match(url,/^https:\/\/fixture\.invalid\/api\/v1\/mailboxes\/fixture-mailbox\/send$/);assert.equal(options.method,'POST');apiPosts++;
      const payload=JSON.parse(options.body);assert.deepEqual(payload.to,['fixture@example.invalid']);assert(!payload.cc&&!payload.bcc);assert.equal(payload.attachments.length,1);assert.equal(payload.attachments[0].contentType,'application/pdf');assert.match(payload.attachments[0].filename,/\.pdf$/);assert.deepEqual(Buffer.from(payload.attachments[0].content,'base64'),invoice.buffer);
      if(apiMode==='TIMEOUT'){fixtureProviderAccepted=true;throw Object.assign(new Error('Fixture response lost after provider handoff'),{name:'AbortError'});}
      if(apiMode==='RESET')throw Object.assign(new TypeError('Fixture connection reset'),{cause:{code:'ECONNRESET'}});
      if(apiMode==='INVALID_JSON')return{status:200,async json(){throw new SyntaxError('Fixture malformed success JSON');}};
      return{status:apiMode==='UNAUTHORISED'?401:apiMode==='FORBIDDEN'?403:apiMode==='SERVER_ERROR'?503:204,async json(){return{};}};
    };
    const queueRow={id:991,related_module:'procurement',related_record_id:'fixture',template_key:'document_pdf',status:'PENDING',attempts:0,max_attempts:5,to_json:'["fixture@example.invalid"]',cc_json:'[]',bcc_json:'[]',attachments_json:JSON.stringify([{filename:invoice.filename,contentType:'application/pdf',contentDisposition:'attachment',content:invoice.buffer.toString('base64'),encoding:'base64',byteLength:invoice.buffer.length,sha256:invoice.validation.sha256}]),subject:'Synthetic transport outcome fixture',text_body:'Validated PDF fixture.',idempotency_key:'document:synthetic-hostinger-outcome'};
    const queueDb={async query(sql,values=[]){const query=sql.replace(/\s+/g,' ').trim();
      if(query.startsWith('UPDATE email_queue q LEFT JOIN'))return[{affectedRows:0}];
      if(query.startsWith('SELECT * FROM email_queue'))return[['PENDING','RETRY'].includes(queueRow.status)?[queueRow]:[]];
      if(query.startsWith("UPDATE email_queue SET status = 'SENDING'")){if(!['PENDING','RETRY'].includes(queueRow.status))return[{affectedRows:0}];queueRow.status='SENDING';return[{affectedRows:1}];}
      if(query.startsWith("UPDATE email_queue SET status='REVIEW_REQUIRED'")){assert.match(query,/next_attempt_at=NULL/);queueRow.status='REVIEW_REQUIRED';queueRow.next_attempt_at=null;return[{affectedRows:1}];}
      if(query.startsWith('INSERT INTO email_logs'))return[{insertId:1}];
      throw new Error('Unexpected transport fixture SQL: '+query);
    }};
    const vm=require('node:vm'),queueFile=path.join(__dirname,'../services/emailQueue.js'),queueRequire=require('node:module').createRequire(queueFile),queueModule={exports:{}};
    vm.runInNewContext(await fs.readFile(queueFile,'utf8'),{module:queueModule,exports:queueModule.exports,Buffer,console,process,require:name=>name==='../config/db'?queueDb:name==='./emailQueueSchema'?{async ensureEmailQueueSchema(){}}:queueRequire(name)},{filename:queueFile});
    const outcome=await queueModule.exports.processEmailQueue();assert.equal(outcome[0].status,'REVIEW_REQUIRED');assert.equal(fixtureProviderAccepted,true,'Fixture provider accepted before its reply was lost');assert.equal(apiPosts,1);assert.equal(queueRow.next_attempt_at,null);assert.equal((await queueModule.exports.processEmailQueue()).length,0);assert.equal(apiPosts,1,'Restart/retry cannot resend a Hostinger request with an uncertain accepted outcome');
    for(const mode of ['RESET','SERVER_ERROR','INVALID_JSON','NO_ACCEPTANCE_ID']){apiMode=mode;await assert.rejects(()=>mail.sendMail({to:'fixture@example.invalid',subject:'Synthetic uncertain transport',attachments:normalized}),error=>error.code==='DELIVERY_REVIEW_REQUIRED'&&error.deliveryOutcome==='UNKNOWN'&&error.providerAccepted===false);}
    for(const mode of ['UNAUTHORISED','FORBIDDEN']){apiMode=mode;await assert.rejects(()=>mail.sendMail({to:'fixture@example.invalid',subject:'Synthetic explicit provider rejection',attachments:normalized}),error=>error.code==='HOSTINGER_MAIL_API_REJECTED'&&error.deliveryOutcome==='NOT_ACCEPTED'&&error.retryable===false);}
    const beforeBlocked=apiPosts;
    delete process.env.HOSTINGER_MAIL_API_TOKEN;await assert.rejects(()=>mail.sendMail({to:'fixture@example.invalid',subject:'Synthetic missing connection',attachments:normalized}),{code:'HOSTINGER_MAIL_API_CONFIG_MISSING'});process.env.HOSTINGER_MAIL_API_TOKEN='fixture-only-token';
    await assert.rejects(()=>mail.sendMail({to:'fixture@example.invalid',subject:'Synthetic invalid PDF',attachments:[{filename:'fixture.pdf',content:Buffer.from('<html>not a PDF</html>')}]}),{code:'PDF_DOCUMENT_INVALID'});
    const privatePolicy={type:'WEEKLY_TIMESHEET',staffId:31,deliveryId:81,revision:1,fromDate:'2026-10-19',toDate:'2026-10-25',sourceHash:'1'.repeat(64),recipient:'fixture@example.invalid'};
    await assert.rejects(()=>mail.sendMail({to:privatePolicy.recipient,subject:'Synthetic private weekly policy',attachments:normalized,deliveryKey:'weekly-timesheet:31:2026-10-19:2026-10-25:v1',deliveryPolicy:privatePolicy}),error=>error.code==='DELIVERY_REVIEW_REQUIRED'&&error.reasonCode==='WEEKLY_TRANSPORT_PRIVACY_UNVERIFIED');
    assert.equal(apiPosts,beforeBlocked,'Missing connection, invalid PDF and unverified weekly privacy must block before POST');
    const smtpNames=['SMTP_HOST','SMTP_USERNAME','SMTP_PASSWORD'],savedSmtp=new Map(smtpNames.map(name=>[name,process.env[name]])),createTransport=nodemailer.createTransport;
    let smtpCalls=0,smtpMode='TIMEOUT',compiledMime='';
    try{
      const SMTPConnection=require('nodemailer/lib/smtp-connection');
      function smtpReplyError(reply){const connection=new SMTPConnection({});let failure;connection._actionSMTPStream(reply,error=>{failure=error;});connection.close();assert(failure);return failure;}
      const malformed=smtpReplyError('garbled final reply');assert.equal(malformed.code,'EMESSAGE');assert.equal(malformed.command,'DATA');assert.equal(malformed.responseCode,undefined,'Installed Nodemailer gives no explicit rejection code for a malformed final reply');
      Object.assign(process.env,{EMAIL_PRIMARY_TRANSPORT:'smtp',SMTP_HOST:'fixture.invalid',SMTP_USERNAME:'fixture@example.invalid',SMTP_PASSWORD:'fixture-only-password'});
      nodemailer.createTransport=()=>createTransport({name:'FixtureSMTP',version:'1',send(message,callback){smtpCalls++;const chunks=[],stream=message.message.createReadStream();stream.on('data',chunk=>chunks.push(chunk));stream.on('error',callback);stream.on('end',()=>{compiledMime=Buffer.concat(chunks).toString('utf8');if(['SUCCESS','MALFORMED_SUCCESS'].includes(smtpMode))return callback(null,{accepted:['fixture@example.invalid'],rejected:[],response:smtpMode==='SUCCESS'?'250 2.0.0 Accepted':'2garbled',messageId:'fixture-provider-message'});const error=smtpMode==='NEGATIVE'?smtpReplyError('550 5.7.1 Explicit rejection'):smtpMode==='TRANSIENT'?smtpReplyError('450 4.2.0 Explicit temporary rejection'):smtpMode==='MALFORMED'?smtpReplyError('garbled final reply'):smtpMode==='UNCLASSIFIED'?new Error('Opaque fixture failure'):Object.assign(new Error('Fixture lost SMTP reply after DATA'),{code:smtpMode==='RESET'?'ECONNRESET':smtpMode==='PROTOCOL'?'EPROTOCOL':'ETIMEDOUT',command:'CONN'});callback(error);});},close(){}});
      queueRow.status='PENDING';const smtpOutcome=await queueModule.exports.processEmailQueue();assert.equal(smtpOutcome[0].status,'REVIEW_REQUIRED');assert.equal(smtpCalls,1);assert.equal(queueRow.next_attempt_at,null);await queueModule.exports.processEmailQueue();assert.equal(smtpCalls,1,'Post-DATA ETIMEDOUT/CONN cannot dispatch again');assert.match(compiledMime,/Content-Type: application\/pdf/);assert.match(compiledMime,/filename=FIXTURE-INV-042.pdf/);
      smtpMode='RESET';await assert.rejects(()=>mail.sendMail({to:'fixture@example.invalid',subject:'Synthetic reset after DATA',attachments:normalized}),error=>error.code==='DELIVERY_REVIEW_REQUIRED'&&error.reasonCode==='SMTP_DELIVERY_OUTCOME_UNKNOWN');
      smtpMode='NEGATIVE';await assert.rejects(()=>mail.sendMail({to:'fixture@example.invalid',subject:'Synthetic explicit SMTP rejection',attachments:normalized}),error=>error.deliveryOutcome==='NOT_ACCEPTED'&&error.responseCode===550&&error.retryable===false);
      smtpMode='TRANSIENT';await assert.rejects(()=>mail.sendMail({to:'fixture@example.invalid',subject:'Synthetic explicit temporary SMTP rejection',attachments:normalized}),error=>error.deliveryOutcome==='NOT_ACCEPTED'&&error.responseCode===450&&error.retryable===true);
      for(const mode of ['MALFORMED','PROTOCOL','UNCLASSIFIED','MALFORMED_SUCCESS']){smtpMode=mode;queueRow.status='PENDING';const before=smtpCalls;assert.equal((await queueModule.exports.processEmailQueue())[0].status,'REVIEW_REQUIRED');assert.equal(queueRow.next_attempt_at,null);await queueModule.exports.processEmailQueue();assert.equal(smtpCalls,before+1,'Ambiguous '+mode+' SMTP result cannot dispatch again');}
      smtpMode='SUCCESS';const smtpAccepted=await mail.sendMail({to:'fixture@example.invalid',subject:'Synthetic positive SMTP acceptance',attachments:normalized});assert.equal(smtpAccepted.response,'250 2.0.0 Accepted');assert.equal(smtpAccepted.receivedVerified,false);
      let fallbackCalls=0,fallbackKind='TIMEOUT';const fallbackModule={exports:{}};queueRow.status='PENDING';vm.runInNewContext(await fs.readFile(queueFile,'utf8'),{module:fallbackModule,exports:fallbackModule.exports,Buffer,console,process,require:name=>name==='../config/db'?queueDb:name==='./emailQueueSchema'?{async ensureEmailQueueSchema(){}}:name==='./emailService'?{...mail,async sendMail(){fallbackCalls++;throw fallbackKind==='MALFORMED'?smtpReplyError('garbled final reply'):fallbackKind==='UNCLASSIFIED'?new Error('Opaque raw transport failure'):Object.assign(new Error('Raw transport timeout'),{code:'ETIMEDOUT',command:'CONN'});}}:queueRequire(name)},{filename:queueFile});
      assert.equal((await fallbackModule.exports.processEmailQueue())[0].status,'REVIEW_REQUIRED');await fallbackModule.exports.processEmailQueue();assert.equal(fallbackCalls,1,'Queue defence also holds a raw CONN timeout without relying on SMTP helper metadata');
      for(const kind of ['MALFORMED','UNCLASSIFIED']){fallbackKind=kind;queueRow.status='PENDING';const before=fallbackCalls;assert.equal((await fallbackModule.exports.processEmailQueue())[0].status,'REVIEW_REQUIRED');assert.equal(queueRow.next_attempt_at,null);await fallbackModule.exports.processEmailQueue();assert.equal(fallbackCalls,before+1,'Raw '+kind+' final outcome stays held after one invocation');}
      nodemailer.createTransport=()=>{throw new Error('Fixture transport construction failure');};await assert.rejects(()=>mail.sendMail({to:'fixture@example.invalid',subject:'Synthetic construction failure',attachments:normalized}),error=>error.deliveryOutcome==='NOT_DISPATCHED'&&error.deliveryAttempted===false);
    }finally{nodemailer.createTransport=createTransport;for(const[name,value]of savedSmtp)value===undefined?delete process.env[name]:process.env[name]=value;}
  }finally{global.fetch=oldFetch;for(const [name,value]of savedApiEnv)value===undefined?delete process.env[name]:process.env[name]=value;}
  const artifacts=process.env.PDF_FIXTURE_OUTPUT || '/tmp/voxel-pdf-evidence';await fs.mkdir(artifacts,{recursive:true});
  for(const [name,artifact] of Object.entries({invoice,statement,blank,timesheet,employee,release,purchase,longRows,longParagraphs}))await fs.writeFile(path.join(artifacts,`${name}.pdf`),artifact.buffer);
  await fs.writeFile(path.join(artifacts,'fixture.eml'),result.message);
  const forms=await fs.readdir(path.join(__dirname,'..','public','forms','company'));let formCount=0;
  for(const file of forms.filter(file=>file.endsWith('.pdf'))){await validatePdf(await fs.readFile(path.join(__dirname,'..','public','forms','company',file)));formCount+=1;}
  await validatePdf(await fs.readFile(path.join(__dirname,'..','public','forms','voxel-veda-quality-process-sheet.pdf')));formCount+=1;
  assert.deepEqual(await fs.readFile(path.join(__dirname,'..','public','Frame 1.png')),originalLogo);
  console.log(`PDF delivery tests passed: invoice ${invoice.validation.pages} pages / 45 items; statement ${statement.validation.pages} pages / 35 invoices / 40 payments; oversized rows ${longRows.validation.pages} pages with complete independent cells, unbroken reference, repeated headers and single amounts; long party/notes ${longParagraphs.validation.pages} pages with complete content, repeated identity, page bounds and preserved typography; blank invoice; timesheet; employee credential with verification QR; release fixture; ${formCount} restored forms; parser/identity-boundary failures; exact decoded PDF MIME bytes; validated download metadata; unsafe relay blocked before send; uncertain Hostinger and post-DATA SMTP/CONN handoffs held without retry; explicit rejection/pre-send failure and weekly privacy preserved; unchanged original logo. Recipient inbox verification is unavailable.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
