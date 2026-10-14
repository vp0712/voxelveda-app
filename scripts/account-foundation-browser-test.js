'use strict';
const fs=require('node:fs'),path=require('node:path');
const assert=require('node:assert/strict');
const express=require('express');
const {chromium}=require(process.env.VV_BROWSER_MODULE_PATH || 'playwright');
const {injectGlobalBrand}=require('../services/globalBrandRenderer');
const project=path.resolve(__dirname,'..');
const out=process.env.VV_PROOF_DIR || path.join(project,'account-foundation-proof');fs.mkdirSync(out,{recursive:true});
const app=express();app.use(express.json());
app.get('/api/auth/me',(req,res)=>res.json({user:{id:1,name:'Ana Fixture',email:'ana@example.invalid',role:'viewer'}}));
app.get('/api/profile',(req,res)=>res.json({profile:{id:1,name:'Ana Fixture',email:'ana@example.invalid',username:'ana.fixture',role:'viewer',active:true,account_status:'ACTIVE',has_profile_photo:false,profile_photo_url:null,profile_photo_revision:null,mobile_number:null,timesheet_delivery_email:null}}));
app.get('/api/notifications/preferences',(req,res)=>res.json({preferences:[]}));
app.get('/api/auth/mfa/status',(req,res)=>res.json({enabled:false,required:false,recovery_codes_remaining:0,assurance_level:1}));
app.get('/api/auth/sessions',(req,res)=>res.json({sessions:[{id:1,current:true,user_agent:'Local browser fixture',last_seen_at:'2026-10-09T12:00:00Z'}]}));
app.post('/api/auth/logout',(req,res)=>res.json({message:'Signed out'}));
for(const [route,file] of Object.entries({'/dashboard':'workspace.html','/profile':'profile.html','/security':'security.html','/':'index.html','/login':'login.html','/register':'register.html','/forgot-password':'forgot-password.html','/reset-password':'reset-password.html','/support':'support.html'})) app.get(route,(req,res)=>res.type('html').send(injectGlobalBrand(fs.readFileSync(path.join(project,'public',file),'utf8'))));
app.use(express.static(path.join(project,'public')));
(async()=>{
 const server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
 const base='http://127.0.0.1:'+server.address().port;
 let browser;
 const results=[];
 try {
  browser=await chromium.launch({executablePath:process.env.VV_BROWSER_EXECUTABLE || undefined,headless:true,args:['--no-sandbox']});
  for(const view of [{name:'phone',width:320,height:844},...[360,390,430,768,1024].map(width=>({name:'width-'+width,width,height:844})),{name:'phone-landscape',width:844,height:390},{name:'desktop',width:1440,height:1000}]){
   const context=await browser.newContext({viewport:{width:view.width,height:view.height}});
   const page=await context.newPage();const errors=[],apiCalls=[],assetFailures=[];
   page.on('response',response=>{const request=response.request();if(['script','stylesheet','image','font'].includes(request.resourceType())&&response.status()>=400)assetFailures.push({url:response.url(),status:response.status(),type:request.resourceType()});});
   page.on('requestfailed',request=>{if(['script','stylesheet','image','font'].includes(request.resourceType()))assetFailures.push({url:request.url(),error:request.failure()?.errorText||'Request failed',type:request.resourceType()});});
   page.on('pageerror',err=>errors.push(err.message));page.on('request',req=>{const url=new URL(req.url());if(url.pathname.startsWith('/api/'))apiCalls.push(url.pathname);});
   const inspectLayout=async(label)=>{await page.waitForTimeout(200);const dim=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));assert.ok(dim.scroll<=dim.client,view.name+' '+label+' overflow');};
   await page.goto(base+'/dashboard',{waitUntil:'networkidle'});
   await page.getByRole('heading',{name:'Welcome, Ana Fixture'}).waitFor();
   assert.equal(await page.locator('#profileEmail').textContent(),'ana@example.invalid');
   assert.equal(await page.locator('form').count(),0,'workspace has no retired business form');
   await inspectLayout('account');await page.screenshot({path:path.join(out,'local-account-'+view.name+'.png'),fullPage:true});
   await page.getByRole('link',{name:'Manage your profile'}).click();await page.waitForURL('**/profile');
   await page.waitForFunction(()=>document.querySelector('#displayName').textContent==='Ana Fixture');
   assert.equal(await page.locator('#department,#employeeNumber').count(),0,'profile does not expose ERP employment fields');
   await inspectLayout('profile');
   if(view.name==='phone'||view.name==='desktop')await page.screenshot({path:path.join(out,'local-profile-'+view.name+'.png'),fullPage:true});
   await page.getByRole('link',{name:'← Workspace'}).click();await page.getByRole('heading',{name:'Welcome, Ana Fixture'}).waitFor();
   await page.getByRole('link',{name:'Open security settings'}).click();await page.waitForURL('**/security');await page.getByText('Not enabled — strongly recommended.').waitFor();
   await inspectLayout('security');
   if(view.name==='phone'||view.name==='desktop')await page.screenshot({path:path.join(out,'local-security-'+view.name+'.png'),fullPage:true});
   await page.getByRole('link',{name:'Return to workspace'}).click();await page.getByRole('heading',{name:'Welcome, Ana Fixture'}).waitFor();
   await page.reload({waitUntil:'networkidle'});await page.getByRole('heading',{name:'Welcome, Ana Fixture'}).waitFor();
   if(view.name==='phone'){
    await page.locator('[data-theme-toggle]').click();assert.equal(await page.locator('html').getAttribute('data-color-mode'),'dark');
    await page.screenshot({path:path.join(out,'local-account-phone-dark.png'),fullPage:true});
   }
   assert.deepEqual(errors,[]);
   assert.deepEqual(assetFailures,[],'All retained scripts, styles, images and fonts load successfully');
   assert.ok(apiCalls.every(api=>['/api/auth/me','/api/profile','/api/auth/mfa/status','/api/auth/sessions','/api/notifications/preferences'].includes(api)),'Only retained account and personal notification-settings APIs are called');
   const publicLayouts=[];
   await page.route('**/api/auth/me',route=>route.fulfill({status:401,contentType:'application/json',body:'{"message":"Login required"}'}));
   for(const theme of ['light','dark'])for(const route of ['/','/login','/register','/forgot-password','/reset-password']){
    await page.evaluate(mode=>localStorage.setItem('voxelveda:color-mode',mode),theme);
    await page.goto(base+route,{waitUntil:'networkidle'});await page.getByRole('heading',{level:1}).waitFor();await inspectLayout(route+' '+theme);
    if(route==='/')assert.deepEqual(await page.locator('a[href]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href'))),['/login','/register','/privacy','/terms']);
    for(const input of await page.locator('input:not([type="hidden"]):visible,button:visible').all()){const box=await input.boundingBox();assert(box.x>=0&&box.x+box.width<=view.width+1,'Public form controls fit the viewport');}
    publicLayouts.push({route,theme,overflow:false});
   }
   assert.deepEqual(errors,[]);assert.deepEqual(assetFailures,[]);
   results.push({viewport:view,overflow:false,pageErrors:errors,assetFailures,identity:true,profileNavigation:true,securityNavigation:true,refresh:true,publicLayouts,apiCalls,fixtureOnly:true});await context.close();
  }

 for(const filename of ["local-account-phone.png", "local-account-desktop.png"]){console.log('VV_SCREENSHOT '+JSON.stringify({filename,mime_type:'image/png',base64:fs.readFileSync(path.join(out,filename)).toString('base64')}));}
  fs.writeFileSync(path.join(out,'local-browser.json'),JSON.stringify({source:'Actual retained account assets with local fixture identity/profile/security endpoints. No production authentication, account writes, financial cards or business workflows.',results},null,2));
  console.log(JSON.stringify(results,null,2));
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(err=>{console.error(err);process.exitCode=1;});
