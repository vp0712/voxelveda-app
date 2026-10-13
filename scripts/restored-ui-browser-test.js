'use strict';
// Real Express routes and controller code, an isolated in-memory SQL fixture and
// real browser assets. No production database, provider or customer is contacted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const Module = require('node:module');
const { chromium } = require(process.env.VV_BROWSER_MODULE_PATH || 'playwright');
const root = path.join(__dirname, '..');
const outputDir = process.env.UI_PROOF_DIR || path.join('/tmp', 'voxelveda-restored-ui-proof');
const statements = [];
const audits = [];
const historicalCompetitors = [
  { id:61, company_name:'Historical <img src=x onerror="window.__storedXss=1"> fixture', category:'__proto__', country:'Australia', website:'javascript:window.__storedXss=2', source_url:'data:text/html,<script>window.__storedXss=3</script>' },
  { id:62, company_name:'Safe linked fixture', category:'Engineering', country:'Australia', website:"https://example.invalid/quote's", source_url:'https://example.invalid/source' }
];
const historicalCompliance = [
  { id:51, category:'__proto__', title:'Historical <svg onload="window.__storedXss=4"> guidance', status:'review_required', official_link:'javascript:window.__storedXss=5', notes:'Legacy unsafe URL is retained as data.' },
  { id:52, category:'Engineering', title:'Safe guidance fixture', status:'current', official_link:"https://example.invalid/guidance's" }
];
const weeklyDeliveries = [{ id:41,user_id:902,staff_name:'Staff fixture',period_start:'2026-10-05',period_end:'2026-10-11',timezone:'Australia/Sydney',version:1,status:'REVIEW_REQUIRED',total_minutes:480,review_reasons_json:'["PROVIDER_OUTCOME_UNCERTAIN"]',last_error_code:'PROVIDER_OUTCOME_UNCERTAIN',email_queue_id:31,document_request_id:null }];
const customers = [
  {id:81,company_name:'Customer fixture',contact_name:'Fixture contact',email:'fixture@example.invalid',phone:'',address:'',notes:'Isolated original customer register',file_link:'https://example.invalid/customer-file',order_count:1,total_spend:110},
  {id:82,company_name:'Historical <svg onload="window.__storedXss=7"> customer',contact_name:'',email:'legacy@example.invalid',phone:'',address:'',notes:'Unsafe legacy URL remains stored data',file_link:'javascript:window.__storedXss=8',order_count:0,total_spend:0}
];
const ncrs=[{id:101,ncr_no:'NCR-FIXTURE-0101',severity:'MINOR',status:'INVESTIGATION',description:'Isolated staff QMS register fixture',created_at:'2026-10-10T10:00:00.000Z'}];
const secureDocumentColumns=new Map([['qms_record_evidence','document_security_id'],['document_revisions','secure_document_id'],['sds_versions','secure_document_id'],['qms_evidence_index','secure_document_id']]);
const attendanceRows = [
  { id:21,user_id:902,name:'Staff fixture',email:'staff@example.invalid',work_date:'2026-10-09',clock_in:'2026-10-08 22:00:00',clock_out:'2026-10-09 06:30:00',clock_in_utc_text:'2026-10-08 22:00:00',clock_out_utc_text:'2026-10-09 06:30:00',timestamp_basis:'UTC',clock_out_timestamp_basis:'UTC',recorded_timezone:'Australia/Sydney',break_minutes:30,total_hours:8,total_minutes:480,review_required:0 },
  { id:22,user_id:902,name:'Staff fixture',email:'staff@example.invalid',work_date:'2026-10-08',clock_in:'2026-10-08 09:00:00',clock_out:'2026-10-08 17:00:00',clock_in_utc_text:'2026-10-08 09:00:00',clock_out_utc_text:'2026-10-08 17:00:00',timestamp_basis:null,clock_out_timestamp_basis:null,recorded_timezone:null,break_minutes:null,total_hours:8,review_required:1,review_reason:'TIMESTAMP_BASIS_UNVERIFIED' }
];
const rfqs = [
  { id:71, customer_name:'Restoration fixture', email:'fixture@example.invalid', material:'Fixture polymer', phone:'', quantity:2, application:'Test-only engineering brief', status:'pending', archived:0, revision:0, created_at:'2026-10-10T10:00:00.000Z' },
  { id:72, customer_name:'Another fixture', email:'other@example.invalid', material:'Fixture aluminium', phone:'', quantity:4, application:'Separate fixture brief', status:'rejected', archived:0, revision:0, created_at:'2026-10-09T10:00:00.000Z' }
];
const invoice = { id:91, invoice_no:'INV-TEST-0091', rfq_id:71, customer_name:'Restoration fixture', customer_email:'fixture@example.invalid', description:'Test-only engineering fixture', quantity:2, unit_price:50, gst_rate:10, subtotal:100, gst_amount:10, total:110, paid_amount:0, balance_due:110, status:'draft', deleted:0, created_at:'2026-10-10T10:00:00.000Z' };
const users = {
  901:{ id:901, name:'Admin fixture', username:'fixture-admin', email:'admin@example.invalid', role:'super_admin', permissions:[], active:1, account_status:'ACTIVE', mfa_enabled:1 },
  902:{ id:902, name:'Staff fixture', username:'fixture-staff', email:'staff@example.invalid', role:'staff', permissions:['VIEW_RFQS','VIEW_FINANCE','VIEW_CUSTOMERS','VIEW_SUPPLIERS','VIEW_INVENTORY','VIEW_PROCUREMENT','VIEW_QMS','VIEW_MEETINGS','VIEW_COMPLIANCE','VIEW_ATTENDANCE'], active:1, account_status:'ACTIVE', mfa_enabled:0 },
  903:{ id:903, name:'Client fixture', username:'fixture-client', email:'fixture@example.invalid', role:'client', permissions:['VIEW_RFQS'], active:1, account_status:'ACTIVE', mfa_enabled:0 }
};
function result(rows) { return [rows, []]; }
async function query(statement, parameters = []) {
  const sql = String(statement).replace(/\s+/g,' ').trim();
  statements.push({ sql, parameters });
  if (/\b(?:DROP|TRUNCATE)\b/i.test(sql)) throw new Error('Destructive SQL is forbidden in the verification fixture');
  if (/^(?:CREATE|ALTER|SET|DELETE)/i.test(sql)) return result({ affectedRows:0 });
  if (/GET_LOCK/i.test(sql)) return result([{ acquired:1 }]);
  if (/RELEASE_LOCK/i.test(sql)) return result([{ released:1 }]);
  if (/^INSERT INTO audit_logs/i.test(sql)) {
    audits.unshift({ id:audits.length+1, action:parameters[1], actor_name:'Admin fixture', old_value:parameters[5], new_value:parameters[6], created_at:new Date().toISOString(), integrity_hash:parameters[14] });
    return result({ insertId:audits.length, affectedRows:1 });
  }
  if (/^INSERT/i.test(sql)) return result({ insertId:1001, affectedRows:1 });
  if (/^UPDATE rfqs SET customer_name/i.test(sql)) {
    const row = rfqs.find(item => item.id === Number(parameters.at(-1)));
    Object.assign(row, Object.fromEntries(['customer_name','email','phone','material','quantity','application'].map((key,index) => [key,parameters[index]])), { revision:row.revision+1 });
    return result({ affectedRows:1 });
  }
  if (/^UPDATE rfqs SET archived/i.test(sql)) { const row=rfqs.find(item=>item.id===Number(parameters[1])); row.archived=Number(parameters[0]); row.revision++; return result({ affectedRows:1 }); }
  if (/^UPDATE rfqs SET status/i.test(sql)) { const row=rfqs.find(item=>item.id===Number(parameters[1])); row.status=parameters[0]; row.revision++; return result({ affectedRows:1 }); }
  if (/^UPDATE/i.test(sql)) return result({ affectedRows:1 });
  if (/^SELECT DATA_TYPE data_type,CHARACTER_MAXIMUM_LENGTH max_length,IS_NULLABLE is_nullable FROM information_schema\.columns/i.test(sql)) {
    const [table,column]=parameters;
    assert.equal(secureDocumentColumns.get(table),column,'schema metadata is limited to the actual retained document reference columns');
    const created=statements.find(entry=>new RegExp(`^CREATE TABLE IF NOT EXISTS ${table}\\b`,'i').test(entry.sql));
    assert.ok(created,'document reference metadata must come from an actual schema CREATE statement');
    const declaration=created.sql.match(new RegExp(`\\b${column}\\s+(varchar|char)\\((\\d+)\\)\\s+(NULL|NOT NULL)`,'i'));
    assert.ok(declaration,'the fixture follows the current document reference DDL');
    return result([{data_type:declaration[1].toLowerCase(),max_length:Number(declaration[2]),is_nullable:declaration[3].toUpperCase()==='NULL'?'YES':'NO'}]);
  }
  if (/^SELECT COUNT\(\*\) n FROM /i.test(sql)) return result([{n:/FROM ncrs\b/i.test(sql)?ncrs.filter(row=>row.status!=='CLOSED').length:0}]);
  if (/^SELECT \* FROM ncrs ORDER BY/i.test(sql)) return result(ncrs);
  if (/FROM customers c\b/i.test(sql)) return result(/^SELECT COUNT\(/i.test(sql) ? [{total:customers.length}] : customers);
  // Match the outer invoice query before its nested payment SUM/GROUP BY.
  // The aggregate join does not turn the invoice list or detail into an empty
  // aggregation result, and COUNT must always return its scalar row.
  if (/FROM invoices i\b/i.test(sql) && /^SELECT COUNT\(\*\) total FROM \(/i.test(sql)) return result([{total:1}]);
  if (/FROM invoices i\b/i.test(sql) && /^SELECT \* FROM \(/i.test(sql)) return result([invoice]);
  if (/FROM invoices i\b/i.test(sql) && /^SELECT i\.\*,/i.test(sql)) return result(Number(parameters[0])===invoice.id ? [invoice] : []);
  if (/FROM audit_logs/i.test(sql)) return result(/integrity_hash FROM/i.test(sql) ? audits.slice(0,1) : audits);
  if (/FROM competitors/i.test(sql)) return result(historicalCompetitors);
  if (/FROM compliance_entries/i.test(sql)) return result(historicalCompliance);
  if (/FROM compliance_files/i.test(sql)) return result([]);
  if (/FROM weekly_timesheet_deliveries/i.test(sql)) return result(/COUNT/i.test(sql) ? [{total:weeklyDeliveries.length}] : weeklyDeliveries);
  if (/FROM weekly_timesheet_delivery_versions/i.test(sql)) return result([]);
  if (/FROM staff_attendance/i.test(sql) && !/COUNT|SUM\(/i.test(sql)) return result(attendanceRows);
  if (/FROM rfqs/i.test(sql) && /WHERE id = \?/i.test(sql)) return result(rfqs.filter(row => row.id===Number(parameters[0]) && (!/archived = \?/i.test(sql) || row.archived===Number(parameters[1]))));
  if (/FROM rfqs/i.test(sql) && /GROUP BY/i.test(sql)) return result([{status:'pending',count:1},{status:'rejected',count:1}]);
  if (/FROM rfqs/i.test(sql) && /COUNT/i.test(sql)) return result([{ total:rfqs.filter(row=>row.archived===Number(parameters[0]||0)).length, total_rfqs:rfqs.filter(row=>!row.archived).length, pending_rfqs:rfqs.filter(row=>!row.archived&&row.status==='pending').length, approved_rfqs:0, closed_rfqs:0 }]);
  if (/^SELECT \* FROM rfqs/i.test(sql)) return result(rfqs.filter(row=>row.archived===Number(parameters[0]||0)));
  if (/FROM users/i.test(sql) && /WHERE (?:u\.)?id = \?/i.test(sql)) return result(users[parameters[0]] ? [users[parameters[0]]] : []);
  if (/FROM users/i.test(sql) && !/COUNT|SUM\(/i.test(sql)) return result(Object.values(users));
  if (/FROM invoice_items/i.test(sql)) return result([{ id:1, invoice_id:91, description:invoice.description, quantity:2, unit_price:50, amount:100 }]);
  if (/FROM invoice_payments|FROM invoice_activity|FROM email_queue|FROM email_logs/i.test(sql) && !/COUNT|SUM\(/i.test(sql)) return result([]);
  if (/FROM invoices/i.test(sql) && /rfq_id = \?/i.test(sql)) return result(parameters[0]===71 ? [invoice] : []);
  if (/FROM invoices/i.test(sql) && /GROUP BY/i.test(sql)) return result([]);
  if (/FROM invoices/i.test(sql) && !/COUNT|SUM\(/i.test(sql)) return result([invoice]);
  if (/FROM (?:company_)?settings/i.test(sql)) return result([]);
  if (/COUNT|SUM\(/i.test(sql)) {
    const aliases = [...sql.matchAll(/\bAS\s+([a-z_]+)/gi)].map(match=>match[1]);
    return result([{ total:0, count:0, unread:0, total_invoices:1, total_invoice_value:110, ...Object.fromEntries(aliases.map(alias=>[alias,0])) }]);
  }
  return result([]);
}
const connection = { query, execute:query, beginTransaction:async()=>{}, commit:async()=>{}, rollback:async()=>{}, release(){} };
const database = { ...connection, getConnection:async()=>connection, end:async()=>{} };
const originalLoad = Module._load;
function fixtureAuth(req,_res,next) { const key=req.headers['x-fixture-role']==='staff'?902:req.headers['x-fixture-role']==='client'?903:901; req.user={...users[key]}; req.session={id:'fixture-session',assurance_level:2}; next(); }
Module._load = function fixtureLoad(request,parent,isMain) {
  const target = request.startsWith('.') ? path.resolve(path.dirname(parent.filename),request) : request;
  if (target===path.join(root,'config/db') || target===path.join(root,'config/db.js')) return database;
  if (target===path.join(root,'middleware/auth') || target===path.join(root,'middleware/authMiddleware')) return fixtureAuth;
  if (target===path.join(root,'middleware/pageAuth')) return ()=>fixtureAuth;
  return originalLoad.apply(this,arguments);
};

async function run() {
  process.env.NODE_ENV='test'; process.env.RATE_LIMIT_STORE='memory'; process.env.RATE_LIMIT_MAX='100000';
  process.env.TIMESHEET_TIMEZONE='Australia/Sydney'; process.env.WEEKLY_TIMESHEET_EMAIL_TIMEZONE='Australia/Sydney';
  for (const key of ['SMTP_HOST','SMTP_USER','SMTP_PASS','SMTP_PASSWORD','MAIL_HOST','MAIL_USER','MAIL_PASS','RESEND_API_KEY']) delete process.env[key];
  let app;
  const server=http.createServer((req,res)=>app(req,res));
  await new Promise((resolve,reject)=>{ server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  const origin='http://127.0.0.1:'+server.address().port;
  process.env.ALLOWED_ORIGINS=origin; process.env.APP_URL=origin; process.env.APP_ORIGIN=origin;
  app=require('../app');
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser=await chromium.launch({ headless:true, ...(executablePath ? { executablePath } : {}), args:['--no-sandbox'], timeout:20000 });
  fs.mkdirSync(outputDir,{recursive:true});
  const evidence=[];
  const errors=[]; const apiCalls=[]; const apiResponses=[]; const apiResponseReads=[]; const browserErrors=[];
  let diagnosticPage;
  let stage='admin_dashboard';
  function observePage(page) {
    diagnosticPage=page;
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{ if(message.type()==='error')browserErrors.push(message.text()); });
    page.on('request',request=>{ if(new URL(request.url()).pathname.startsWith('/api/'))apiCalls.push(new URL(request.url()).pathname); });
    page.on('response',response=>{
      const url=new URL(response.url());
      if(!url.pathname.startsWith('/api/') || (response.status()<400 && !url.pathname.startsWith('/api/attendance/timesheets/weekly-deliveries') && !/^\/api\/invoice\/[0-9]+\/pdf$/.test(url.pathname) && url.pathname!=='/api/qr'))return;
      const contentType=response.headers()['content-type'] || '';
      const entry={path:url.pathname+url.search,status:response.status(),content_type:contentType,content_disposition:response.headers()['content-disposition'] || null};
      apiResponses.push(entry);
      apiResponseReads.push(/^(?:application\/pdf|image\/png)/i.test(contentType)
        ? response.body().then(body=>{entry.byte_length=body.length;entry.sha256=crypto.createHash('sha256').update(body).digest('hex');entry.signature=body.subarray(0,8).toString('hex');},error=>{entry.body_error=error.message;})
        : response.text().then(body=>{entry.body=body.slice(0,5000);},error=>{entry.body_error=error.message;}));
    });
  }
  try {
    const context=await browser.newContext({ viewport:{width:1366,height:900} });
    context.setDefaultTimeout(15000);
    await context.addInitScript(()=>{
      // Observe the exact preview Blob without fetching its URL: production
      // connect-src intentionally forbids blob requests while frame-src permits
      // this PDF preview. Blob.arrayBuffer() reads the already-held bytes.
      const createObjectURL=URL.createObjectURL.bind(URL);
      window.__fixturePdfBlobBuffers=new Map();
      URL.createObjectURL=function(blob){
        const url=createObjectURL(blob);
        if(blob instanceof Blob && blob.type==='application/pdf')window.__fixturePdfBlobBuffers.set(url,blob.arrayBuffer());
        return url;
      };
    });
    const page=await context.newPage();
    observePage(page);
    await page.goto(origin+'/dashboard');
    await page.waitForURL('**/admin*');
    await page.waitForFunction(()=>document.getElementById('adminInfo')?.textContent.includes('Admin fixture'));
    await page.waitForFunction(()=>!document.getElementById('vvGlobalBrandLoader')?.classList.contains('is-visible'));
    stage='settings_qr_renderer';
    await page.waitForFunction(()=>{const image=document.getElementById('qrPreviewImage');return image?.complete && image.naturalWidth>0;});
    const qrUrl=new URL(await page.locator('#qrPreviewImage').getAttribute('src'),origin);
    assert.equal(qrUrl.pathname,'/api/qr');
    assert.deepEqual([...qrUrl.searchParams.keys()],['data'],'the real settings QR renderer uses only the supported query contract');
    await Promise.allSettled(apiResponseReads);
    const qrResponse=apiResponses.find(response=>response.path===qrUrl.pathname+qrUrl.search && response.status===200);
    assert.ok(qrResponse,'the rendered QR image came from a successful real QR API response');
    assert.match(qrResponse.content_type,/^image\/png/i);
    assert.equal(qrResponse.signature,'89504e470d0a1a0a','QR response contains genuine PNG bytes');
    stage='admin_registers';
    for(const section of ['rfqSection','invoiceSection','customerSection','supplierSection','procurementSection','stockSection','rawMaterialSection','taskSection','attendanceSection','rosterSection','staffSection','competitorSection','complianceSection','companyFormsSection']) {
      await page.evaluate(id=>window.goSection(id),section);
      await page.locator('#'+section).waitFor({state:'visible'});
    }
    await page.evaluate(()=>window.goSection('customerSection'));
    await page.locator('#customerTableBody').getByText('Customer fixture',{exact:true}).waitFor();
    assert.equal(await page.locator('#customerTableBody svg[onload], #customerTableBody a[href^="javascript:"]').count(),0,'original customer loader escapes stored markup and omits unsafe file URLs');
    assert.equal(await page.locator('#customerTableBody').getByRole('link',{name:'Open file',exact:true}).count(),1,'only the safe customer file link is rendered');
    stage='invoice_approval_step_up';
    await page.evaluate(()=>window.goSection('invoiceSection'));
    const invoiceRow=page.locator('#invoiceTableBody tr').filter({hasText:'INV-TEST-0091'});
    await invoiceRow.waitFor();
    const [approvalResponse]=await Promise.all([
      page.waitForResponse(response=>new URL(response.url()).pathname==='/api/invoice/approve' && response.request().method()==='POST'),
      invoiceRow.getByRole('button',{name:'Approve',exact:true}).click()
    ]);
    assert.equal(approvalResponse.status(),403,'invoice approval retains the real recent-verification guard');
    assert.equal((await approvalResponse.json()).code,'STEP_UP_REQUIRED');
    await page.locator('#stepUpDialog').waitFor({state:'visible'});
    assert.equal(await page.locator('#stepUpAction').innerText(),'Approve Invoice');
    await page.locator('#stepUpDialog').getByRole('button',{name:'Cancel',exact:true}).click();
    await page.locator('#stepUpDialog').waitFor({state:'hidden'});
    assert.equal(invoice.status,'draft','cancelled security verification cannot approve the invoice');
    assert.equal(statements.filter(entry=>/^UPDATE invoices SET status/i.test(entry.sql)).length,0,'unverified invoice actions cannot mutate the fixture');
    await page.evaluate(()=>window.goSection('competitorSection'));
    await page.getByText('Safe linked fixture',{exact:true}).waitFor();
    assert.equal(await page.locator('#competitorSection img[src="x"]').count(),0,'stored markup renders as text');
    assert.equal(await page.locator('#competitorSection a[href^="javascript:"], #competitorSection a[href^="data:"]').count(),0,'historical unsafe competitor URLs are omitted');
    assert.equal(await page.getByRole('link',{name:'Website',exact:true}).count(),1,'only safe HTTP(S) website remains');
    assert.match(await page.getByRole('link',{name:'Website',exact:true}).getAttribute('rel'),/noopener/);
    await page.evaluate(()=>window.goSection('complianceSection'));
    await page.getByText('Safe guidance fixture',{exact:true}).waitFor();
    assert.equal(await page.locator('#complianceSection svg[onload], #complianceSection a[href^="javascript:"]').count(),0,'historical compliance markup/URLs cannot execute');
    assert.equal(await page.evaluate(()=>window.__storedXss),undefined,'stored fixture code never ran');
    const hostileRecordId = "fixture');window.__storedXss=6;//\"";
    await page.evaluate(recordId => {
      const form = COMPANY_FORMS.find(item => item.digital !== false);
      const formKey = companyFormKey(form);
      saveCompanyFormRecords([{ id:recordId,formKey,formTitle:form.title,values:{},updatedAt:'2026-10-10T10:00:00Z' }]);
      window.openCompanyFormEntries(formKey);
    },hostileRecordId);
    await page.locator('#dialogBody').getByRole('button',{name:'Edit',exact:true}).click();
    assert.equal(await page.locator('#companyDigitalRecordId').inputValue(),hostileRecordId,'stored document identifiers are passed as complete JSON arguments');
    assert.equal(await page.evaluate(()=>window.__storedXss),undefined,'stored document identifier cannot execute code');
    await page.locator('#dialogBackdrop').getByRole('button',{name:'Cancel',exact:true}).click();
    await page.evaluate(()=>localStorage.removeItem('voxelVedaCompanyFormRecordsV1'));
    assert.equal(await page.evaluate(()=>safeNotificationActionPath('/\\outside.example/')), '', 'notification URLs cannot escape origin through backslashes');
    await page.evaluate(()=>window.goSection('attendanceSection'));
    stage='weekly_delivery';
    // The staff cell also contains a nested staff-ID subline. Match the actual
    // delivery row rather than requiring the cell's combined text to be exact.
    try {
      await page.locator('#weeklyDeliveryBody tr').filter({hasText:'Staff fixture'}).waitFor();
    } catch(error) {
      await Promise.allSettled(apiResponseReads);
      const diagnostics={
        url:page.url(),
        weekly:await page.evaluate(()=>({
          body:document.getElementById('weeklyDeliveryBody')?.innerText || null,
          schedule:document.getElementById('weeklyDeliverySchedule')?.innerText || null,
          section_hidden:document.getElementById('attendanceSection')?.classList.contains('hidden-section'),
          state:window.weeklyDeliveryState || null,
          filters:Object.fromEntries(['weeklyDeliveryStaffSelect','weeklyDeliveryFrom','weeklyDeliveryTo','weeklyDeliveryStatus'].map(id=>[id,document.getElementById(id)?.value ?? null]))
        })),
        weekly_requests:apiCalls.filter(url=>url.includes('weekly-deliveries')),
        api_responses:apiResponses,
        browser_errors:browserErrors,
        uncaught_errors:errors,
        weekly_sql:statements.filter(entry=>/weekly_timesheet_deliver/i.test(entry.sql))
      };
      fs.writeFileSync(path.join(outputDir,'weekly-delivery-failure.json'),JSON.stringify(diagnostics,null,2));
      await page.screenshot({path:path.join(outputDir,'weekly-delivery-failure.png'),fullPage:true});
      console.error('Weekly delivery browser diagnostics: '+JSON.stringify(diagnostics));
      throw error;
    }
    assert.equal(await page.locator('#timesheetSendRecipient').count(),0,'weekly recipients cannot be overridden');
    assert.equal(await page.getByRole('button',{name:'Send Timesheet',exact:true}).count(),0,'legacy send form is removed');
    assert.equal(await page.locator('#timesheetReportStaffSelect').count(),1,'general report filters remain separate');
    await page.locator('#weeklyDeliveryBody').getByRole('button',{name:'Authorise revision',exact:true}).click();
    assert.equal(await page.locator('#weeklyPreviousDeliveryConfirmation').isChecked(),false,'uncertain prior delivery requires explicit fresh acknowledgement');
    await page.locator('#dialogBackdrop').getByRole('button',{name:'Cancel',exact:true}).click();
    await page.evaluate(()=>window.openAttendanceDialog(21));
    assert.equal(await page.locator('#attendanceClockIn').inputValue(),'2026-10-09T09:00','known UTC attendance uses company timezone independent of browser timezone');
    assert.equal(await page.locator('#attendanceBreakMinutes').inputValue(),'30');
    assert.match(await page.locator('#dialogBody').innerText(),/Australia\/Sydney/);
    await page.locator('#dialogBackdrop').getByRole('button',{name:'Cancel',exact:true}).click();
    await page.evaluate(()=>window.openAttendanceDialog(22));
    assert.equal(await page.locator('#attendanceClockIn').inputValue(),'2026-10-08T09:00','legacy NULL-basis attendance retains historical wall time');
    assert.match(await page.locator('#dialogBody').innerText(),/Historical timestamp basis is unverified/);
    await page.locator('#dialogBackdrop').getByRole('button',{name:'Cancel',exact:true}).click();
    await page.evaluate(()=>window.goSection('rfqSection'));
    stage='rfq_edit_history_archive_restore';
    await page.locator('#rfqTableBody').getByText('Restoration fixture',{exact:true}).waitFor();
    await page.locator('[data-register-search="rfqs"]').fill('Another');
    assert.equal(await page.locator('#rfqTableBody tr').count(),1);
    assert.match(await page.locator('#rfqTableBody').innerText(),/Another fixture/);
    await page.locator('[data-register-search="rfqs"]').fill('');
    await page.locator('#rfqTableBody tr').filter({hasText:'Restoration fixture'}).getByRole('button',{name:'Edit',exact:true}).click();
    await page.locator('#originalRfqEditForm [name="material"]').fill('Saved fixture material');
    await page.locator('#dialogPrimaryBtn').click();
    await page.locator('#dialogBackdrop').waitFor({state:'hidden'});
    await page.reload();
    await page.waitForFunction(()=>document.getElementById('adminInfo')?.textContent.includes('Admin fixture'));
    await page.evaluate(()=>window.goSection('rfqSection'));
    await page.locator('#rfqTableBody').getByText('Saved fixture material').waitFor();
    assert.equal(rfqs[0].material,'Saved fixture material','RFQ edits survive real page refresh against the same data fixture');
    await page.locator('#rfqTableBody tr').filter({hasText:'Restoration fixture'}).getByRole('button',{name:'View & History',exact:true}).click();
    await page.locator('#dialogBody').getByText('RFQ UPDATED',{exact:true}).waitFor();
    assert.match(await page.locator('#dialogBody').innerText(),/Admin fixture/);
    await page.locator('#dialogPrimaryBtn').click();
    await page.locator('#rfqTableBody tr').filter({hasText:'Restoration fixture'}).getByRole('button',{name:'Archive',exact:true}).click();
    await page.locator('#dialogPrimaryBtn').click();
    await page.locator('#dialogBackdrop').waitFor({state:'hidden'});
    assert.equal(rfqs[0].archived,1);
    await page.locator('#rfqArchivedFilter').check();
    await page.locator('#rfqTableBody').getByText('Restoration fixture',{exact:true}).waitFor();
    await page.locator('#rfqTableBody').getByRole('button',{name:'Restore',exact:true}).click();
    await page.locator('#dialogPrimaryBtn').click();
    await page.locator('#dialogBackdrop').waitFor({state:'hidden'});
    assert.equal(rfqs[0].archived,0);
    await page.locator('#rfqArchivedFilter').uncheck();
    await page.locator('#rfqTableBody').getByText('Restoration fixture',{exact:true}).waitFor();
    for(const [name,viewport] of Object.entries({phone_portrait:{width:390,height:844},phone_landscape:{width:844,height:390},tablet:{width:820,height:1180},desktop:{width:1440,height:900}})) {
      stage='responsive_layout_'+name;
      await page.setViewportSize(viewport);
      for(const mode of ['light','dark']) {
        await page.evaluate(value=>window.VoxelTheme.set(value),mode);
        assert.equal(await page.evaluate(()=>document.documentElement.dataset.colorMode),mode);
        await page.evaluate(()=>window.goSection('dashboardSection'));
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name}/${mode}: no horizontal page overflow`);
        assert.ok(await page.evaluate(()=>{
          const card=document.querySelector('.supplier-orbit-card');
          const parts=['.vv-payable-summary','.vv-chart-context','.vv-chart-empty','.vv-chart-data','.supplier-orbit-stats'].map(selector=>card?.querySelector(selector)).filter(Boolean).map(element=>element.getBoundingClientRect());
          return parts.every((rect,index)=>index===0 || parts[index-1].bottom<=rect.top+1);
        }),`${name}/${mode}: supplier summary, empty chart note and recorded values do not overlap`);
        assert.ok(await page.evaluate(()=>{
          const card=document.querySelector('.supplier-flow-card');
          const queue=document.querySelector('.supplier-queue-card');
          const rows=[...document.querySelectorAll('.supplier-flow-card .supplier-flow-row')];
          if(!card || !queue || !rows.length)return false;
          const bounds=card.getBoundingClientRect(),next=queue.getBoundingClientRect();
          const contained=rect=>rect.left>=bounds.left-1 && rect.right<=bounds.right+1 && rect.top>=bounds.top-1 && rect.bottom<=bounds.bottom+1;
          const elements=rows.flatMap(row=>[row,...row.querySelectorAll('.supplier-flow-label,.supplier-flow-money')]);
          const textRects=rows.flatMap(row=>[...row.querySelectorAll('.supplier-flow-label strong,.supplier-flow-label>span,.supplier-flow-money>span,.supplier-flow-money>strong')].flatMap(element=>{
            const range=document.createRange();range.selectNodeContents(element);return [...range.getClientRects()];
          }));
          const separate=bounds.right<=next.left+1 || next.right<=bounds.left+1 || bounds.bottom<=next.top+1 || next.bottom<=bounds.top+1;
          return separate && elements.every(element=>contained(element.getBoundingClientRect())) && textRects.every(contained);
        }),`${name}/${mode}: supplier category rows and text stay inside their card and clear the payment queue`);
        assert.equal(await page.locator('#supplierDebtChart').isVisible(),false,`${name}/${mode}: empty chart axes and legend are hidden`);
        assert.ok(await page.evaluate(()=>{
          const metadata=document.getElementById('adminInfo');
          const surface=metadata?.closest('.topbar');
          if(!metadata || !surface)return false;
          const channels=color=>color.match(/[0-9]+(?:\.[0-9]+)?/g)?.map(Number);
          const fg=channels(getComputedStyle(metadata).color),bg=channels(getComputedStyle(surface).backgroundColor);
          if(!fg || !bg || (bg[3] ?? 1)!==1)return false;
          const alpha=fg[3] ?? 1;
          const luminance=rgb=>rgb.slice(0,3).map(value=>{const s=value/255;return s<=0.04045?s/12.92:((s+0.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[0.2126,0.7152,0.0722][index],0);
          const foreground=luminance(fg.slice(0,3).map((value,index)=>value*alpha+bg[index]*(1-alpha))),background=luminance(bg);
          return (Math.max(foreground,background)+0.05)/(Math.min(foreground,background)+0.05)>=4.5;
        }),`${name}/${mode}: account metadata has readable contrast against its actual topbar surface`);
        assert.equal(await page.locator('.sidebar .logo-img').evaluate(img=>getComputedStyle(img).filter),'none');
        if(viewport.width<=1023) {
          await page.locator('.topbar-menu-btn').click();
          await page.locator('.sidebar').waitFor({state:'visible'});
          assert.ok(await page.locator('.sidebar').evaluate(sidebar=>sidebar.scrollHeight>=sidebar.clientHeight));
          await page.keyboard.press('Escape');
          assert.equal(await page.locator('.sidebar').getAttribute('aria-hidden'),'true');
        }
        const filename=`${name}-${mode}.png`;
        await page.screenshot({path:path.join(outputDir,filename),fullPage:true});
        evidence.push({viewport:name,mode,screenshot:filename});
      }
    }
    for(const retired of ['/finance-intelligence','/banking','/erp','/api/finance/intelligence/budgets','/api/erp-workspace/departments']) {
      const response=await page.request.get(origin+retired); assert.equal(response.status(),410,retired);
    }
    assert.ok(!apiCalls.some(url=>/^\/api\/(?:finance|banking|erp-workspace|erp)(?:\/|$)/.test(url)),'shared original services do not call retired modules');
    await page.setViewportSize({width:1366,height:900});
    stage='invoice_pdf';
    await page.goto(origin+'/invoice/view?id=91');
    await page.locator('#download:not([disabled])').waitFor();
    const [download] = await Promise.all([page.waitForEvent('download'),page.locator('#download').click()]);
    assert.match(download.suggestedFilename(),/\.pdf$/);
    const downloaded=fs.readFileSync(await download.path());
    const {validatePdf}=require('../services/documentPdfService');
    const validation=await validatePdf(downloaded,{expectedText:['INV-TEST-0091']});
    assert.ok(validation.pages>=1);
    await Promise.allSettled(apiResponseReads);
    const responsePdf=apiResponses.find(response=>response.path==='/api/invoice/91/pdf?download=1' && response.status===200);
    const downloadSha256=crypto.createHash('sha256').update(downloaded).digest('hex');
    assert.ok(responsePdf,'preview fetched the real invoice PDF route');
    assert.equal(downloadSha256,responsePdf.sha256,'download retains the exact parsed PDF response bytes');
    const previewSha256=await page.evaluate(async()=>{
      const url=document.getElementById('preview').getAttribute('src');
      const captured=window.__fixturePdfBlobBuffers.get(url);
      if(!captured)throw new Error('The actual PDF preview Blob was not observed.');
      const bytes=await captured;
      return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
    });
    assert.equal(previewSha256,downloadSha256,'preview and download share the same parsed PDF bytes');
    fs.writeFileSync(path.join(outputDir,download.suggestedFilename()),downloaded);
    assert.ok(await page.locator('#preview').getAttribute('src').then(value=>value.startsWith('blob:')),'preview uses exact validated download bytes');
    const staff=await browser.newContext({viewport:{width:390,height:844},extraHTTPHeaders:{'x-fixture-role':'staff'}});
    const staffPage=await staff.newPage(); observePage(staffPage); stage='staff_portal';
    await staffPage.goto(origin+'/dashboard'); await staffPage.waitForURL('**/portal/staff*');
    await staffPage.waitForFunction(()=>document.getElementById('staffInfo')?.textContent.includes('Staff fixture'));
    assert.ok(await staffPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'staff phone page has no horizontal overflow');
    assert.equal(await staffPage.locator('a[href*="finance-intelligence"]').count(),0);
    await staffPage.screenshot({path:path.join(outputDir,'staff-phone.png'),fullPage:true});
    stage='staff_qms';
    const [commandCentreResponse]=await Promise.all([
      staffPage.waitForResponse(response=>new URL(response.url()).pathname==='/api/qms/enterprise/command-centre'),
      staffPage.goto(origin+'/quality')
    ]);
    assert.equal(commandCentreResponse.status(),200,'authorised staff QMS command centre completes its real schema checks');
    assert.equal((await commandCentreResponse.json()).metrics.openNcr,1,'QMS metrics reflect the isolated open NCR');
    await staffPage.getByRole('heading',{name:'Quality Command Centre',exact:true}).waitFor();
    await staffPage.locator('#metricGrid .metric').filter({has:staffPage.getByText('Open NCR',{exact:true})}).locator('strong').getByText('1',{exact:true}).waitFor();
    const [ncrResponse]=await Promise.all([
      staffPage.waitForResponse(response=>new URL(response.url()).pathname==='/api/qms/ncrs'),
      staffPage.locator('[data-api="/api/qms/ncrs"]').click()
    ]);
    assert.equal(ncrResponse.status(),200,'authorised staff NCR register must return a successful real API response');
    assert.deepEqual((await ncrResponse.json()).ncrs,ncrs);
    await staffPage.waitForFunction(()=>document.getElementById('apiOutput')?.textContent !== 'Loading…');
    assert.match(await staffPage.locator('#apiOutput').innerText(),/NCR-FIXTURE-0101/,'the actual successful NCR response is rendered in the staff register');
    await staffPage.screenshot({path:path.join(outputDir,'staff-qms-phone.png'),fullPage:true});
    const client=await browser.newContext({viewport:{width:390,height:844},extraHTTPHeaders:{'x-fixture-role':'client'}});
    const clientPage=await client.newPage(); observePage(clientPage); stage='client_portal';
    await clientPage.goto(origin+'/dashboard'); await clientPage.waitForURL('**/client*');
    await clientPage.locator('#clientProfileName').getByText('Client fixture').waitFor();
    assert.ok(await clientPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'client phone page has no horizontal overflow');
    await clientPage.screenshot({path:path.join(outputDir,'client-phone.png'),fullPage:true});
    assert.deepEqual(errors,[],'restored browser workflows have no uncaught JavaScript errors');
    assert.ok(!statements.some(entry=>/FROM (?:finance_|banking_|erp_)/i.test(entry.sql)),'original reads never load retired schema');
    const checksum=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'public/logo.png'))).digest('hex');
    fs.writeFileSync(path.join(outputDir,'verification.json'),JSON.stringify({verified_at:new Date().toISOString(),route_graph:'real app.js',data:'isolated in-memory SQL fixture',viewports:evidence,rfq_edit_refresh_archive_restore:true,stored_xss_fixture:true,weekly_diagnostics_and_explicit_uncertain_confirmation:true,company_timezone_and_legacy_wall_time:true,staff_client_qms:true,staff_qms:{command_centre_status:commandCentreResponse.status(),ncr_status:ncrResponse.status(),rendered_ncr_no:ncrs[0].ncr_no},qr_renderer:{status:qrResponse.status,content_type:qrResponse.content_type,sha256:qrResponse.sha256,decoded_image:true},invoice_approval_step_up_retained:true,parser_valid_invoice_download:true,invoice_response_download_preview_sha256:downloadSha256,pdf_pages:validation.pages,logo_sha256:checksum,uncaught_errors:errors,retired_routes_checked:true,recipient_email_verification:false},null,2));
    console.log('Restored UI browser verification passed: real routes/assets, saved RFQ edit/history/archive/restore, light/dark phone/tablet/desktop layouts, staff/client portals, retired boundaries and parser-valid same-byte invoice preview/download. Evidence: '+outputDir);
  } catch(error) {
    await Promise.allSettled(apiResponseReads);
    const diagnostics={stage,error:error.message,url:diagnosticPage?.url(),api_responses:apiResponses,browser_errors:browserErrors,uncaught_errors:errors,
      page:diagnosticPage ? await diagnosticPage.evaluate(()=>({
        title:document.title,
        status:document.getElementById('status')?.textContent || null,
        download_disabled:document.getElementById('download')?.disabled ?? null,
        preview_hidden:document.getElementById('preview')?.hidden ?? null,
        preview_source:document.getElementById('preview')?.getAttribute('src') || null,
        staff_info:document.getElementById('staffInfo')?.textContent || null,
        client_name:document.getElementById('clientProfileName')?.textContent || null,
        api_output:document.getElementById('apiOutput')?.textContent?.slice(0,2000) || null,
        weekly_body:document.getElementById('weeklyDeliveryBody')?.innerText || null
      })).catch(pageError=>({capture_error:pageError.message})) : null,
      document_sql:statements.filter(entry=>/^SELECT/i.test(entry.sql) && /invoices|invoice_items|weekly_timesheet_deliver/i.test(entry.sql)).slice(-40)};
    fs.writeFileSync(path.join(outputDir,'failure.json'),JSON.stringify(diagnostics,null,2));
    if(diagnosticPage)await diagnosticPage.screenshot({path:path.join(outputDir,'failure.png'),fullPage:true}).catch(()=>{});
    console.error('Restored browser failure diagnostics: '+JSON.stringify(diagnostics));
    throw error;
  } finally {
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
    Module._load=originalLoad;
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
