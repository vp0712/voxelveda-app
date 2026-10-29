'use strict';
// Actual retained pages/components with cookie-authenticated synthetic records.
// No production account, security action, attendance record or email is used.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),jwt=require('jsonwebtoken');
const fixtures=require('./staff-mobile-browser-test');
const engines=require(process.env.VV_BROWSER_MODULE_PATH||'playwright');
const engine=process.env.VV_CONTENT_BROWSER_ENGINE||'chromium';assert(['chromium','webkit'].includes(engine));
const root=path.resolve(__dirname,'..'),out=process.env.UI_PROOF_DIR||'/tmp/voxelveda-content-proof';fs.mkdirSync(out,{recursive:true});
const actor={id:9951,name:'Synthetic Content Reviewer With A Long Recorded Name',username:'synthetic.content',email:'synthetic.content.reviewer@example.invalid',role:'admin',active:1,account_status:'ACTIVE',session_version:1,mfa_enabled:1,permissions:[]};fixtures.identities.set(actor.id,actor);
const rfqs=[{id:801,customer_name:'Synthetic engineering customer with a long authorised record name',email:'long.synthetic.customer.reference@example.invalid',material:'Recorded polymer material',quantity:'1.250',status:'pending'},{id:802,customer_name:'Synthetic customer two',email:'synthetic.two@example.invalid',material:'Recorded tooling material',quantity:'25',status:'approved'}];
const job={job:{id:901,job_no:'SYNTHETIC-JOB-1',part_no:'LONG-PART-REFERENCE-ONLY-FOR-RELEASE-VERIFICATION',part_description:'Recorded synthetic production component',quantity:0,status:'IN_PRODUCTION',priority:'NORMAL',due_date:'2026-11-02'},operations:[],materials:[{id:930,lot_no:'SYNTHETIC-LOT-1',material_code:'SYNTHETIC-MAT',grade:null,release_status:'RELEASED',quantity_allocated:0,quantity_consumed:0}],builds:[],holds:[]};
const freshSessions=()=>[{id:'current-fixture',current:true,user_agent:'Synthetic current device',last_seen_at:'2026-10-29T09:00:00Z'},{id:'other-fixture',current:false,user_agent:'Synthetic secondary device with a long recorded reference that must wrap',last_seen_at:'2026-10-28T09:00:00Z'}];
function token(){const value=jwt.sign({id:actor.id},process.env.JWT_SECRET,{expiresIn:'1h',jwtid:crypto.randomUUID()});fixtures.sessions.set(crypto.createHash('sha256').update(value).digest('hex'),{id:'content-fixture',user_id:actor.id,session_version:1,assurance_level:2});return value;}
function contrast(a,b){const lum=s=>(s.match(/[\d.]+/g)||[]).slice(0,3).map(Number).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((v,n,i)=>v+n*[.2126,.7152,.0722][i],0);const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
async function server(directory){
 const brand=require(path.resolve(directory,'..','services/globalBrandRenderer.js'));
 const state={sessions:freshSessions(),failSessions:false,sessionReads:0,writes:0,revoked:false};
 const instance=await fixtures.makeServer(directory,fs.readFileSync(path.join(root,'public/logo.png')),async(app,{auth,pageAuth})=>{
  for(const [url,file]of Object.entries({'/admin':'admin-dashboard.html','/profile':'profile.html','/security':'security.html','/quality':'quality.html','/shop-floor':'shop-floor.html'}))app.get(url,pageAuth(),(_req,res)=>res.type('html').send(brand.injectGlobalBrand(fs.readFileSync(path.join(directory,file),'utf8'))));
  app.get('/api/profile',auth,(_req,res)=>res.json({profile:{...actor,has_profile_photo:false,profile_photo_url:null,profile_photo_revision:null,mobile_number:null,timesheet_delivery_email:null}}));
  app.get('/api/rfq',auth,(_req,res)=>res.json({rfqs,total:rfqs.length}));
  app.get('/api/health',(_req,res)=>res.json({status:'ok'}));
  app.get('/api/qms/enterprise/command-centre',auth,(_req,res)=>res.json({metrics:{openNcr:2,openCapa:1,qualityHolds:0,overdueCalibration:0}}));
  app.get('/api/qms/registers',auth,(_req,res)=>res.json({registers:[],capabilities:{}}));
  app.get('/api/qms/enterprise/recall/material/:id',auth,(req,res)=>res.json({material_lot_id:req.params.id,jobs:[{job_no:'SYNTHETIC-JOB-1'}]}));
  app.get('/api/qms/enterprise/shop-floor/jobs/:id',auth,(_req,res)=>res.json(job));
  app.get('/api/qms/enterprise/shop-floor/machines/:id',auth,(_req,res)=>res.json({machine:{id:920,equipment_code:'SYNTHETIC-MACHINE-1',description:'Recorded synthetic machine',status:'READY',commissioned:1,critical_safety_issue:0},allowed:false,reasons:['Synthetic maintenance review required'],maintenance:[{id:1,plan_name:'Recorded maintenance plan',next_due_date:'2026-11-02',blocking_when_overdue:1,active:1}],faults:[],loto:[]}));
  app.get('/api/qms/enterprise/shop-floor/materials/:id',auth,(_req,res)=>res.json({lot:{id:930,lot_no:'SYNTHETIC-LOT-1',material_code:'SYNTHETIC-MAT',quantity_received:0,quantity_available:0,unit:'kg',release_status:'RELEASED'},usable:true,genealogy:[],holds:[]}));
  app.get('/api/auth/mfa/status',auth,(_req,res)=>state.revoked?res.status(401).json({message:'Synthetic session revoked after MFA confirmation'}):res.json({enabled:false,required:true,recovery_codes_remaining:0}));
  app.get('/api/auth/sessions',auth,(_req,res)=>{state.sessionReads++;if(state.revoked)return res.status(401).json({message:'Synthetic session revoked'});if(state.failSessions){state.failSessions=false;return res.status(503).json({message:'Synthetic register interruption'});}return res.json({sessions:state.sessions});});
  app.post('/api/auth/sessions/revoke-others',auth,async(_req,res)=>{state.writes++;await new Promise(resolve=>setTimeout(resolve,150));state.sessions=state.sessions.filter(s=>s.current);state.failSessions=true;res.json({message:'Synthetic accepted sign-out'});});
  app.post('/api/auth/change-password',auth,async(_req,res)=>{state.writes++;await new Promise(resolve=>setTimeout(resolve,150));res.status(422).json({message:'Saved successfully is only fixture wording; the validation request failed.'});});
  app.post('/api/auth/mfa/enroll/start',auth,(_req,res)=>{state.writes++;const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',manual=Array.from(crypto.randomBytes(20),n=>alphabet[n%32]).join('');res.json({manual_key:manual,qr_code:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='});});
  app.post('/api/auth/mfa/enroll/confirm',auth,(_req,res)=>{state.writes++;state.revoked=true;res.json({recovery_codes:[crypto.randomUUID(),crypto.randomUUID()]});});
 });
 return {...instance,contentState:state};
}
async function open(page,origin,kind){
 const routes={rfqs:'/admin?view=rfqs',profile:'/profile',security:'/security',quality:'/quality',shop:'/shop-floor?type=job&id=SYNTHETIC-JOB-1'};
 await page.goto(origin+routes[kind],{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.body.dataset.vvShell==='business-hub');
 // Use the retained application's real deep-link startup path. Calling
 // goSection before loadMe finishes races its authorised default selection in
 // WebKit and can hide an otherwise loaded register during baseline capture.
 if(kind==='rfqs'){await page.locator('#rfqSection').waitFor({state:'visible'});await page.getByText(rfqs[0].customer_name,{exact:true}).waitFor();}
 if(kind==='profile')await page.waitForFunction(()=>document.getElementById('name').value.length>0);
 if(kind==='security')await page.getByText('Required for your role — setup must be completed now.',{exact:true}).waitFor();
 if(kind==='quality')await page.waitForFunction(()=>document.querySelectorAll('#metricGrid .metric').length===4);
 if(kind==='shop')await page.waitForFunction(()=>document.getElementById('recordOutput').textContent.includes('SYNTHETIC-JOB-1'));
 // Wait for the existing fade-out too; removing is-visible precedes its 160ms
 // visibility transition and otherwise leaves a ghost loader in screenshots.
 await page.waitForFunction(()=>{const node=document.getElementById('vvGlobalBrandLoader');if(!node)return true;const style=getComputedStyle(node);return !node.classList.contains('is-visible')&&style.visibility==='hidden'&&Number(style.opacity)===0;});
}
(async()=>{
 let candidate,baseline,browser,activePage;const proof={engine,fixtureOnly:true,physicalDevice:false,cases:[],beforeScreenshots:[],actions:[]};
 try{
  candidate=await server(path.join(root,'public'));
  if(process.env.CONTENT_BASELINE_DIR)baseline=await server(path.resolve(process.env.CONTENT_BASELINE_DIR));
  browser=await engines[engine].launch({headless:true,args:engine==='chromium'?['--no-sandbox']:[]});
  if(baseline)for(const width of [390,1440])for(const theme of ['light','dark']){
   const context=await browser.newContext({viewport:{width,height:900}});await context.addInitScript(({actor,theme})=>{localStorage.setItem('user',JSON.stringify(actor));localStorage.setItem('voxelveda:color-mode',theme);},{actor,theme});await context.addCookies([{name:'vv_session',value:token(),url:baseline.origin,httpOnly:true,sameSite:'Lax'}]);const page=await context.newPage();
   activePage=page;for(const kind of ['rfqs','profile','security','quality','shop']){await open(page,baseline.origin,kind);const filename=`before-${engine}-${kind}-${width}-${theme}.png`;await page.screenshot({path:path.join(out,filename),fullPage:false});proof.beforeScreenshots.push(filename);}await context.close();
  }
  for(const width of [320,360,390,430,768,1024,1440])for(const theme of ['light','dark']){
   // Each visual comparison starts with the same saved fixture records. The
   // explicit sign-out scenario below must not mutate later width/theme cases.
   candidate.contentState.sessions=freshSessions();candidate.contentState.failSessions=false;candidate.contentState.revoked=false;
   const context=await browser.newContext({viewport:{width,height:900}});await context.addInitScript(({actor,theme})=>{localStorage.setItem('user',JSON.stringify(actor));localStorage.setItem('voxelveda:color-mode',theme);},{actor,theme});await context.addCookies([{name:'vv_session',value:token(),url:candidate.origin,httpOnly:true,sameSite:'Lax'}]);const page=await context.newPage();activePage=page;const errors=[];page.on('pageerror',e=>errors.push(e.message));
   for(const kind of ['rfqs','profile','security','quality','shop']){
    candidate.contentState.revoked=false;await open(page,candidate.origin,kind);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),kind+' fits '+width+'/'+theme);
    assert.equal(await page.locator('.sidebar').count(),1,'Content never adds a competing navigation');
    if(kind==='rfqs'){
     for(const [id,label]of [['rfqCustomerName','Customer name'],['rfqEmail','Customer email'],['rfqQuantity','Quantity'],['taskDueDate','Due date'],['taskAssignedTo','Assigned staff']])assert(await page.locator('#'+id).evaluate((input,label)=>[...input.labels].some(node=>node.querySelector(':scope > span')?.textContent.trim()===label),label),'Existing field keeps its exact visible label: '+id);
     const missing=await page.evaluate(()=>[...document.querySelectorAll('.page-section:not(#dashboardSection) .form-grid>input,.page-section:not(#dashboardSection) .form-grid>select,.page-section:not(#dashboardSection) .form-grid>textarea')].filter(input=>!['hidden','checkbox','radio'].includes(input.type)).map(input=>input.id));assert.deepEqual(missing,[],'Non-home admin form-grid fields retain visible associated labels');
     const staffMissing=await page.evaluate(html=>[...new DOMParser().parseFromString(html,'text/html').querySelectorAll('.page-section:not(#dashboardSection) .form-grid>input,.page-section:not(#dashboardSection) .form-grid>select,.page-section:not(#dashboardSection) .form-grid>textarea')].filter(input=>!['hidden','checkbox','radio'].includes(input.type)).map(input=>input.id),fs.readFileSync(path.join(root,'public/staff-dashboard.html'),'utf8'));assert.deepEqual(staffMissing,[],'Existing staff form-grid source has the same label components');
     assert.equal(await page.locator('#rfqTableBody>tr').count(),2);
    }
    if(kind==='security'){assert.equal(await page.locator('.hub-security-grid>.hub-security-card').count(),2);assert.match(await page.locator('#sessionsStatus').textContent(),/active sessions/);const style=await page.locator('.hub-security-card h2').first().evaluate(n=>({color:getComputedStyle(n).color,background:getComputedStyle(n.closest('.hub-security-card')).backgroundColor}));assert(contrast(style.color,style.background)>=4.5,'Security heading contrast');}
    if(kind==='quality'){assert.equal(await page.getByLabel('Material lot ID',{exact:true}).getAttribute('id'),'materialLotId');await page.getByLabel('Material lot ID',{exact:true}).fill('930');await page.locator('#recallBtn').click();await page.waitForFunction(()=>document.getElementById('impactResult').textContent.includes('SYNTHETIC-JOB-1'));}
    if(kind==='shop'){assert.equal(await page.getByLabel('Record type',{exact:true}).getAttribute('id'),'entityType');assert.equal(await page.getByLabel('Record reference',{exact:true}).getAttribute('id'),'entityId');assert.equal(await page.locator('#recordOutput>dl').count(),1);assert.equal(await page.locator('#recordOutput pre').count(),0);assert.match(await page.locator('#recordOutput').textContent(),/Quantity0/);assert(!/"created_by"|\[object Object\]/.test(await page.locator('#recordOutput').textContent()));}
    const fields=page.locator('.hub-companion-content input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]),.page-section:not(#dashboardSection):not(.hidden-section) input:not([type=checkbox]):not([type=radio]),.hub-companion-content select');
    for(const field of await fields.all()){if(!await field.isVisible()||await field.evaluate(n=>Boolean(n.closest('table'))))continue;const b=await field.boundingBox();assert(b.height>=44&&b.x>=-1&&b.x+b.width<=width+1,'Reachable content control '+kind+'/'+width);}
    if([390,1440].includes(width))await page.screenshot({path:path.join(out,`after-${engine}-${kind}-${width}-${theme}.png`),fullPage:false});proof.cases.push({kind,width,theme,noPageOverflow:true,existingSidebarCount:1,actualControlsAndRecords:true});
   }
   if(width===390&&theme==='light'){
    await open(page,candidate.origin,'security');candidate.contentState.failSessions=true;await page.locator('#refreshSecurityBtn').click();await page.locator('#retrySessionsBtn').waitFor({state:'visible'});assert.match(await page.locator('#sessionsStatus').textContent(),/Refresh failed/);await page.locator('#retrySessionsBtn').click();await page.waitForFunction(()=>document.getElementById('sessionsStatus').textContent==='2 active sessions.');
    await page.locator('#currentPassword').fill('Synthetic entered current value');await page.locator('#newPassword').fill('Synthetic entered new value');const before=candidate.contentState.writes;await page.locator('#changePasswordForm').evaluate(form=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});await page.getByRole('alertdialog',{name:'Security action not confirmed',exact:true}).waitFor();assert.equal(candidate.contentState.writes,before+1);assert.equal(await page.locator('#newPassword').inputValue(),'Synthetic entered new value');assert.equal(await page.locator('#status').getAttribute('role'),'alert');await page.getByRole('button',{name:'Return to form',exact:true}).click();
    const writes=candidate.contentState.writes;await page.locator('#revokeOthers').evaluate(button=>{button.click();button.click();});await page.locator('#retrySessionsBtn').waitFor({state:'visible'});assert.equal(candidate.contentState.writes,writes+1);assert.match(await page.locator('#status').textContent(),/were signed out/);assert.match(await page.locator('#sessionsStatus').textContent(),/Refresh failed/);await page.locator('#retrySessionsBtn').click();await page.waitForFunction(()=>document.getElementById('sessionsStatus').textContent==='1 active session.');
    await page.locator('#mfaPassword').fill('Synthetic current input');await page.locator('#mfaStartForm').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));await page.locator('#mfaSetup').waitFor({state:'visible'});await page.locator('#mfaConfirmCode').fill('123456');const reads=candidate.contentState.sessionReads;await page.locator('#mfaConfirmForm').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));await page.locator('#newRecovery').waitFor({state:'visible'});await page.waitForTimeout(200);assert.equal(new URL(page.url()).pathname,'/security');assert.equal(candidate.contentState.sessionReads,reads);assert.equal(await page.locator('#newRecoveryCodes').evaluate(n=>n.textContent.split('\n').length),2);assert(await page.locator('#mfaConfirmForm').evaluate(form=>form.nativeHasUnsavedChanges()));await page.locator('#recoveryContinue').click();await page.waitForURL('**/login?returnTo=%2Fsecurity');candidate.contentState.revoked=false;
    proof.actions.push('Visible retry without false empty state; duplicate security taps; explicit HTTP failure preserves values despite success wording; committed sign-out survives failed refresh; one-time recovery codes persist after real-session revocation until explicit internal sign-in.');
    await open(page,candidate.origin,'shop');await page.getByLabel('Record type',{exact:true}).selectOption('machine');await page.getByLabel('Record reference',{exact:true}).fill('SYNTHETIC-MACHINE-1');await page.locator('#openBtn').click();await page.getByRole('heading',{name:'Machine · SYNTHETIC-MACHINE-1',exact:true}).waitFor();await page.waitForFunction(()=>document.getElementById('recordOutput').textContent.includes('Recorded maintenance plan'));assert.match(await page.locator('#recordOutput').textContent(),/Recorded synthetic machine/);assert.match(await page.locator('#recordOutput').textContent(),/Synthetic maintenance review required/);await page.getByLabel('Record type',{exact:true}).selectOption('material');await page.getByLabel('Record reference',{exact:true}).fill('SYNTHETIC-LOT-1');await page.locator('#openBtn').click();await page.waitForFunction(()=>document.getElementById('recordOutput').textContent.includes('Available quantity'));assert.match(await page.locator('#recordOutput').textContent(),/Available quantity0/);
    await page.setViewportSize({width:844,height:390});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await open(page,candidate.origin,'security');await page.setViewportSize({width:390,height:390});await page.locator('#newPassword').focus();await page.locator('#changePasswordForm button').scrollIntoViewIfNeeded();const b=await page.locator('#changePasswordForm button').boundingBox();assert(b.y>=0&&b.y+b.height<=391,'Short keyboard-like viewport keeps the action reachable');proof.actions.push('Actual machine/material fields and zero values; landscape and short keyboard-like viewport. Physical keyboards/cameras remain untested.');
   }
   assert.deepEqual(errors,[]);await context.close();
  }
  proof.result='passed';fs.writeFileSync(path.join(out,'business-hub-content.json'),JSON.stringify(proof,null,2));console.log('Business Hub content browser passed: '+engine+', '+proof.cases.length+' populated page/width/theme cases, preserved sidebar count, field labels, security retry/commit states and readable production records.');
 }catch(e){if(activePage&&!activePage.isClosed())await activePage.screenshot({path:path.join(out,'failure.png'),fullPage:false}).catch(()=>{});fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({message:e.message,stack:e.stack,completedCases:proof.cases.length},null,2));throw e;}
 finally{await browser?.close();for(const fixture of [candidate,baseline])if(fixture)await new Promise(resolve=>{fixture.server.close(resolve);fixture.server.closeAllConnections?.();});}
})().catch(e=>{console.error(e);process.exitCode=1;});
