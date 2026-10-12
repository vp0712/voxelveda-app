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
  purchaseOrder.total_amount+=1;await assert.rejects(()=>loadPurchaseOrder(42,purchaseDb),{code:'PDF_TOTAL_MISMATCH'});purchaseOrder.total_amount-=1;
  await assert.rejects(()=>validatePdf(Buffer.from('<html>not a pdf</html>')),{code:'PDF_DOCUMENT_INVALID'});
  await assert.rejects(()=>validatePdf(Buffer.from('%PDF-1.7\n'+ 'corrupt '.repeat(80)+'%%EOF')),{code:'PDF_PARSE_FAILED'});
  await assert.rejects(()=>validatePdf(invoice.buffer,{expectedText:['Unrelated document identity']}),{code:'PDF_CONTENT_MISMATCH'});
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
  const artifacts=process.env.PDF_FIXTURE_OUTPUT || '/tmp/voxel-pdf-evidence';await fs.mkdir(artifacts,{recursive:true});
  for(const [name,artifact] of Object.entries({invoice,statement,blank,timesheet,employee,release,purchase}))await fs.writeFile(path.join(artifacts,`${name}.pdf`),artifact.buffer);
  await fs.writeFile(path.join(artifacts,'fixture.eml'),result.message);
  const forms=await fs.readdir(path.join(__dirname,'..','public','forms','company'));let formCount=0;
  for(const file of forms.filter(file=>file.endsWith('.pdf'))){await validatePdf(await fs.readFile(path.join(__dirname,'..','public','forms','company',file)));formCount+=1;}
  await validatePdf(await fs.readFile(path.join(__dirname,'..','public','forms','voxel-veda-quality-process-sheet.pdf')));formCount+=1;
  assert.deepEqual(await fs.readFile(path.join(__dirname,'..','public','Frame 1.png')),originalLogo);
  console.log(`PDF delivery tests passed: invoice ${invoice.validation.pages} pages / 45 items; statement ${statement.validation.pages} pages / 35 invoices / 40 payments; blank invoice; timesheet; employee credential with verification QR; release fixture; ${formCount} restored forms; parser failures; exact decoded PDF MIME bytes; validated download metadata; unsafe relay blocked before send; unchanged original logo. Recipient inbox verification is unavailable.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
