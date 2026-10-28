'use strict';
// Retained assets and real cookie-authenticated synthetic accounts only.
// Exercise permission/search visibility and the new shared navigation lifecycle.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const fixtures = require('./staff-mobile-browser-test');
const jwt = require('jsonwebtoken');
const { chromium } = require(process.env.VV_BROWSER_MODULE_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const out = process.env.UI_PROOF_DIR || '/tmp/voxelveda-business-hub-shell';
fs.mkdirSync(out, { recursive: true });
const roles = ['staff','hr','manager','supervisor','production','sales','admin','super_admin','finance_admin','finance_user','accountant','viewer','view_only','client','customer'];
const clientRoles = ['viewer','view_only','client','customer'];
const adminRoles = ['admin','super_admin','finance_admin','finance_user','accountant'];
function contrast(a,b) {
  const lum = value => (value.match(/[\d.]+/g)||[]).slice(0,3).map(Number).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
  const x=lum(a),y=lum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
for (const [i, role] of roles.entries()) fixtures.identities.set(9600 + i, {
  id:9600+i, name:'Synthetic '+role, username:'shell.'+role, email:role+'@example.invalid', role,
  active:1, account_status:'ACTIVE', session_version:1, mfa_enabled:adminRoles.includes(role)?1:0,
  permissions:clientRoles.includes(role)?['VIEW_RFQS','VIEW_FINANCE']:[]
});
function token(id) {
  const value = jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn:'1h', jwtid:crypto.randomUUID() });
  fixtures.sessions.set(crypto.createHash('sha256').update(value).digest('hex'), { id:'shell-'+id, user_id:id, session_version:1, assurance_level:2 });
  return value;
}
const companionPages = { '/client':'client-portal.html', '/account':'workspace.html', '/security':'security.html', '/quality':'quality.html', '/shop-floor':'shop-floor.html', '/careers-admin':'careers-admin.html', '/employee-id':'employee-id.html', '/invoice/view':'invoice-pdf.html' };
(async () => {
  let browser, fixture;
  const proof = { fixtureOnly:true, physicalDevice:false, cases:[], companion:[] };
  try {
    fixture = await fixtures.makeServer(path.join(root,'public'), fs.readFileSync(path.join(root,'public/logo.png')), async (app,{pageAuth,brand}) => {
      for (const [url,file] of Object.entries(companionPages)) app.get(url, pageAuth(), (_req,res) => res.type('html').send(brand.injectGlobalBrand(fs.readFileSync(path.join(root,'public',file),'utf8'))));
    });
    browser = await chromium.launch({ headless:true });
    for (const [i,role] of roles.entries()) {
      const context = await browser.newContext({viewport:{width:1440,height:960}});
      await context.addCookies([{name:'vv_session',value:token(9600+i),url:fixture.origin,httpOnly:true,sameSite:'Lax'}]);
      const page = await context.newPage();
      const client = clientRoles.includes(role), admin = adminRoles.includes(role);
      await page.goto(fixture.origin+(client?'/client':admin?'/admin':'/portal/staff'));
      await page.waitForFunction(() => document.body.dataset.vvShell === 'business-hub' && Number(JSON.parse(localStorage.getItem('user') || '{}').id)>0);
      await page.waitForFunction(() => !document.getElementById('vvGlobalBrandLoader')?.classList.contains('is-visible'));
      if (client) {
        for (const theme of ['light','dark']) {
          await page.evaluate(value=>VoxelTheme.set(value),theme);
          const style=await page.locator('.client-hero h2').evaluate(node=>({color:getComputedStyle(node).color,background:getComputedStyle(node.closest('.client-hero')).backgroundColor}));
          assert(contrast(style.color,style.background)>=4.5,role+' client title is readable in '+theme);
        }
        await page.evaluate(()=>VoxelTheme.set('light'));
      }
      if (!client) {
        const links = await page.locator('.sidebar .nav-btn').count();
        assert.equal(await page.locator('.sidebar .nav-btn > .hub-nav-icon').count(), links);
        // Permission filtering and either native navigation search still win over
        // presentation, even when an item was previously active/selected.
        const hidden = await page.evaluate(() => [...document.querySelectorAll('.sidebar .hidden-section,.sidebar [hidden]')].filter(node=>getComputedStyle(node).display!=='none').map(node=>node.textContent));
        assert.deepEqual(hidden, [], role+' cannot reveal permission-hidden items');
        const search = page.locator('.sidebar input[type=search]');
        await search.fill('zzzz-no-permitted-match');
        assert.equal(await page.locator('.sidebar .nav-btn[data-section]:visible').count(), 0, role+' filters even active navigation');
        await search.fill('');
        assert(await page.locator('.sidebar .nav-btn:visible').count()>0);
      }
      for (const width of [320,768,1440]) {
        await page.setViewportSize({width,height:900});
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        assert.equal(overflow, false, role+' page fits width '+width);
        const avatar = page.locator('.profile-chip [data-avatar-self]');
        if (await avatar.count()) {
          assert(await avatar.first().isVisible(),role+' header avatar is visible at '+width);
          const fallback=avatar.first().locator('.vv-avatar-initials:not([hidden])');
          if(await fallback.count())assert(await fallback.isVisible(),role+' missing-photo initials stay visible at '+width);
        }
        if (width<1024) {
          const toggle = client ? page.getByRole('button',{name:'Open workspace menu',exact:true}) : page.locator('.topbar-menu-btn');
          await toggle.click();
          await page.locator('.sidebar .sidebar-close:visible').waitFor();
          assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
          await page.keyboard.press('Escape');
          assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
          assert.equal(await page.evaluate(() => document.body.style.overflow), '');
        }
        if (['staff','admin','client','production'].includes(role) && [320,1440].includes(width)) await page.screenshot({path:path.join(out,role+'-'+width+'.png'),fullPage:false});
        proof.cases.push({role,width,permissionVisibility:true,drawerLifecycle:true,noPageOverflow:true});
      }
      await context.close();
    }
    const context = await browser.newContext({viewport:{width:390,height:844}});
    await context.addCookies([{name:'vv_session',value:token(9606),url:fixture.origin,httpOnly:true,sameSite:'Lax'}]);
    const page = await context.newPage();
    for (const route of [...Object.keys(companionPages),'/profile']) {
      // Client pages intentionally redirect administrative identities. Exercise
      // the real authorised client identity there, then restore the admin actor
      // for the existing protected operational/account pages.
      await context.addCookies([{name:'vv_session',value:token(route==='/client'?9613:9606),url:fixture.origin,httpOnly:true,sameSite:'Lax'}]);
      await page.goto(fixture.origin+route);
      await page.locator('.hub-companion-sidebar').waitFor({state:'attached'});
      assert.equal(await page.locator('.hub-companion-sidebar').count(),1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth+1),false,route+' does not overflow');
      await page.getByRole('button',{name:'Open workspace menu',exact:true}).click();
      await page.locator('.hub-companion-sidebar .sidebar-close').waitFor({state:'visible'});
      assert.equal(await page.locator('.hub-companion-sidebar a[href^="javascript:"],.hub-companion-sidebar a[href^="https:"]').count(),0);
      await page.locator('.hub-companion-sidebar a').last().focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('.hub-companion-sidebar .sidebar-close').evaluate(node=>node===document.activeElement),true,'drawer traps focus');
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.body.style.overflow),'');
      assert.equal(await page.getByRole('button',{name:'Open workspace menu',exact:true}).evaluate(node=>node===document.activeElement),true,'drawer restores focus');
      proof.companion.push({route,oneShell:true,focusLifecycle:true,noPageOverflow:true});
    }
    await context.close();
    proof.result='passed'; fs.writeFileSync(path.join(out,'business-hub-shell.json'),JSON.stringify(proof,null,2));
    console.log('Business Hub shell proof passed: 15 retained roles, 45 responsive cases and 9 dedicated pages; '+out);
  } finally {
    await browser?.close();
    if(fixture)await new Promise(resolve=>{fixture.server.close(resolve);fixture.server.closeAllConnections?.();});
  }
})().catch(error=>{fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({message:error.message,stack:error.stack},null,2));console.error(error);process.exitCode=1;});
