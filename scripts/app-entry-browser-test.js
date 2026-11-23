'use strict';

// Browser checks for the real sign-in page and auth-entry middleware, using
// the disposable cookie/session fixture. No production credentials are used.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const fixtures = require('./staff-mobile-browser-test');
const { chromium } = require(process.env.VV_BROWSER_MODULE_PATH || 'playwright');

const publicDirectory = path.resolve(__dirname, '..', 'public');
const output = process.env.UI_PROOF_DIR || '/tmp/voxelveda-entry-proof';
const staffId = 9401;
const viewports = [320, 360, 390, 430, 768, 1024, 1440].map(width => ({ width, height: 844 }));
viewports.push({ width: 844, height: 390 });

function fixtureSession() {
  const token = jwt.sign({ id: staffId }, process.env.JWT_SECRET, { expiresIn: '1h', jwtid: crypto.randomUUID() });
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  fixtures.sessions.set(hash, { id: 'entry-fixture', user_id: staffId, session_version: 1, assurance_level: 1 });
  return token;
}

async function checkEntry(browser, origin, viewport, theme) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  try {
    await context.addInitScript(mode => localStorage.setItem('voxelveda:color-mode', mode), theme);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/login');
    const form = page.locator('#loginForm');
    const button = form.getByRole('button', { name: 'Sign In' });
    await page.waitForFunction(() => !document.getElementById('loginButton').disabled);
    assert.equal(await page.getByRole('heading', { name: 'Sign in', exact: true }).count(), 1);
    assert.equal(await page.locator('html').getAttribute('data-color-mode'), theme);
    assert.equal(await page.locator('.vv-entry-illustration').evaluate(image => image.complete && image.naturalWidth > 0), true);
    assert.equal(await page.locator('.vv-entry-illustration').evaluate(image => getComputedStyle(image).animationName), 'none');
    assert.equal(await page.locator('#vvGlobalBrandLoader').getAttribute('aria-hidden'), 'true', 'The usable form is not blocked by a startup overlay');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Sign-in layout fits the viewport');
    const user = form.getByLabel('Work email or user ID', { exact: true });
    const password = form.getByLabel('Password', { exact: true });
    for (const control of [user, password, button]) {
      const { x, width, height } = await control.boundingBox();
      assert(x >= 0 && x + width <= viewport.width + 1 && height >= 44, 'Every sign-in control is reachable');
    }
    await page.keyboard.press('Tab');
    assert.equal(await user.evaluate(input => input === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await password.evaluate(input => input === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await form.getByRole('link', { name: 'Forgot password?' }).evaluate(link => link === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await button.evaluate(control => control === document.activeElement), true);
    assert.deepEqual(errors, []);
    if ([390, 1440].includes(viewport.width)) {
      await page.evaluate(() => document.activeElement?.blur());
      await page.screenshot({ path: path.join(output, `sign-in-${viewport.width}-${theme}.png`), animations: 'disabled' });
    }
  } finally { await context.close(); }
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const fixture = await fixtures.makeServer(publicDirectory, fs.readFileSync(path.join(publicDirectory, 'logo.png')), (app, { pageAuth, brand }) => {
    app.get('/login', pageAuth({ signInEntry: true }), (_req, res) => res.type('html').send(brand.injectGlobalBrand(fs.readFileSync(path.join(publicDirectory, 'login.html'), 'utf8'))));
    app.get('/dashboard', pageAuth(), (_req, res) => res.redirect(302, '/portal/staff'));
  });
  let browser;
  try {
    const executablePath = process.env.VV_BROWSER_EXECUTABLE || process.env.CHROMIUM_PATH || undefined;
    browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
    for (const viewport of viewports) for (const theme of ['light', 'dark']) {
      await checkEntry(browser, fixture.origin, viewport, theme);
    }
    const returning = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await returning.addCookies([{ name: 'vv_session', value: fixtureSession(), url: fixture.origin, httpOnly: true, sameSite: 'Lax' }]);
    const page = await returning.newPage();
    const destinations = [];
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) destinations.push(new URL(frame.url()).pathname); });
    await page.goto(fixture.origin + '/login');
    await page.locator('#staffHomeGreeting').waitFor();
    assert.deepEqual(destinations, ['/portal/staff'], 'Only the authenticated dashboard document is committed on a returning launch');
    assert.equal(await page.locator('#vvGlobalBrandLoader').getAttribute('aria-hidden'), 'true');
    await returning.close();
    console.log(`App entry browser passed ${viewports.length * 2} layout/theme cases, keyboard focus, reduced motion and returning-session navigation. Screenshots: ${output}`);
  } finally {
    await browser?.close();
    await new Promise(resolve => {
      fixture.server.close(resolve);
      fixture.server.closeAllConnections?.();
    });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
