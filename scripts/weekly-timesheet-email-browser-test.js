'use strict';

// Rendered synthetic messages only. This is browser/emulated email evidence,
// not proof of receipt or rendering by Gmail, Outlook or a physical device.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { fixtureSnapshot } = require('./weekly-timesheet-html-test');
const { renderWeeklyTimesheetEmail } = require('../services/weeklyTimesheetEmailService');
const browsers = require(process.env.VV_BROWSER_MODULE_PATH || 'playwright');
const engine = process.env.VV_EMAIL_BROWSER_ENGINE || 'chromium';
assert(['chromium', 'webkit'].includes(engine), 'Choose a supported email proof browser.');
const output = process.env.UI_PROOF_DIR || '/tmp/voxel-weekly-html-browser-evidence';
fs.mkdirSync(output, { recursive: true });
const reports = new Map(['single', 'dst', 'adjusted', 'long'].map(kind => [kind, renderWeeklyTimesheetEmail(fixtureSnapshot(kind))]));
const logo = fs.readFileSync(path.join(__dirname, '../public/logo.png'));
assert.equal(crypto.createHash('sha256').update(logo).digest('hex'), 'ea69c23f603a79ae6e077798e7ceea6186f139ad2433e364591b1f4054b68312', 'Original logo bytes remain unchanged');
const server = http.createServer((request, response) => {
  const kind = new URL(request.url, 'http://fixture.invalid').pathname.slice(1);
  if (!reports.has(kind)) return response.writeHead(404).end();
  response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(reports.get(kind).html);
});
function contrast(color, background) {
  const lum = value => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((sum, x, index) => sum + x * [.2126, .7152, .0722][index], 0);
  const a = lum(color), b = lum(background); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
(async () => {
  let browser, activePage;
  const proof = { fixtureOnly: true, browser: engine, actualMailboxVerified: false, physicalDevice: false, cases: [] };
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    browser = await browsers[engine].launch({ headless: true, ...(engine === 'chromium' ? { args: ['--no-sandbox'] } : {}) });
    for (const mode of ['light', 'dark']) for (const width of [320, 360, 390, 430, 768, 1024, 1440]) for (const kind of reports.keys()) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: mode });
      // The only remote image is fulfilled with the exact retained logo. The
      // second scenario blocks it as an email client may do by default.
      const blockedImages = kind === 'dst' || kind === 'long';
      await context.route('https://app.voxelveda.com/logo.png', route => blockedImages ? route.abort() : route.fulfill({ status: 200, contentType: 'image/png', body: logo }));
      const page = await context.newPage(), errors = []; activePage = page;
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${kind}`, { waitUntil: 'load' });
      const snapshot = fixtureSnapshot(kind);
      assert.match(await page.locator('h1').textContent(), /^TIMESHEET/);
      assert((await page.locator('body').innerText()).includes(snapshot.staff_name), 'Employee identity remains useful when images are blocked');
      assert((await page.locator('body').innerText()).includes('Voxel Veda Pty Ltd'), 'Company identity does not rely on the logo image');
      const dimensions = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert(dimensions.scroll <= width + 1, `${kind}/${mode}/${width} email has no horizontal overflow`);
      assert.equal(await page.locator('.shift-row').count(), snapshot.rows.length, 'All worked rows remain in the readable email');
      for (const row of await page.locator('.shift-row').all()) {
        assert(await row.isVisible(), 'Every worked row is visible');
        assert.equal(await row.locator('.shift-cell').count(), 6, 'Every shift retains all six fields');
      }
      const heading = await page.locator('h1').evaluate(node => ({ text: getComputedStyle(node).color, background: 'rgb(255, 255, 255)' }));
      assert(contrast(heading.text, heading.background) >= 4.5, 'Title is readable');
      const tableColor = await page.locator('.shift-head').evaluate(node => ({ text: getComputedStyle(node.querySelector('th')).color, background: getComputedStyle(node).backgroundColor }));
      assert(contrast(tableColor.text, tableColor.background) >= 4.5, 'Navy table headers retain readable text');
      if (width <= 600) {
        assert.equal(await page.locator('.shift-head').isVisible(), false, 'Phone email uses labelled stacked rows');
        assert(await page.locator('.mobile-label').first().isVisible(), 'Phone shift labels remain visible');
      } else assert(await page.locator('.shift-head').isVisible(), 'Desktop email retains the reference table structure');
      assert.deepEqual(errors, []);
      if ([390, 1440].includes(width)) await page.screenshot({ path: path.join(output, `${engine}-${kind}-${width}-${mode}.png`), fullPage: true, animations: 'disabled' });
      if (width === 390 && kind === 'single') {
        await page.setViewportSize({ width: 844, height: 390 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Landscape email remains readable');
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Portrait restoration remains readable');
        await page.addStyleTag({ content: 'body{font-size:125%!important} p,td,th{font-size:1.1em!important}' });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Enlarged email text wraps without horizontal clipping');
      }
      proof.cases.push({ mode, width, kind, imagesBlocked: blockedImages, allShiftRowsVisible: true, noOverflow: true, contentHash: reports.get(kind).contentHash });
      await context.close();
    }
    proof.result = 'passed'; fs.writeFileSync(path.join(output, 'weekly-email-browser.json'), JSON.stringify(proof, null, 2));
    console.log(`Weekly HTML email browser proof passed: ${engine}, ${proof.cases.length} report/width/theme cases, complete rows and image-blocked readability. No email sent; inbox verification unavailable.`);
  } catch (error) {
    await activePage?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ error: error.message, completedCases: proof.cases.length }, null, 2)); throw error;
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
