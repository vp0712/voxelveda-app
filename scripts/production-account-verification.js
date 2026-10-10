'use strict';
// Read-only production evidence: never creates accounts, sessions or business data.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {retiredRequest,retiredAsset}=require('../services/applicationRetirement');
const {chromium}=require(process.env.VV_BROWSER_MODULE_PATH || 'playwright');
const origin='https://app.voxelveda.com';
const expected=process.env.VV_EXPECTED_COMMIT;
assert.match(expected||'',/^[a-f0-9]{40}$/,'An exact deployed commit is required');
const out=process.env.VV_PROOF_DIR || path.resolve('production-proof');
fs.mkdirSync(out,{recursive:true});
const proof={origin,expected_commit:expected,started_at:new Date().toISOString(),access:'Public pages and anonymous security boundaries only. No production identity was impersonated.',checks:[]};
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
 const health=await getJson('/api/health');assert.equal(health.status,200);
 proof.ready=ready;proof.health=health;
 const retired=['/finance','/finance/reports/RPT_d2bbc70-ab0e-4f40-aa02-18fe722beab1/view','/api/finance/accounts','/api/banking/accounts','/api/erp/dashboard','/api/invoice','/api/stock','/api/public/rfq','/request-quote','/customer.html','/customer.js'];
 for(const route of retired){const response=await fetch(origin+route,{signal:AbortSignal.timeout(15000)});assert.equal(response.status,410,route+' must be retired');const body=await response.text();assert.ok(!body.includes('account_number')&&!body.includes('transaction_amount'),'No archived records returned');proof.checks.push({route,status:410});}
 for(const route of ['/dashboard','/profile','/security','/workspace.html']){
  const response=await fetch(origin+route,{redirect:'follow',signal:AbortSignal.timeout(15000)});const final=new URL(response.url);assert.equal(final.pathname,'/login',route+' requires login');assert.ok(final.searchParams.get('returnTo')||final.searchParams.get('next'),'Login preserves destination');proof.checks.push({route,login_redirect:final.pathname,return_to:final.searchParams.get('returnTo')||final.searchParams.get('next')});
 }
 const register=await fetch(origin+'/api/auth/customer-register',{method:'POST',headers:{'Content-Type':'application/json','Origin':origin},body:'{}',signal:AbortSignal.timeout(15000)});
 assert.equal(register.status,400,'Invalid registration is rejected without creating an account');proof.checks.push({route:'/api/auth/customer-register',invalid_empty_input:400});
 const worker=await fetch(origin+'/service-worker.js');assert.equal(worker.status,200);assert.match(await worker.text(),/voxel-veda-public-v5-navy-blue/);proof.checks.push({service_worker:'v5-navy-blue'});
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const viewport of [{name:'phone',width:375,height:812},{name:'phone-landscape',width:812,height:375},{name:'tablet',width:768,height:1024},{name:'desktop',width:1440,height:1000}]){
   const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height}});const page=await context.newPage();const errors=[],assetFailures=[];
   // Intentional retired-document HTTP410 is checked below. Asset errors are never allowed.
   page.on('response',response=>{const request=response.request();if(['script','stylesheet','image','font'].includes(request.resourceType())&&response.status()>=400)assetFailures.push({url:response.url(),status:response.status(),type:request.resourceType()});});
   page.on('requestfailed',request=>{if(['script','stylesheet','image','font'].includes(request.resourceType()))assetFailures.push({url:request.url(),error:request.failure()?.errorText||'Request failed',type:request.resourceType()});});
   page.on('pageerror',error=>errors.push(error.message));
   for(const route of ['/','/login','/register','/support']){
    const response=await page.goto(origin+route,{waitUntil:'domcontentloaded'});assert.equal(response.status(),200,route);
    await page.getByRole('heading',{level:1}).waitFor({state:'visible'});
    await page.waitForFunction(()=>document.readyState==='complete'&&[...document.images].every(img=>img.complete&&img.naturalWidth>0)&&(!document.fonts||document.fonts.status==='loaded'));
    await page.locator('#vvGlobalBrandLoader').waitFor({state:'hidden'});
    const layout=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,heading:document.querySelector('h1')?.textContent,brokenImages:[...document.images].filter(img=>!img.complete||img.naturalWidth===0).map(img=>img.src),links:[...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href'))}));
    assert.ok(layout.scroll<=layout.client,viewport.name+' '+route+' must not overflow');assert.deepEqual(layout.brokenImages,[]);assert.ok(layout.heading);
    assert.ok(layout.links.every(link=>{const destination=new URL(link,page.url());return destination.origin!==origin||(!retiredRequest(destination.pathname)&&!retiredAsset(destination.pathname));}),'Navigation has no retired destinations');
    assert.deepEqual(assetFailures,[],'All production scripts, styles, images and fonts load successfully');
    const label=route==='/'?'home':route.slice(1);await page.screenshot({path:path.join(out,'live-'+label+'-'+viewport.name+'.png'),fullPage:true});
    proof.checks.push({viewport,route,heading:layout.heading,overflow:false,broken_images:[],asset_failures:[]});
   }
   const retiredResponse=await page.goto(origin+'/finance',{waitUntil:'domcontentloaded'});assert.equal(retiredResponse.status(),410);await page.waitForFunction(()=>document.readyState==='complete'&&[...document.images].every(img=>img.complete&&img.naturalWidth>0));await page.getByRole('heading',{name:'This module is no longer available'}).waitFor();await page.locator('#vvGlobalBrandLoader').waitFor({state:'hidden'});
   if(viewport.name==='phone'||viewport.name==='desktop')await page.screenshot({path:path.join(out,'live-retired-'+viewport.name+'.png'),fullPage:true});
   assert.deepEqual(errors,[],'No page JavaScript errors');
   assert.deepEqual(assetFailures,[],'Retired landing page assets also load successfully');await context.close();
  }
 }finally{await browser.close();}

 for(const filename of ["live-home-phone.png", "live-home-desktop.png"]){console.log('VV_SCREENSHOT '+JSON.stringify({filename,mime_type:'image/png',base64:fs.readFileSync(path.join(out,filename)).toString('base64')}));}
 proof.completed_at=new Date().toISOString();proof.result='passed';
}
main().catch(error=>{proof.result='failed';proof.error=error.message;console.error(error);process.exitCode=1;}).finally(()=>{fs.writeFileSync(path.join(out,'production-verification.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({result:proof.result,expected_commit:expected,checks:proof.checks.length}));});
