'use strict';

// Real UI assets and browser storage. Every HTTP request is intercepted locally.
// Run from the app checkout with Playwright available (VV_BROWSER_MODULE_PATH is optional).
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.VV_BROWSER_MODULE_PATH || 'playwright');

const rootDir = path.resolve(__dirname, '..');
const views = 'views/qr-staff/';
const qr = 'https://qr.voxelveda.com';
const portal = 'https://app.voxelveda.com';
const challenge = 'a'.repeat(64);
const code = 'browser-test-only';
const token = 'current-fixture-token';
const normalSession = {
  linked: true, staff_name: 'Demo Staff', staff_id: 114,
  site_name: 'Demo Workshop', timezone: 'Australia/Melbourne'
};

class AttendanceFixture {
  constructor() {
    this.linked = false;
    this.working = false;
    this.nextFault = null;
    this.confirmations = [];
    this.receipts = new Map();
    this.posts = [];
    this.unexpected = [];
  }

  session() {
    return {
      ...normalSession, status: this.working ? 'WORKING' : 'NOT_STARTED',
      action: this.working ? 'CHECK_OUT' : 'CHECK_IN',
      attendance_id: this.working ? 721 : null
    };
  }

  async respond(route) {
    const request = route.request();
    const { origin, pathname } = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    const serve = relative => route.fulfill({ path: path.join(rootDir, relative) });
    if (![qr, portal].includes(origin)) throw new Error('Unexpected origin ' + origin);
    if (request.method() === 'GET') {
      if (origin === qr && ['/', '/a'].includes(pathname)) return serve(views + 'index.html');
      if (origin === portal && pathname === '/attendance/link-phone') return serve(views + 'approve.html');
      if (/^\/qr-staff\/(site\.css|staff\.js|approve\.js)$/.test(pathname)) return serve('views' + pathname);
      if (pathname === '/logo.png') return serve('public/logo.png');
      if (origin === qr && pathname === '/qr-api/session') return json(this.linked ? this.session() : { linked: false });
    } else if (request.method() === 'POST') {
      const body = request.postDataJSON();
      this.posts.push(pathname);
      if (origin === portal) {
        if (pathname === '/attendance/link-phone') {
          assert.equal(body.challenge, challenge);
          return json({ url: qr + '/#code=' + code });
        }
        if (pathname === '/attendance/phones/revoke-all') {
          this.linked = false;
          return json({ ok: true });
        }
      }
      if (origin === qr) {
        switch (pathname) {
          case '/qr-api/link/start':
            return json({ url: portal + '/attendance/link-phone?challenge=' + challenge });
          case '/qr-api/link/finish':
            assert.equal(body.code, code);
            this.linked = true;
            return json({ ok: true });
          case '/qr-api/scan':
            assert.ok(this.linked);
            if (body.token !== token) return json({ message: 'This QR code has expired.' }, 403);
            return json({ ...this.session(), qr_proof: 'browser-fixture-proof', expires_at: new Date(Date.now() + 30000).toISOString() });
          case '/qr-api/confirm': {
            assert.ok(this.linked);
            assert.equal(body.token, token);
            assert.equal(body.qr_proof, 'browser-fixture-proof');
            assert.match(body.request_id, /^[0-9a-f-]{36}$/i);
            this.confirmations.push(body);
            const fault = this.nextFault;
            this.nextFault = null;
            if (fault === 'before-save') return route.abort();
            if (!this.receipts.has(body.request_id)) {
              assert.equal(body.action, this.session().action);
              assert.equal(body.attendance_id, this.session().attendance_id);
              this.working = !this.working;
              this.receipts.set(body.request_id, {
                request_id: body.request_id, action: body.action, attendance_id: 721,
                saved_at: new Date().toISOString(), timezone: normalSession.timezone
              });
            }
            if (fault === 'after-save') return route.abort();
            return json({ receipt: this.receipts.get(body.request_id) });
          }
          case '/qr-api/reconcile':
            return json({ found: this.receipts.has(body.request_id), receipt: this.receipts.get(body.request_id) || null });
          case '/qr-api/unlink':
            this.linked = false;
            return json({ ok: true });
        }
      }
    }
    throw new Error('Unexpected ' + request.method() + ' ' + pathname);
  }
}

