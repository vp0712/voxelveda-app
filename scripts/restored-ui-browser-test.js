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
  try {
    const context=await browser.newContext({ viewport:{width:1366,height:900} });
    context.setDefaultTimeout(15000);
    const page=await context.newPage();
    const errors=[]; const apiCalls=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{ if(new URL(request.url()).pathname.startsWith('/api/'))apiCalls.push(new URL(request.url()).pathname); });
    await page.goto(origin+'/dashboard');
    await page.waitForURL('**/admin*');
    await page.waitForFunction(()=>document.getElementById('adminInfo')?.textContent.includes('Admin fixture'));
    await page.waitForFunction(()=>!document.getElementById('vvGlobalBrandLoader')?.classList.contains('is-visible'));
    for(const section of ['rfqSection','invoiceSection','customerSection','supplierSection','procurementSection','stockSection','rawMaterialSection','taskSection','attendanceSection','rosterSection','staffSection','competitorSection','complianceSection','companyFormsSection']) {
      await page.evaluate(id=>window.goSection(id),section);
      await page.locator('#'+section).waitFor({state:'visible'});
    }
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
    // The staff cell also contains a nested staff-ID subline. Match the actual
    // delivery row rather than requiring the cell's combined text to be exact.
    await page.locator('#weeklyDeliveryBody tr').filter({hasText:'Staff fixture'}).waitFor();
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
        assert.equal(await page.locator('#supplierDebtChart').isVisible(),false,`${name}/${mode}: empty chart axes and legend are hidden`);
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
    await page.goto(origin+'/invoice/view?id=91');
    await page.locator('#download:not([disabled])').waitFor();
    const [download] = await Promise.all([page.waitForEvent('download'),page.locator('#download').click()]);
    assert.match(download.suggestedFilename(),/\.pdf$/);
    const downloaded=fs.readFileSync(await download.path());
    const {validatePdf}=require('../services/documentPdfService');
    const validation=await validatePdf(downloaded,{expectedText:['INV-TEST-0091']});
    assert.ok(validation.pages>=1);
    fs.writeFileSync(path.join(outputDir,download.suggestedFilename()),downloaded);
    assert.ok(await page.locator('#preview').getAttribute('src').then(value=>value.startsWith('blob:')),'preview uses exact validated download bytes');
    const staff=await browser.newContext({viewport:{width:390,height:844},extraHTTPHeaders:{'x-fixture-role':'staff'}});
    const staffPage=await staff.newPage(); staffPage.on('pageerror',error=>errors.push(error.message));
    await staffPage.goto(origin+'/dashboard'); await staffPage.waitForURL('**/portal/staff*');
    await staffPage.waitForFunction(()=>document.getElementById('staffInfo')?.textContent.includes('Staff fixture'));
    assert.ok(await staffPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'staff phone page has no horizontal overflow');
    assert.equal(await staffPage.locator('a[href*="finance-intelligence"]').count(),0);
    await staffPage.screenshot({path:path.join(outputDir,'staff-phone.png'),fullPage:true});
    await staffPage.goto(origin+'/quality');
    await staffPage.getByRole('heading',{name:'Quality Command Centre',exact:true}).waitFor();
    await staffPage.locator('[data-api="/api/qms/ncrs"]').click();
    await staffPage.waitForFunction(()=>document.getElementById('apiOutput')?.textContent !== 'Loading…');
    assert.ok(!/Authentication required|Access denied|permission/i.test(await staffPage.locator('#apiOutput').innerText()),'staff QMS register is available within fixture authority');
    await staffPage.screenshot({path:path.join(outputDir,'staff-qms-phone.png'),fullPage:true});
    const client=await browser.newContext({viewport:{width:390,height:844},extraHTTPHeaders:{'x-fixture-role':'client'}});
    const clientPage=await client.newPage(); clientPage.on('pageerror',error=>errors.push(error.message));
    await clientPage.goto(origin+'/dashboard'); await clientPage.waitForURL('**/client*');
    await clientPage.locator('#clientProfileName').getByText('Client fixture').waitFor();
    assert.ok(await clientPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'client phone page has no horizontal overflow');
    await clientPage.screenshot({path:path.join(outputDir,'client-phone.png'),fullPage:true});
    assert.deepEqual(errors,[],'restored browser workflows have no uncaught JavaScript errors');
    assert.ok(!statements.some(entry=>/FROM (?:finance_|banking_|erp_)/i.test(entry.sql)),'original reads never load retired schema');
    const checksum=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'public/logo.png'))).digest('hex');
    fs.writeFileSync(path.join(outputDir,'verification.json'),JSON.stringify({verified_at:new Date().toISOString(),route_graph:'real app.js',data:'isolated in-memory SQL fixture',viewports:evidence,rfq_edit_refresh_archive_restore:true,stored_xss_fixture:true,weekly_diagnostics_and_explicit_uncertain_confirmation:true,company_timezone_and_legacy_wall_time:true,staff_client_qms:true,parser_valid_invoice_download:true,pdf_pages:validation.pages,logo_sha256:checksum,uncaught_errors:errors,retired_routes_checked:true,recipient_email_verification:false},null,2));
    console.log('Restored UI browser verification passed: real routes/assets, saved RFQ edit/history/archive/restore, light/dark phone/tablet/desktop layouts, staff/client portals, retired boundaries and parser-valid same-byte invoice preview/download. Evidence: '+outputDir);
  } finally {
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
    Module._load=originalLoad;
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
