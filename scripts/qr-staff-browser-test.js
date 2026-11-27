'use strict';

// Real UI assets and browser storage. Every HTTP request is intercepted locally.
// Run from the app checkout with Playwright available (VV_BROWSER_MODULE_PATH is optional).
const assert = require('node:assert/strict');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const jsQR = require('jsqr');
const { renderAttendanceQr } = require('../services/attendanceQrRenderer');
const { chromium } = require(process.env.VV_BROWSER_MODULE_PATH || 'playwright');

const rootDir = path.resolve(__dirname, '..');
const views = 'views/qr-staff/';
const qr = 'https://qr.voxelveda.com';
const remote = qr + '/remote';
const portal = 'https://app.voxelveda.com';
const challenge = 'a'.repeat(64);
const code = 'c'.repeat(43);
const token = 'current-fixture-token';
const displayIntervalMs = 30_000;
const displayStart = Date.parse('2026-11-27T12:00:00.000Z');
const displaySlot = time => Math.floor(time / displayIntervalMs);
const imagePath = slot => '/qr-staff/attendance.png?v=' + slot;
const scanUrl = slot => remote + '?v=' + slot;
const normalSession = {
  linked: true, staff_name: 'Demo Staff', staff_id: 114,
  site_name: 'Demo Workshop', timezone: 'Australia/Melbourne'
};

