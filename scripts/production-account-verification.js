'use strict';
// Read-only production evidence: never creates accounts, sessions or business data.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {retiredRequest,retiredAsset}=require('../services/applicationRetirement');
const {validatePdf}=require('../services/documentPdfService');
const {chromium}=require(process.env.VV_BROWSER_MODULE_PATH || 'playwright');
const origin='https://app.voxelveda.com';
const expected=process.env.VV_EXPECTED_COMMIT;
assert.match(expected||'',/^[a-f0-9]{40}$/,'An exact deployed commit is required');
const out=process.env.VV_PROOF_DIR || path.resolve('production-proof');
fs.mkdirSync(out,{recursive:true});
const proof={origin,expected_commit:expected,started_at:new Date().toISOString(),access:'Public pages and anonymous security boundaries only. No production identity was impersonated.',checks:[],browser_navigation:[]};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function getJson(route){const response=await fetch(origin+route,{signal:AbortSignal.timeout(15000),headers:{'Cache-Control':'no-cache'}});return {status:response.status,body:await response.json()};}
async function main(){
 const deadline=Date.now()+12*60*1000;
 let ready;
 while(Date.now()<deadline){
  try{ready=await getJson('/api/ready');if(ready.status===200&&ready.body.ready===true&&ready.body.deployment_sha===expected)break;}catch{}
  await pause(10000);
 }
 assert.equal(ready?.body?.deployment_sha,expected,'Production must run this release, not an older healthy deployment');
 assert.equal(ready.status,200);assert.equal(ready.body.ready,true);
 assert.equal(ready.body.critical_services?.procurement_import_worker,'OPERATIONAL','Durable procurement extraction worker must be registered and running');
 assert.equal(ready.body.critical_services?.weekly_timesheet_worker,'OPERATIONAL','Worked-only weekly scheduler must be registered and running');
 const health=await getJson('/api/health');assert.equal(health.status,200);
 proof.ready=ready;proof.health=health;
 const liveQr=await getJson('/api/public/shift-qr');assert.equal(liveQr.status,401,'Gate issuance requires an authorised display or administrator session');
 proof.checks.push({route:'/api/public/shift-qr',status:401,gate_issuance_not_public:true,authenticated_live_attendance_unverified:true});

 const displayPage=await fetch(origin+'/attendance-display/',{redirect:'manual'});assert.equal(displayPage.status,200);assert.equal(displayPage.headers.get('referrer-policy'),'no-referrer');assert.equal(displayPage.headers.get('content-security-policy-report-only'),null);const displayHtml=await displayPage.text();assert.ok(!displayHtml.includes('/login')&&!displayHtml.includes('global-brand-loader'));assert.equal((await getJson('/attendance-display/current')).status,403);assert.equal((await getJson('/api/attendance/display-links')).status,401);proof.checks.push({route:'/attendance-display/',status:200,no_login_redirect:true,no_account_required:true,credential_required_for_qr:true,private_management_unauthenticated_status:401});
 const retired=['/finance','/banking','/erp','/erp-workspace','/finance/reports/RPT_d2bbc70-ab0e-4f40-aa02-18fe722beab1/view','/api/finance/accounts','/api/banking/accounts','/api/erp/dashboard','/erp-workspace.js','/banking.js'];
 for(const route of retired){const response=await fetch(origin+route,{signal:AbortSignal.timeout(15000)});assert.equal(response.status,410,route+' must be retired');const body=await response.text();assert.ok(!body.includes('account_number')&&!body.includes('transaction_amount'),'No archived records returned');proof.checks.push({route,status:410});}
 for(const route of ['/dashboard','/profile','/security','/workspace.html','/admin','/client','/portal/staff','/quality','/shop-floor','/careers-admin','/employee-id','/invoice/view','/attendance-terminal','/a?t=invalid','/document/view']){
  const response=await fetch(origin+route,{redirect:'follow',signal:AbortSignal.timeout(15000)});const final=new URL(response.url);assert.equal(final.pathname,'/login',route+' requires login');assert.ok(final.searchParams.get('returnTo')||final.searchParams.get('next'),'Login preserves destination');proof.checks.push({route,login_redirect:final.pathname,return_to:final.searchParams.get('returnTo')||final.searchParams.get('next')});
 }
 for(const route of ['/api/rfq','/api/invoice','/api/stock','/api/materials','/api/suppliers','/api/attendance','/api/roster','/api/tasks','/api/qms/dashboard','/api/procurement/overview','/api/procurement/imports','/api/procurement/entries','/api/procurement/reports/snapshots/00000000-0000-4000-8000-000000000001','/api/email/documents/1']){
  const response=await fetch(origin+route,{signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,401,route+' is restored and still requires an authenticated session');
  proof.checks.push({route,status:401,restored_authentication_boundary:true});
 }
 const vacancies=await getJson('/api/public/careers/jobs');assert.equal(vacancies.status,200);assert.ok(Array.isArray(vacancies.body.jobs),'Original public careers API must return its real vacancy list');proof.checks.push({route:'/api/public/careers/jobs',status:200});
 for(const route of ['/api/profile','/api/profile/photo','/api/profile/staff/1/photo','/api/notifications','/api/notifications/unread-count','/api/attendance/today','/api/attendance/my','/api/attendance/reconcile','/api/attendance/corrections','/api/attendance/timesheets/week/pdf?week_start=2026-10-19','/api/attendance/timesheets/weekly-deliveries','/api/attendance/timesheets/weekly-deliveries/146']){
  const response=await fetch(origin+route,{signal:AbortSignal.timeout(15000)});assert.equal(response.status,401,route+' retains authentication');proof.checks.push({route,status:401,staff_mobile_authentication_boundary:true});
 }
 for(const name of ['attendance-live-clock.js','workspace-dialog.js','workspace-dialog.css','android-app.js','login.js','mfa.js','staff-home.js','staff-home.css','staff-timesheet-view.js','attendance-scanner.js','staff.js','admin-dashboard.js','profile.js','workflow-ui.js','weekly-delivery.js','workspace-theme.css','profile-avatar.js','dashboard-profile-avatar.js','notification-center.js','notification-center.css','workspace-overlays.js','compact-header.css','workspace-theme.js','role-portal.js','shift-qr-terminal.js','attendance-gate.css','entry-home.css','portal-profile-menu.js','client-portal.js','admin-home.css','responsive-foundation.css','responsive-foundation.js','document-reader.css','pdf-reader.mjs','document-preview.js','invoice-preview.js','invoice-detail.js','invoice-detail.css','workspace-dialog.js','workspace-dialog.css','step-up.js','step-up.css','operations-ui.js','global-brand.js','global-brand.css','business-hub.css','business-hub-shell.js']){
  const response=await fetch(origin+'/'+name,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(15000)});assert.equal(response.status,200,name+' is deployed');
  const bytes=Buffer.from(await response.arrayBuffer()),digest=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
  assert.equal(digest(bytes),digest(fs.readFileSync(path.join(__dirname,'../public',name))),name+' matches exact release bytes');
  assert.match(response.headers.get('cache-control')||'',/no-store/i,name+' cannot retain stale private-workflow code');proof.checks.push({asset:name,status:200,sha256:digest(bytes),exact_release_bytes:true});
 }
 const legacyOrigin='https://voxelveda-app-production.up.railway.app';
 for(const route of ['/','/login?returnTo=%2Fportal%2Fstaff','/profile','/a?t=invalid']){
  const response=await fetch(legacyOrigin+route,{redirect:'manual',signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,308);assert.equal(response.headers.get('location'),origin+route);proof.checks.push({legacy_route:route,status:308,canonical_destination:origin+route});
 }
 for(const route of ['/api/health','/api/ready']){const response=await fetch(legacyOrigin+route,{redirect:'manual',signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);proof.checks.push({legacy_probe:route,status:200});}
 const legacyWrite=await fetch(legacyOrigin+'/api/auth/login',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
 assert.equal(legacyWrite.status,409);assert.equal((await legacyWrite.json()).code,'CANONICAL_ORIGIN_REQUIRED');proof.checks.push({legacy_write:409,credentials_not_forwarded:true});
 const association=await fetch(origin+'/.well-known/assetlinks.json',{signal:AbortSignal.timeout(15000)});const associationBody=await association.json();
 assert.ok([200,503].includes(association.status));assert.ok(Array.isArray(associationBody));if(association.status===503)assert.deepEqual(associationBody,[]);
 proof.checks.push({android_association_status:association.status,configured:association.status===200,play_identity_verification:'Requires the actual Play App Signing certificate and installed distribution'});
 const rejectedRfq=await fetch(origin+'/api/public/rfq',{method:'POST',headers:{'Content-Type':'application/json','Origin':origin},body:'{}',signal:AbortSignal.timeout(15000)});
 assert.equal(rejectedRfq.status,400,'Invalid public RFQ fails validation without creating business records');proof.checks.push({route:'/api/public/rfq',invalid_empty_input:400});
 for(const download of ['', '?download=1']){
  const route='/forms/company/quality-inspection-release-certificate.pdf'+download;
  const response=await fetch(origin+route,{signal:AbortSignal.timeout(20000)});
  assert.equal(response.status,200);assert.match(response.headers.get('content-type')||'',/^application\/pdf(?:;|$)/);
  assert.match(response.headers.get('content-disposition')||'',/filename="[A-Za-z0-9._ -]+\.pdf"/);
  assert.match(response.headers.get('content-disposition')||'',download?/^attachment;/i:/^inline;/i);
  const bytes=Buffer.from(await response.arrayBuffer()),validation=await validatePdf(bytes);
  proof.checks.push({route,status:200,content_type:'application/pdf',filename:'quality-inspection-release-certificate.pdf',pages:validation.pages,bytes:bytes.length,sha256:validation.sha256});
  fs.writeFileSync(path.join(out,'live-company-form.pdf'),bytes);
 }
 const register=await fetch(origin+'/api/auth/customer-register',{method:'POST',headers:{'Content-Type':'application/json','Origin':origin},body:'{}',signal:AbortSignal.timeout(15000)});
 assert.equal(register.status,400,'Invalid registration is rejected without creating an account');proof.checks.push({route:'/api/auth/customer-register',invalid_empty_input:400});
 const worker=await fetch(origin+'/service-worker.js');assert.equal(worker.status,200);assert.match(await worker.text(),/voxel-veda-public-v6-restored-20261011/);proof.checks.push({service_worker:'v6-restored-20261011'});
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const mode of ['light','dark'])for(const viewport of [...[320,360,390,430,768,1024,1440].map(width=>({name:'width-'+width,width,height:844})),{name:'phone-landscape',width:844,height:390}]){
   const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},colorScheme:mode});const page=await context.newPage();const errors=[],assetFailures=[];
   await context.addInitScript(value=>localStorage.setItem('voxelveda:color-mode',value),mode);
   // Intentional retired-document HTTP410 is checked below. Asset errors are never allowed.
   page.on('response',response=>{const request=response.request();if(['script','stylesheet','image','font'].includes(request.resourceType())&&response.status()>=400)assetFailures.push({url:response.url(),status:response.status(),type:request.resourceType()});});
   page.on('requestfailed',request=>{if(['script','stylesheet','image','font'].includes(request.resourceType()))assetFailures.push({url:request.url(),error:request.failure()?.errorText||'Request failed',type:request.resourceType()});});
   page.on('pageerror',error=>errors.push(error.message));
   const waitForSettledPage=async()=>{
    await page.getByRole('heading',{level:1}).waitFor({state:'visible'});
    await page.waitForFunction(()=>document.readyState==='complete'&&[...document.images].every(img=>img.complete&&img.naturalWidth>0)&&(!document.fonts||document.fonts.status==='loaded'));
    await page.locator('#vvGlobalBrandLoader').waitFor({state:'hidden'});
   };
   for(const route of ['/','/login','/register','/forgot-password','/reset-password','/support','/request-quote','/careers']){
    const response=await page.goto(origin+route,{waitUntil:'domcontentloaded'});assert.equal(response.status(),200,route);
    await waitForSettledPage();
    const refreshed=await page.reload({waitUntil:'domcontentloaded'});assert.equal(refreshed.status(),200,route+' remains available after refresh');
    await waitForSettledPage();
    const layout=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,heading:document.querySelector('h1')?.textContent,brokenImages:[...document.images].filter(img=>!img.complete||img.naturalWidth===0).map(img=>img.src),links:[...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href'))}));
    assert.ok(layout.scroll<=layout.client,viewport.name+' '+route+' must not overflow');assert.deepEqual(layout.brokenImages,[]);assert.ok(layout.heading);
    assert.ok(layout.links.every(link=>{const destination=new URL(link,page.url());return destination.origin!==origin||(!retiredRequest(destination.pathname)&&!retiredAsset(destination.pathname));}),'Navigation has no retired destinations');
    assert.deepEqual(assetFailures,[],'All production scripts, styles, images and fonts load successfully');
    const label=route==='/'?'home':route.slice(1);await page.screenshot({path:path.join(out,'live-'+label+'-'+viewport.name+'-'+mode+'.png'),fullPage:true});
    proof.checks.push({viewport,mode,route,heading:layout.heading,overflow:false,broken_images:[],asset_failures:[],refresh:true});
   }
   await page.goto(origin+'/support',{waitUntil:'domcontentloaded'});await waitForSettledPage();
   await page.goto(origin+'/login',{waitUntil:'domcontentloaded'});await waitForSettledPage();
   await page.goBack({waitUntil:'domcontentloaded'});await waitForSettledPage();assert.equal(new URL(page.url()).pathname,'/support','Browser Back retains the previous public page');
   await page.goForward({waitUntil:'domcontentloaded'});await waitForSettledPage();assert.equal(new URL(page.url()).pathname,'/login','Browser Forward restores the intended page');
   proof.browser_navigation.push({viewport,mode,back:'/support',forward:'/login',passed:true});
   const retiredResponse=await page.goto(origin+'/finance',{waitUntil:'domcontentloaded'});assert.equal(retiredResponse.status(),410);await page.waitForFunction(()=>document.readyState==='complete'&&[...document.images].every(img=>img.complete&&img.naturalWidth>0));await page.getByRole('heading',{name:'This module is no longer available'}).waitFor();await page.locator('#vvGlobalBrandLoader').waitFor({state:'hidden'});
   if(viewport.width===390||viewport.width===1440)await page.screenshot({path:path.join(out,'live-retired-'+viewport.name+'-'+mode+'.png'),fullPage:true});
   assert.deepEqual(errors,[],'No page JavaScript errors');
   assert.deepEqual(assetFailures,[],'Retired landing page assets also load successfully');await context.close();
  }
 }finally{await browser.close();}

 proof.completed_at=new Date().toISOString();proof.result='passed';
}
main().catch(error=>{proof.result='failed';proof.error=error.message;console.error(error);process.exitCode=1;}).finally(()=>{fs.writeFileSync(path.join(out,'production-verification.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({result:proof.result,expected_commit:expected,checks:proof.checks.length}));});
