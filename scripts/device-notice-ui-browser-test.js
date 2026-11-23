'use strict';

const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const fixtures = require('./staff-mobile-browser-test');
const { chromium } = require(process.env.VV_BROWSER_MODULE_PATH || 'playwright');

const publicDirectory = path.resolve(__dirname, '..', 'public');
const output = process.env.UI_PROOF_DIR || '/tmp/voxelveda-device-notices-ui';
const owner = { id: 9410, name: 'Synthetic Account Owner', username: 'fixture-owner', role: 'super_admin',
  email: 'owner@example.invalid', active: 1, account_status: 'ACTIVE', session_version: 1, mfa_enabled: 0, permissions: [] };
const events = [
  { id: '3', source: 'CODEX_CLI', title: 'AI Team run finished', summary: 'A Codex run completed.', is_read: 0 },
  { id: '2', source: 'GITHUB_PULL_REQUESTS', title: 'Pull request is ready for review', summary: 'Notification layout review fixture', is_read: 0 },
  { id: '1', source: 'GITHUB_ACTIONS', title: 'Workflow run finished', summary: 'Browser checks · success', is_read: 1 }
].map((item, i) => ({ ...item, created_at: new Date(Date.now() - (i + 1) * 60000).toISOString() }));

function session(id) {
  const token = jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '1h', jwtid: randomUUID() });
  fixtures.sessions.set(createHash('sha256').update(token).digest('hex'), { id: randomUUID(), user_id: id, session_version: 1, assurance_level: 2 });
  return token;
}

async function view(browser, fixture, viewport, theme, id, action) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  try {
    if (id) await context.addCookies([{ name:'vv_session', value:session(id), url:fixture.origin, httpOnly:true }]);
    await context.addInitScript(mode => localStorage.setItem('voxelveda:color-mode', mode), theme);
    const page = await context.newPage();
    const responses = [];
    page.on('response', async response => {
      const pathname = new URL(response.url()).pathname;
      if (pathname.startsWith('/api/ai-team')) responses.push([pathname,response.status(),await response.json().catch(() => null)]);
      if (pathname === '/api/auth/me') responses.push([pathname,response.status()]);
    });
    try { await action(page); }
    catch (error) {
      await page.screenshot({path:path.join(output,`failure-${viewport.width}-${theme}.png`),animations:'disabled'}).catch(() => {});
      console.error('Fixture authentication/activity responses:', responses);
      console.error('Fixture AI Team trigger:', await page.locator('[data-ai-team-toggle]').evaluateAll(nodes => nodes.map(node => node.outerHTML)));
      throw error;
    }
  } finally { await context.close(); }
}

async function main() {
  fs.mkdirSync(output, { recursive:true });
  let latest = null;
  const read = new Set();
  const fixture = await fixtures.makeServer(publicDirectory, fs.readFileSync(path.join(publicDirectory, 'logo.png')), (app, { auth, brand, identities }) => {
    identities.set(owner.id, owner);
    app.get('/login', (_req, res) => res.type('html').send(brand.injectGlobalBrand(fs.readFileSync(path.join(publicDirectory, 'login.html'), 'utf8'))));
    app.get('/api/device-notices/configuration', (_req, res) => res.json({ push_available:false, latest_release:latest }));
    app.get('/api/device-notices/installation', (_req, res) => res.json({ registered:false }));
    app.post('/api/device-notices/installation/account', auth, (_req, res) => res.json({ eligible:false, registered:false }));
    app.use('/api/ai-team', auth);
    const unread = () => events.filter(event => !event.is_read && !read.has(event.id)).length;
    app.get('/api/ai-team/status', (req, res) => res.json(req.user.id === owner.id ? { eligible:true, unread:unread(), in_app_enabled:true, push_enabled:false } : { eligible:false }));
    app.get('/api/ai-team/events', (req, res) => req.user.id === owner.id ? res.json({ items:events.map(event => ({ ...event, is_read:event.is_read || Number(read.has(event.id)) })), before:null }) : res.sendStatus(403));
    app.post('/api/ai-team/events/:id/open', (req, res) => {
      const item = events.find(event => event.id === req.params.id);
      if (!item || req.user.id !== owner.id) return res.sendStatus(404);
      read.add(item.id);
      return res.json({ item:{ ...item, is_read:1, reference_label:'Synthetic test event' }, unread:unread() });
    });
  });
  let browser;
  try {
    browser = await chromium.launch({ headless:true, executablePath:process.env.CHROMIUM_PATH || undefined, args:['--no-sandbox'] });
    latest = { id:123, platform:'web', version:'1'.repeat(40), action_url:'/updates' };
    await view(browser, fixture, {width:390,height:844}, 'light', null, async page => {
      await page.goto(fixture.origin + '/login');
      await page.locator('[data-device-notices-entry]').getByText('Latest verified web release').waitFor();
      await page.screenshot({ path:path.join(output,'sign-in-release-phone.png'), animations:'disabled' });
    });
    latest = null;
    await view(browser, fixture, {width:390,height:844}, 'light', 9401, async page => {
      await page.goto(fixture.origin + '/portal/staff');
      await page.locator('#staffHomeGreeting').waitFor();
      assert.equal(await page.locator('[data-ai-team-toggle]').isVisible(), false);
      await page.screenshot({path:path.join(output,'staff-home-phone.png'), animations:'disabled'});
      await page.goto(fixture.origin + '/profile');
      await page.getByRole('heading', {name:'Device notifications'}).waitFor();
      await page.screenshot({path:path.join(output,'profile-phone.png'), animations:'disabled'});
    });
    for (const [width, height, theme] of [[390,844,'dark'], [1440,1000,'light']]) {
      read.clear();
      await view(browser, fixture, { width, height }, theme, owner.id, async page => {
        await page.goto(fixture.origin + '/admin');
        const trigger = page.locator('#notificationBell + [data-ai-team-toggle]');
        await trigger.getByText('2', {exact:true}).waitFor({timeout:5000});
        await trigger.click();
        const panel = page.getByRole('dialog', {name:'AI Team'});
        await panel.getByText('AI Team run finished').waitFor();
        assert.equal(await panel.locator('.vv-team-entry').count(), 3);
        const frame = await panel.boundingBox();
        assert(frame.x >= 0 && frame.y >= 0 && frame.x + frame.width <= width + 1 && frame.y + frame.height <= height + 1);
        await page.screenshot({path:path.join(output,`ai-team-${width}-${theme}.png`),animations:'disabled'});
        await panel.getByRole('button', {name:/AI Team run finished/}).click();
        await panel.getByText('Synthetic test event').waitFor();
        assert(read.has('3'));
        await page.keyboard.press('Escape');
        assert.equal(await panel.isVisible(), false);
        assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
        await trigger.getByText('1', {exact:true}).waitFor();
      });
    }
    console.log(`Device notices browser passed signed-out release fallback, staff scope, and two responsive AI Team feed/detail journeys. Screenshots: ${output}`);
  } finally {
    await browser?.close();
    await new Promise(resolve => { fixture.server.close(resolve); fixture.server.closeAllConnections?.(); });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