class AttendanceFixture {
  constructor() {
    this.linked = false;
    this.working = false;
    this.legacyCallback = false;
    this.nextFault = null;
    this.displayTime = displayStart;
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
    const { origin, pathname, searchParams } = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    const serve = relative => route.fulfill({ path: path.join(rootDir, relative) });
    if (![qr, portal].includes(origin)) throw new Error('Unexpected origin ' + origin);
    if (request.method() === 'GET') {
      if (origin === qr && pathname === '/') return serve(views + 'display.html');
      if (origin === qr && ['/setup', '/a', '/remote'].includes(pathname)) return serve(views + 'index.html');
      if (origin === qr && pathname === '/qr-staff/current') {
        const slot = displaySlot(this.displayTime);
        return json({
          image_url: imagePath(slot),
          expires_at: new Date((slot + 1) * displayIntervalMs).toISOString(),
          server_time: new Date(this.displayTime).toISOString()
        });
      }
      if (origin === qr && pathname === '/qr-staff/attendance.png') {
        const version = searchParams.get('v') ?? String(displaySlot(this.displayTime));
        const image = await renderAttendanceQr(scanUrl(version), 16);
        return route.fulfill({ body: image.buffer, contentType: 'image/png' });
      }
      if (origin === portal && pathname === '/attendance/link-phone') return serve(views + 'approve.html');
      if (/^\/qr-staff\/(site\.css|staff\.js|approve\.js|display\.js)$/.test(pathname)) return serve('views' + pathname);
      if (pathname === '/logo.png') return serve('public/logo.png');
      if (origin === qr && pathname === '/qr-api/session') return json(this.linked ? this.session() : { linked: false });
    } else if (request.method() === 'POST') {
      const body = request.postDataJSON();
      this.posts.push(pathname);
      if (origin === portal) {
        if (pathname === '/attendance/link-phone') {
          assert.equal(body.challenge, challenge);
          return json({ url: qr + (this.legacyCallback ? '/#code=' : '/setup#code=') + code });
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
          case '/qr-api/remote/scan':
            assert.ok(this.linked);
            assert.deepEqual(body, {});
            return json({ ...this.session(), qr_proof: 'browser-fixture-remote-proof', expires_at: new Date(Date.now() + 30000).toISOString() });
          case '/qr-api/remote/confirm':
          case '/qr-api/confirm': {
            assert.ok(this.linked);
            assert.equal(Object.hasOwn(body, 'source'), false);
            if (pathname === '/qr-api/remote/confirm') {
              assert.equal(Object.hasOwn(body, 'token'), false);
              assert.equal(body.qr_proof, 'browser-fixture-remote-proof');
            } else {
              assert.equal(body.token, token);
              assert.equal(body.qr_proof, 'browser-fixture-proof');
            }
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

async function verifyDisplayRotation(context, fixture) {
  const page = await context.newPage();
  page.on('pageerror', error => fixture.unexpected.push(String(error)));
  page.setDefaultTimeout(6000);
  try {
    await page.clock.install({ time: new Date(displayStart - 60_000) });
    await page.clock.pauseAt(new Date(displayStart));
    await page.goto(qr);
    const caption = (await page.locator('figcaption').innerText()).trim();
    assert.ok(caption.length > 0);
    assert.doesNotMatch(caption, /\p{N}/u);
    const displayed = page.getByRole('img', { name: 'Scan this QR code to open staff attendance' });

    async function decodeDisplayed(slot) {
      await displayed.and(page.locator(`img[src$="${imagePath(slot)}"]`)).waitFor();
      const image = await loadImage(await displayed.screenshot());
      const canvas = createCanvas(image.width, image.height);
      const canvasContext = canvas.getContext('2d');
      canvasContext.drawImage(image, 0, 0);
      const pixels = canvasContext.getImageData(0, 0, image.width, image.height);
      return jsQR(new Uint8ClampedArray(pixels.data), image.width, image.height)?.data;
    }

    const firstSlot = displaySlot(displayStart);
    const first = await decodeDisplayed(firstSlot);
    assert.equal(first, scanUrl(firstSlot));
    await page.clock.runFor(displayIntervalMs - 1);
    const firstImage = await displayed.getAttribute('src');
    assert.equal(new URL(firstImage, qr).href, qr + imagePath(firstSlot));
    fixture.displayTime += displayIntervalMs;
    await page.clock.runFor(1);
    const nextSlot = firstSlot + 1;
    const next = await decodeDisplayed(nextSlot);
    assert.equal(next, scanUrl(nextSlot));
    assert.notEqual(next, first);
    assert.notEqual(await displayed.getAttribute('src'), firstImage);
    assert.equal((await page.locator('figcaption').innerText()).trim(), caption);
    assert.equal(fixture.posts.length, 0);
  } finally {
    await page.close();
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
    await verifyDisplayRotation(context, fixture);
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

    fixture.legacyCallback = true;
    await page.goto(qr + '/setup');
    await title('Link your phone');
    assert.equal(fixture.posts.length, 0);
    await click('Link this phone');
    await title('Link this phone');
    assert.equal(new URL(page.url()).origin, portal);
    assert.equal(new URL(page.url()).search, '');
    await click('Link my phone');
    await title('Scan the workplace QR');
    assert.equal(page.url(), qr + '/setup');
    assert.deepEqual(fixture.posts, ['/qr-api/link/start', '/attendance/link-phone', '/qr-api/link/finish']);
    fixture.legacyCallback = false;
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    await scan('expired-fixture');
    await title('Scan the workplace QR');
    assert.match(await page.locator('#message').innerText(), /expired/i);
    assert.equal(fixture.confirmations.length, 0);
    await scan(token);
    await title('Check in');
    assert.equal(page.url(), qr + '/a');
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
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find(name => name.startsWith('vv.qr.pending.'));
      const { source, ...legacy } = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify(legacy));
    });
    await page.goto(remote);
    await title('Attendance needs checking');
    assert.equal(countPosts('/qr-api/remote/scan'), 0);
    assert.match(await page.locator('#message').innerText(), /fresh workplace code/);
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

    await page.goto(remote);
    await title('Link your phone');
    await click('Link this phone');
    await title('Link this phone');
    await click('Link my phone');
    await title('Check in');
    assert.equal(page.url(), remote);
    assert.equal(countPosts('/qr-api/remote/scan'), 1);
    assert.equal(countPosts('/qr-api/remote/confirm'), 0);
    assert.match(await page.locator('#details').innerText(), /Remote/);
    assert.doesNotMatch(await page.locator('#details').innerText(), /Workplace/);
    await click('Check in');
    await title('Checked in');
    assert.equal(countPosts('/qr-api/remote/confirm'), 1);
    assert.match(await page.locator('#details').innerText(), /Remote/);

    await page.reload();
    await title('Check out');
    assert.equal(countPosts('/qr-api/remote/confirm'), 1);
    fixture.nextFault = 'before-save';
    await click('Check out');
    await title('Attendance needs checking');
    const remoteCheckout = fixture.confirmations.at(-1);
    assert.equal((await pending())[0].source, 'remote');
    const workplaceScans = countPosts('/qr-api/scan');
    await scan(token);
    await title('Attendance needs checking');
    assert.equal(countPosts('/qr-api/scan'), workplaceScans);
    await click('Open remote attendance');
    await title('Check out');
    assert.equal(countPosts('/qr-api/remote/confirm'), 2);
    await click('Check out');
    await title('Checked out');
    assert.equal(fixture.confirmations.at(-1).request_id, remoteCheckout.request_id);
    assert.deepEqual(await pending(), []);
    assert.equal(fixture.receipts.size, 4);
    assert.deepEqual(fixture.unexpected, []);
    console.log('PASS: mobile Chromium decoded two public QR codes across a 30-second rollover and verified pairing, workplace and remote confirmation, retry recovery, unlink and revocation with simulated API endpoints.');
  } finally {
    await browser.close();
  }
}

test().catch(error => { console.error(error); process.exitCode = 1; });