async function test() {
  const browser = await chromium.launch({
    headless: true, ...(process.env.VV_CHROMIUM_PATH ? { executablePath: process.env.VV_CHROMIUM_PATH } : {})
  });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const fixture = new AttendanceFixture();
    await context.route('**/*', async route => {
      try { await fixture.respond(route); }
      catch (error) {
        fixture.unexpected.push(String(error));
        await route.fulfill({ status: 500, body: 'Browser fixture error' }).catch(() => {});
      }
    });
    const page = await context.newPage();
    page.on('pageerror', error => fixture.unexpected.push(String(error)));
    page.setDefaultTimeout(6000);
    const title = async value => {
      await page.waitForFunction(expected => document.querySelector('#title')?.textContent === expected, value);
    };
    const click = label => page.getByRole('button', { name: label, exact: true }).click();
    const scan = value => page.goto(qr + '/a?t=' + value);
    const pending = () => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('vv.qr.pending.')).map(key => JSON.parse(localStorage.getItem(key))));
    const countPosts = pathname => fixture.posts.filter(saved => saved === pathname).length;

    await page.goto(qr);
    await title('Link your phone');
    assert.equal(fixture.posts.length, 0);
    await click('Link this phone');
    await title('Link this phone');
    assert.equal(new URL(page.url()).origin, portal);
    assert.equal(new URL(page.url()).search, '');
    await click('Link my phone');
    await title('Scan the workplace QR');
    assert.equal(page.url(), qr + '/');
    assert.deepEqual(fixture.posts, ['/qr-api/link/start', '/attendance/link-phone', '/qr-api/link/finish']);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    await scan('expired-fixture');
    await title('Scan the workplace QR');
    assert.match(await page.locator('#message').innerText(), /expired/i);
    assert.equal(fixture.confirmations.length, 0);
    await scan(token);
    await title('Check in');
    assert.equal(page.url(), qr + '/');
    assert.match(await page.locator('#details').innerText(), /Demo Staff/);
    assert.equal(fixture.confirmations.length, 0);

    // Simulate two immediate taps and a saved action whose response never arrives.
    fixture.nextFault = 'after-save';
    await page.locator('#primary').evaluate(button => { button.click(); button.click(); });
    await title('Checked in');
    assert.equal(fixture.confirmations.length, 1);
    assert.equal(countPosts('/qr-api/reconcile'), 1);
    assert.match(await page.locator('#details').innerText(), /Australia\/Melbourne/);
    assert.deepEqual(await pending(), []);

    // A truly unsaved action must reuse the request ID across a fresh QR scan.
    await scan(token);
    await title('Check out');
    fixture.nextFault = 'before-save';
    await click('Check out');
    await title('Attendance needs checking');
    const first = fixture.confirmations[1];
    assert.equal((await pending())[0].request_id, first.request_id);
    await page.reload();
    await title('Attendance needs checking');
    await scan(token);
    await title('Check out');
    assert.equal(fixture.confirmations.length, 2);
    await click('Check out');
    await title('Checked out');
    assert.equal(fixture.confirmations[2].request_id, first.request_id);
    assert.deepEqual(await pending(), []);
    assert.equal(fixture.receipts.size, 2);

    await page.locator('#unlink').click();
    await title('Unlink this phone?');
    await click('Cancel');
    await title('Scan the workplace QR');
    assert.equal(countPosts('/qr-api/unlink'), 0);
    await page.locator('#unlink').click();
    await click('Unlink this phone');
    await title('Link your phone');
    assert.equal(countPosts('/qr-api/unlink'), 1);

    await page.goto(portal + '/attendance/link-phone');
    await title('Manage attendance phones');
    await click('Unlink all my attendance phones');
    await title('Unlink all your phones?');
    assert.equal(countPosts('/attendance/phones/revoke-all'), 0);
    await click('Confirm unlink all phones');
    await title('Phones unlinked');
    assert.equal(countPosts('/attendance/phones/revoke-all'), 1);
    assert.deepEqual(fixture.unexpected, []);
    console.log('PASS: mobile Chromium phone linking, fresh/expired scans, explicit confirmation, double-tap, saved and unsaved response loss, reload/retry, unlink and portal revocation. UI endpoints were simulated.');
  } finally {
    await browser.close();
  }
}

test().catch(error => { console.error(error); process.exitCode = 1; });
