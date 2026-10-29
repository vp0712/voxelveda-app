'use strict';
// Compare the explicitly approved CURRENT sidebar with the candidate. All
// accounts, sessions and API records are synthetic; no production identity or
// business record is read. Content/header changes are deliberately outside the
// visual fingerprint. This is browser emulation, not a physical-device claim.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const baselineCommit = process.env.SIDEBAR_BASELINE_COMMIT || '4c01274945edcf15cf0394076602a8df4c00e884';
assert.match(baselineCommit, /^[a-f0-9]{40}$/, 'Use an exact captured production commit.');
process.env.VV_STAFF_BASELINE_REF = baselineCommit;
const fixture = require('./staff-mobile-browser-test');
const jwt = require('jsonwebtoken');
const { chromium } = require(process.env.VV_BROWSER_MODULE_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const baseline = process.env.SIDEBAR_BASELINE_DIR;
assert(baseline && fs.existsSync(path.join(baseline, 'public/admin-dashboard.html')), 'SIDEBAR_BASELINE_DIR must contain the exact current public assets and renderer Git archive.');
const out = process.env.SIDEBAR_PROOF_DIR || '/tmp/voxelveda-sidebar-preservation';
fs.mkdirSync(out, { recursive: true });
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const allRoles = ['staff','hr','manager','supervisor','production','sales','admin','super_admin','finance_admin','finance_user','accountant','viewer','view_only','client','customer'];
const allWidths = [320,360,390,430,768,1024,1440];
const roles = process.env.SIDEBAR_PROOF_ROLES ? process.env.SIDEBAR_PROOF_ROLES.split(',') : allRoles;
const widths = process.env.SIDEBAR_PROOF_WIDTHS ? process.env.SIDEBAR_PROOF_WIDTHS.split(',').map(Number) : allWidths;
assert(roles.length && roles.every(role => allRoles.includes(role)), 'Choose retained roles only.');
assert(widths.length && widths.every(width => allWidths.includes(width)), 'Choose supported preservation widths only.');
const clients = ['viewer','view_only','client','customer'];
const admins = ['admin','super_admin','finance_admin','finance_user','accountant'];
for (const [index, role] of allRoles.entries()) fixture.identities.set(9700 + index, {
  id:9700+index, name:'Synthetic Sidebar '+role, username:'sidebar.'+role, email:role+'@example.invalid', role,
  active:1, account_status:'ACTIVE', session_version:1, mfa_enabled:admins.includes(role)?1:0,
  permissions:clients.includes(role)?['VIEW_RFQS','VIEW_FINANCE']:[]
});
function token(role) {
  const id = 9700 + allRoles.indexOf(role);
  const value = jwt.sign({id}, process.env.JWT_SECRET, {expiresIn:'1h',jwtid:crypto.randomUUID()});
  fixture.sessions.set(digest(value), {id:'sidebar-'+id,user_id:id,session_version:1,assurance_level:2});
  return value;
}
const companions = {'/client':'client-portal.html','/account':'workspace.html','/profile':'profile.html','/security':'security.html','/quality':'quality.html','/shop-floor':'shop-floor.html','/careers-admin':'careers-admin.html','/employee-id':'employee-id.html','/invoice/view':'invoice-pdf.html'};
const phases = ['before','after'];
const directories = {before:baseline,after:root};
const proof = {fixtureOnly:true,physicalDevice:false,baseline_commit:baselineCommit,widths,roles,cases:[],companion_cases:[],sample_snapshots:[],coverage:'Sidebar DOM, labels/icons/hierarchy, computed presentation and geometry, permissions, selected/expanded/search states, scrolling and mobile drawer dismissal/focus. Main content/header presentation is intentionally not compared.'};
let activePage,activeCase,activeState;
function sidebarMarkup(filename) {
  const html = fs.readFileSync(filename, 'utf8');
  const match = html.match(/<aside\b[^>]*class="[^"]*\bsidebar\b[^"]*"[^>]*>[\s\S]*?<\/aside>/i);
  assert(match, filename+' contains the retained sidebar.');
  return match[0].replace(/\s+/g, ' ').trim();
}
function sourceProof() {
  const sidebarScript = 'public/business-hub-shell.js';
  proof.sidebar_script = {before:digest(fs.readFileSync(path.join(baseline,sidebarScript))),after:digest(fs.readFileSync(path.join(root,sidebarScript)))};
  assert.equal(proof.sidebar_script.after,proof.sidebar_script.before,'Current sidebar rendering/navigation script is preserved.');
  proof.sidebar_markup = {};
  for (const file of ['admin-dashboard.html','staff-dashboard.html']) {
    const before = sidebarMarkup(path.join(baseline,'public',file)), after = sidebarMarkup(path.join(root,'public',file));
    assert.equal(after,before,file+' keeps its current sidebar markup, groups, labels and handlers.');
    proof.sidebar_markup[file] = digest(before);
  }
  const logo = fs.readFileSync(path.join(root,'public/logo.png'));
  assert.equal(digest(logo),digest(fs.readFileSync(path.join(baseline,'public/logo.png'))),'Original logo remains unchanged.');
  proof.logo_sha256 = digest(logo);
}
async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) await Promise.all(sidebar.getAnimations({subtree:true}).filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  });
}
async function ready(page) {
  // Account/security pages deliberately keep identity in their own state rather
  // than writing the legacy localStorage cache used by dashboard bootstraps.
  // Verify the actual cookie-authenticated owner, then wait for that cache only
  // on the three portals whose current bootstrap contract uses it.
  const identity=await page.request.get(new URL('/api/auth/me',page.url()).href);
  assert.equal(identity.status(),200,'The synthetic page uses a real authorised cookie session.');
  assert.equal(Number((await identity.json()).user.id),page._preservationActorId,'The fixture owner is the intended role identity.');
  await page.waitForFunction(() => document.body.dataset.vvShell==='business-hub' && document.querySelectorAll('.sidebar').length===1);
  if(['/admin','/portal/staff','/client'].includes(new URL(page.url()).pathname))await page.waitForFunction(id=>Number(JSON.parse(localStorage.getItem('user')||'{}').id)===id,page._preservationActorId);
  await page.waitForFunction(() => !document.getElementById('vvGlobalBrandLoader')?.classList.contains('is-visible'));
  await page.waitForFunction(() => !document.querySelector('.sidebar')?.textContent.includes('Loading...'));
  await settle(page);
}
async function collect(page) {
  await page.mouse.move(page.viewportSize().width-2,page.viewportSize().height-2);
  await settle(page);
  return page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar');
    const round = value => Math.round(value*1000)/1000;
    const rect = node => {const value=node.getBoundingClientRect();return {x:round(value.x),y:round(value.y),width:round(value.width),height:round(value.height)};};
    const props=['display','position','visibility','opacity','z-index','box-sizing','width','min-width','max-width','height','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-right','margin-bottom','margin-left','background-color','background-image','color','font-family','font-size','font-weight','font-style','line-height','letter-spacing','text-transform','border-top','border-right','border-bottom','border-left','border-radius','box-shadow','gap','flex-direction','align-items','justify-content','overflow-x','overflow-y','transform','fill','stroke','stroke-width','filter'];
    const style=node=>Object.fromEntries(props.map(property=>[property,getComputedStyle(node).getPropertyValue(property)]));
    const href = node => {const value=node.getAttribute('href');if(!value)return null;const url=new URL(value,location.href);return url.origin===location.origin?url.pathname+url.search+url.hash:value;};
    const selector = '.brand,.logo-img,.staff-sidebar-profile,.sidebar-nav,.nav-section-label,.nav-group,.nav-group-toggle,.nav-submenu,.nav-btn,.logout-btn,.sidebar-close,.workspace-nav-search,.portal-nav-search,input,.sidebar-footer,.hub-nav-icon';
    const rootRect=rect(sidebar);
    const nodes=[...sidebar.querySelectorAll(selector)].map(node=>({
      tag:node.tagName,id:node.id,classes:[...node.classList].sort(),section:node.dataset.section||null,title:node.getAttribute('data-title'),label:node.getAttribute('aria-label'),expanded:node.getAttribute('aria-expanded'),current:node.getAttribute('aria-current'),hidden:node.hidden,open:node.tagName==='DETAILS'?node.open:null,href:href(node),text:node.textContent.replace(/\s+/g,' ').trim(),value:node.tagName==='INPUT'?node.value:null,
      ancestor_groups:[...function*(item){while(item&&item!==sidebar){if(item.tagName==='DETAILS')yield item.querySelector('summary')?.textContent.replace(/\s+/g,' ').trim();item=item.parentElement;}}(node.parentElement)],
      visible:Boolean(node.getClientRects().length)&&getComputedStyle(node).display!=='none',rect:rect(node),style:style(node),icon:node.matches('svg')?{viewBox:node.getAttribute('viewBox'),paths:[...node.querySelectorAll('path')].map(path=>path.getAttribute('d'))}:null
    }));
    const nav=sidebar.querySelector('.sidebar-nav');
    const backdrops=[...document.querySelectorAll('.mobile-sidebar-backdrop,.hub-companion-backdrop')].map(node=>({classes:[...node.classList].sort(),hidden:node.hidden,aria_hidden:node.getAttribute('aria-hidden'),rect:rect(node),style:style(node)}));
    return {sidebar_count:document.querySelectorAll('.sidebar').length,root:{rect:rootRect,style:style(sidebar)},nodes,backdrops,scroll:{top:nav?.scrollTop||0,height:nav?.scrollHeight||0,client:nav?.clientHeight||0},visible_count:nodes.filter(node=>node.visible&&node.classes.includes('nav-btn')).length,permission_leaks:[...sidebar.querySelectorAll('[hidden],.hidden-section')].filter(node=>getComputedStyle(node).display!=='none').map(node=>node.textContent.trim())};
  });
}
function compare(before,after,caseInfo,state) {
  try { assert.deepEqual(after,before,'Current sidebar preserved: '+JSON.stringify(caseInfo)+' '+state); }
  catch(error) {fs.writeFileSync(path.join(out,'mismatch.json'),JSON.stringify({case:caseInfo,state,before,after},null,2));throw error;}
  return {state,before_sha256:digest(JSON.stringify(before)),after_sha256:digest(JSON.stringify(after)),visible_items:after.visible_count};
}
function toggle(page,companion) {return companion?page.getByRole('button',{name:'Open workspace menu',exact:true}):page.locator('.topbar-menu-btn');}
async function menuOpened(page) {
  activeState='menu-open';
  await page.locator('.sidebar .sidebar-close:visible').waitFor();
  const companion=await page.locator('.sidebar').evaluate(node=>node.classList.contains('hub-companion-sidebar'));
  // The retained workforce/admin drawer intentionally focuses its first link
  // after 80 ms. Observe that real callback before measuring scroll or closing;
  // otherwise one phase may capture before focus scrolls and the other after.
  // Companion drawers instead attempt synchronous close-button focus while
  // their visibility transition starts. Do not invent a focus outcome for that
  // separate retained implementation: settle its CSS, compare the observed
  // opening focus below, and exercise its real Tab trap and focus return.
  if(!companion)await page.waitForFunction(()=>Boolean(document.activeElement?.closest('.sidebar')));
  await settle(page);
}
async function scene(page,caseInfo,companion) {
  activePage=page;activeCase={...caseInfo,phase:page._preservationPhase};activeState='default';
  await page.bringToFront();
  const states={};
  await page.setViewportSize({width:caseInfo.width,height:caseInfo.height||844});
  await page.evaluate(theme=>window.VoxelTheme?.set(theme),caseInfo.theme);
  await page.evaluate(()=>{document.querySelector('.sidebar .sidebar-nav').scrollTop=0;});
  states.default=await collect(page);
  assert.equal(states.default.sidebar_count,1,'Content upgrades do not add another sidebar.');
  assert.deepEqual(states.default.permission_leaks,[],'Permission-hidden navigation stays hidden.');
  if(caseInfo.width<1024){
    const button=toggle(page,companion);await button.click();await menuOpened(page);
    assert.equal(await button.getAttribute('aria-expanded'),'true');states.open=await collect(page);
    states.open.opening_focus=await page.evaluate(()=>({within_sidebar:Boolean(document.activeElement?.closest('.sidebar')),tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute('aria-label')}));
    if(companion)assert.equal(await page.evaluate(()=>window.VoxelOverlay?.active),'companion-navigation','The existing drawer retains its shared overlay identity.');
    if(caseInfo.width===390){
      const scrolled=await page.locator('.sidebar .sidebar-nav').evaluate(node=>{node.scrollTop=Math.min(140,node.scrollHeight-node.clientHeight);return node.scrollTop;});
      await page.keyboard.press('Escape');assert.equal(await button.getAttribute('aria-expanded'),'false');
      await button.click();await menuOpened(page);
      states.reopened=await collect(page);states.reopened.saved_scroll=scrolled;
      if(companion){await page.locator('.sidebar a').last().focus();await page.keyboard.press('Tab');assert.equal(await page.locator('.sidebar .sidebar-close').evaluate(node=>node===document.activeElement),true,'Companion drawer retains keyboard focus trap.');}
    }
    await page.keyboard.press('Escape');await settle(page);
    assert.equal(await button.getAttribute('aria-expanded'),'false');
    assert.equal(await page.evaluate(()=>document.body.style.overflow),'','Drawer dismissal restores body scrolling.');
    states.closed=await collect(page);
    states.closed.lifecycle={expanded:await button.getAttribute('aria-expanded'),body_overflow:await page.evaluate(()=>document.body.style.overflow),focus_returned:await button.evaluate(node=>node===document.activeElement)};
  }
  if(caseInfo.width===1440){
    const details=page.locator('.sidebar details').filter({visible:true});
    if(await details.count()){
      const first=details.first();await first.locator('summary').click();states.group_toggled=await collect(page);await first.locator('summary').click();
    }
    const search=page.locator('.sidebar input[type=search]');
    if(await search.count()){
      await search.fill('zzzz-no-permitted-sidebar-result');states.search=await collect(page);assert.equal(await page.locator('.sidebar .nav-btn[data-section]:visible').count(),0);await search.fill('');
    }
    const selection=page.locator('.sidebar button.nav-btn[data-section]:visible');
    if(await selection.count()>1){
      await selection.nth(1).click();states.selected=await collect(page);
    }else{
      const hashLink=page.locator('.sidebar a[href^="#"]:visible');
      if(await hashLink.count()){
        await hashLink.first().click();await page.waitForFunction(()=>Boolean(document.querySelector('.sidebar a[aria-current="location"]')));
        states.selected=await collect(page);
      }
    }
  }
  return states;
}
async function captureScreenshots(pages,caseInfo,companion,prefix) {
  for(const phase of phases){const page=pages[phase];await page.bringToFront();if(caseInfo.width<1024){await toggle(page,companion).click();await menuOpened(page);}await settle(page);await page.locator('.sidebar').screenshot({path:path.join(out,`${phase}-${prefix}-${caseInfo.width}-${caseInfo.theme}.png`),animations:'disabled'});if(caseInfo.width<1024)await page.keyboard.press('Escape');}
}
(async()=>{
  let browser;const servers={};const contexts=[];
  try{
    sourceProof();
    for(const phase of phases){const directory=directories[phase],renderer=require(path.join(directory,'services/globalBrandRenderer.js'));servers[phase]=await fixture.makeServer(path.join(directory,'public'),fs.readFileSync(path.join(directory,'public/logo.png')),async(app,{pageAuth})=>{for(const[url,file]of Object.entries(companions))if(url!=='/profile')app.get(url,pageAuth(),(_req,res)=>res.type('html').send(renderer.injectGlobalBrand(fs.readFileSync(path.join(directory,'public',file),'utf8'))));});}
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    for(const role of roles){
      const pages={};const companion=clients.includes(role),route=companion?'/client':admins.includes(role)?'/admin':'/portal/staff';
      for(const phase of phases){const context=await browser.newContext({viewport:{width:1440,height:844}});contexts.push(context);await context.addCookies([{name:'vv_session',value:token(role),url:servers[phase].origin,httpOnly:true,sameSite:'Lax'}]);pages[phase]=await context.newPage();pages[phase]._preservationPhase=phase;pages[phase]._preservationActorId=9700+allRoles.indexOf(role);activePage=pages[phase];activeCase={role,phase,route};activeState='load';await pages[phase].goto(servers[phase].origin+route);await ready(pages[phase]);}
      for(const width of widths)for(const theme of ['light','dark']){
        const info={role,width,theme},states={};for(const phase of phases)states[phase]=await scene(pages[phase],info,companion);
        assert.deepEqual(Object.keys(states.after),Object.keys(states.before));const item={...info,states:Object.keys(states.before).map(state=>compare(states.before[state],states.after[state],info,state))};proof.cases.push(item);
        if(['admin','staff','client'].includes(role)&&[390,1440].includes(width)){proof.sample_snapshots.push({...info,baseline:states.before.default,candidate:states.after.default});await captureScreenshots(pages,info,companion,role);}
      }
      // Rotation uses the same page and current selection, not newly invented data.
      const rotation={};for(const phase of phases){const page=pages[phase];await page.bringToFront();await page.setViewportSize({width:390,height:844});await toggle(page,companion).click();await menuOpened(page);await page.setViewportSize({width:844,height:390});rotation[phase]=await collect(page);await page.setViewportSize({width:1440,height:844});await settle(page);await page.keyboard.press('Escape');rotation[phase].restored=await collect(page);rotation[phase].body_overflow=await page.evaluate(()=>document.body.style.overflow);assert.equal(rotation[phase].body_overflow,'');}
      compare(rotation.before,rotation.after,{role},'rotation-drawer-desktop-return');
      for(const phase of phases)await pages[phase].context().close();
    }
    // Dedicated pages have their existing companion sidebar and account links.
    for(const route of Object.keys(companions)){
      const role=route==='/client'?'client':'admin',pages={};
      for(const phase of phases){const context=await browser.newContext({viewport:{width:1440,height:844}});contexts.push(context);await context.addCookies([{name:'vv_session',value:token(role),url:servers[phase].origin,httpOnly:true,sameSite:'Lax'}]);pages[phase]=await context.newPage();pages[phase]._preservationPhase=phase;pages[phase]._preservationActorId=9700+allRoles.indexOf(role);activePage=pages[phase];activeCase={role,phase,route};activeState='load';await pages[phase].goto(servers[phase].origin+route);await ready(pages[phase]);assert.equal(await pages[phase].locator('.sidebar').count(),1,'One existing sidebar only.');}
      for(const width of [390,1440])for(const theme of ['light','dark']){const info={route,role,width,theme},states={};for(const phase of phases)states[phase]=await scene(pages[phase],info,true);proof.companion_cases.push({...info,states:Object.keys(states.before).map(state=>compare(states.before[state],states.after[state],info,state))});}
      for(const phase of phases)await pages[phase].context().close();
    }
    proof.result='passed';fs.writeFileSync(path.join(out,'sidebar-preservation.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({result:proof.result,baseline:baselineCommit,roles:roles.length,sidebar_cases:proof.cases.length,companion_cases:proof.companion_cases.length,physicalDevice:false,output:out}));
  }catch(error){const observed=activePage&&!activePage.isClosed()?await activePage.evaluate(()=>({url:location.pathname,body_classes:document.body.className,focus:{tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute('aria-label'),id:document.activeElement?.id},sidebar_classes:document.querySelector('.sidebar')?.className,overlay:window.VoxelOverlay?.active})).catch(()=>null):null;fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({case:activeCase,state:activeState,observed,message:error.message,stack:error.stack},null,2));console.error('Sidebar preservation failed: '+error.message.split('\n')[0]);process.exitCode=1;}
  finally{for(const context of contexts)await context.close().catch(()=>{});await browser?.close();for(const server of Object.values(servers))await new Promise(resolve=>{server.server.close(resolve);server.server.closeAllConnections?.();});}
})();
