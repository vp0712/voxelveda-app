"use strict";
// Public production console evidence. Never submits a form or creates a session.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.VV_BROWSER_MODULE_PATH || 'playwright');
const origin = 'https://app.voxelveda.com';
const expected = process.env.VV_EXPECTED_COMMIT;
assert.match(expected || '', /^[a-f0-9]{40}$/, 'An exact deployed revision is required');
const out = process.env.VV_PROOF_DIR || path.resolve('production-console-proof');
fs.mkdirSync(out, { recursive: true });
const proof = {
  origin, expected_commit: expected, started_at: new Date().toISOString(),
  scope: 'Anonymous public GET navigation only in fresh Chromium contexts with service workers blocked so network interception remains enforceable. No private identity, form submission, account write or email. Automatic CSP-report POSTs are intercepted in the isolated browser and recorded; CSP POST delivery is not tested.',
  pages: [], console: [], page_errors: [], asset_failures: [],
  intercepted_csp_reports: [], public_api_responses: [], unexpected_non_get_requests: [], overflowed_console_capture: false
};
function publicUrl(value) {
  if (!value) return '';
  try { const url = new URL(value, origin); return url.origin + url.pathname; }
  catch { return String(value).slice(0, 160); }
}
function safeText(value) {
  return String(value)
    .replace(/https?:\/\/[^\s"'<>]+/g, url => publicUrl(url))
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted token]')
    .replace(/\b(?:Bearer|token|password|secret)\s*[:=]\s*[^\s,;]+/gi, '[redacted sensitive value]')
    .slice(0, 1600);
}
function isReportOnlyCsp(text) {
  return /content security policy|content-security-policy/i.test(text)
    && /\[report only\]|policy is report-only|report-only policy/i.test(text);
}
async function main() {
  const response = await fetch(origin + '/api/ready', {
    signal: AbortSignal.timeout(15000), headers: { 'Cache-Control': 'no-cache' }
  });
  const ready = await response.json();
  assert.equal(response.status, 200, 'Production readiness must be healthy');
  assert.equal(ready.ready, true);
  assert.equal(ready.deployment_sha, expected, 'Verify the deployed release, not the verification-source commit');
  proof.ready = { status: response.status, ready: ready.ready, deployment_sha: ready.deployment_sha };
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    for (const viewport of [{ name: 'phone', width: 375, height: 812 }, { name: 'desktop', width: 1440, height: 1000 }]) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, serviceWorkers: 'block' });
      // Prevent browser-generated telemetry writes; do not waive any console failures.
      await context.route('**/*', async route => {
        const request = route.request();
        if (['GET', 'HEAD'].includes(request.method())) return route.continue();
        const url = new URL(request.url());
        if (request.method() === 'POST' && url.origin === origin && url.pathname === '/api/security/csp-report') {
          proof.intercepted_csp_reports.push({ viewport: viewport.name, method: 'POST', url: publicUrl(request.url()), sent_to_server: false });
          return route.fulfill({ status: 204 });
        }
        proof.unexpected_non_get_requests.push({ viewport: viewport.name, method: request.method(), url: publicUrl(request.url()) });
        return route.abort('blockedbyclient');
      });
      const page = await context.newPage();
      let currentRoute = '';
      let captured = 0;
      page.on('console', message => {
        if (++captured > 250) { proof.overflowed_console_capture = true; return; }
        const original = message.text();
        const location = message.location();
        proof.console.push({
          viewport: viewport.name, route: currentRoute, type: message.type(),
          classification: isReportOnlyCsp(original) ? 'report_only_csp' : 'unclassified',
          text: safeText(original), url: publicUrl(location.url), line: location.lineNumber, column: location.columnNumber
        });
      });
      page.on('pageerror', error => proof.page_errors.push({ viewport: viewport.name, route: currentRoute, text: safeText(error.message) }));
      page.on('response', response => {
        const destination = new URL(response.url());
        if (destination.origin === origin && destination.pathname.startsWith('/api/'))
          proof.public_api_responses.push({ viewport: viewport.name, route: currentRoute, method: response.request().method(), url: publicUrl(response.url()), status: response.status() });
        const type = response.request().resourceType();
        if (['script', 'stylesheet', 'image', 'font'].includes(type) && response.status() >= 400)
          proof.asset_failures.push({ viewport: viewport.name, route: currentRoute, type, status: response.status(), url: publicUrl(response.url()) });
      });
      page.on('requestfailed', request => {
        const type = request.resourceType();
        if (['script', 'stylesheet', 'image', 'font'].includes(type))
          proof.asset_failures.push({ viewport: viewport.name, route: currentRoute, type, url: publicUrl(request.url()), error: safeText(request.failure()?.errorText || 'Request failed') });
      });
      for (const route of ['/', '/login', '/register', '/support', '/privacy', '/terms']) {
        currentRoute = route;
        const response = await page.goto(origin + route, { waitUntil: 'domcontentloaded' });
        assert.equal(response.status(), 200, route + ' loads successfully');
        await page.getByRole('heading', { level: 1 }).waitFor({ state: 'visible' });
        await page.waitForFunction(() => document.readyState === 'complete'
          && [...document.images].every(img => img.complete && img.naturalWidth > 0)
          && (!document.fonts || document.fonts.status === 'loaded'));
        await page.locator('#vvGlobalBrandLoader').waitFor({ state: 'hidden' });
        await page.waitForTimeout(400);
        const result = await page.evaluate(() => ({
          heading: document.querySelector('h1')?.textContent,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          broken_images: [...document.images].filter(img => !img.complete || img.naturalWidth === 0).length
        }));
        assert.equal(result.overflow, false, viewport.name + ' ' + route + ' does not overflow');
        assert.equal(result.broken_images, 0);
        proof.pages.push({ viewport, route, status: 200, ...result, settled: true });
      }
      await context.close();
    }
  } finally { await browser.close(); }
  proof.summary = {
    pages: proof.pages.length,
    unclassified_console_errors: proof.console.filter(entry => entry.type === 'error' && entry.classification === 'unclassified').length,
    report_only_csp_diagnostics: proof.console.filter(entry => entry.classification === 'report_only_csp').length,
    other_warnings: proof.console.filter(entry => entry.type === 'warning' && entry.classification === 'unclassified').length,
    page_errors: proof.page_errors.length, asset_failures: proof.asset_failures.length,
    intercepted_csp_reports: proof.intercepted_csp_reports.length
  };
  assert.equal(proof.overflowed_console_capture, false, 'Console evidence must not be silently truncated');
  assert.deepEqual(proof.unexpected_non_get_requests, [], 'Only anonymous GET/HEAD navigation is permitted');
  assert.deepEqual(proof.page_errors, [], 'No uncaught browser JavaScript errors');
  assert.deepEqual(proof.asset_failures, [], 'No missing or failing scripts, styles, images or fonts');
  assert.equal(proof.summary.unclassified_console_errors, 0, 'All unclassified browser console errors fail verification');
  proof.result = 'passed';
}
main().catch(error => {
  proof.result = 'failed'; proof.error = safeText(error.message); console.error(error);
  process.exitCode = 1;
}).finally(() => {
  proof.completed_at = new Date().toISOString();
  fs.writeFileSync(path.join(out, 'production-console-verification.json'), JSON.stringify(proof, null, 2));
  console.log('VV_CONSOLE_JSON ' + JSON.stringify(proof));
});
