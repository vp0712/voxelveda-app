'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (name) => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');
const flush = async () => { for (let n = 0; n < 8; n += 1) await Promise.resolve(); };
const response = (status, data) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json' }, json: async () => data });
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}
function nodes() {
  const map = new Map();
  const get = (id) => {
    if (!map.has(id)) map.set(id, { id, value: '', textContent: '', hidden: false, disabled: false, checked: false, dataset: {}, attributes: {}, events: {}, setAttribute(key, value) { this.attributes[key] = value; }, addEventListener(type, handler) { this.events[type] = handler; }, reportValidity: () => true });
    return map.get(id);
  };
  return { get, document: { getElementById: get, addEventListener() {} } };
}
function harness(file, fetchImpl, opts = {}) {
  const dom = nodes();
  const destinations = [];
  const context = { document: dom.document, fetch: fetchImpl, localStorage: storage({ user: 'cached', role: 'admin', token: 'old' }), sessionStorage: storage(opts.session), console, URLSearchParams, AbortController, setTimeout, clearTimeout, Date, window: { location: { pathname: '/login', hash: opts.hash || '', search: opts.search || '', replace: (target) => destinations.push(target) } }, history: { replaceState() {} } };
  vm.createContext(context);
  vm.runInContext(read(file), context, { filename: file });
  return { ...dom, context, destinations };
}
async function run() {
  const calls = [];
  let pendingSubmit;
  const page = harness('workspace.js', async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/auth/me') return response(200, { user: { name: '<img onerror=alert(1)>', email: 'customer@example.invalid', role: 'admin' } });
    if (url === '/api/public/rfq') return new Promise((resolve) => { pendingSubmit = resolve; });
    return response(503, { message: 'Unavailable' });
  });
  await flush();
  assert.equal(page.get('rfqFields').disabled, false);
  assert.equal(page.get('welcomeTitle').textContent, 'Welcome, <img onerror=alert(1)>', 'identity uses text content, including imported markup');
  assert.equal(page.get('customerEmail').value, 'customer@example.invalid');
  assert.equal(calls[0].options.credentials, 'same-origin');
  page.get('rfqPrivacy').checked = true;
  page.get('projectQuantity').value = '7';
  page.get('projectDetails').value = 'Precision part';
  page.get('projectDeadline').value = '2026-10-30';
  const event = { preventDefault() {} };
  const first = page.get('workspaceRfqForm').events.submit(event);
  const duplicate = page.get('workspaceRfqForm').events.submit(event);
  assert.equal(calls.filter((call) => call.url === '/api/public/rfq').length, 1, 'double submit is guarded');
  assert.equal(page.get('rfqSubmit').disabled, true);
  const payload = JSON.parse(calls.at(-1).options.body);
  assert.equal(payload.quantity, 7);
  assert.equal(payload.application, 'Precision part\nTarget date: 2026-10-30');
  assert.deepEqual(Object.keys(payload).sort(), ['application', 'customer_name', 'email', 'material', 'phone', 'quantity']);
  pendingSubmit(response(200, { rfq_id: 42 }));
  await Promise.all([first, duplicate]);
  assert.match(page.get('rfqStatus').textContent, /Reference #42/);
  assert.equal(page.get('rfqPrivacy').checked, false);
  assert.equal(page.get('rfqSubmit').disabled, false);
  assert.equal(page.get('projectDetails').value, '');
  await page.get('logoutButton').events.click();
  assert.match(page.get('workspaceStatus').textContent, /Sign out could not be confirmed/);
  assert.equal(page.context.localStorage.getItem('user'), 'cached', 'failed logout does not pretend session was ended');

  const unauthorized = harness('workspace.js', async () => response(401, {}), { hash: '#new-rfq' });
  await flush();
  assert.deepEqual(unauthorized.destinations, ['/login?returnTo=%2Fdashboard%23new-rfq']);
  assert.equal(unauthorized.context.localStorage.getItem('token'), null);
  const unavailable = harness('workspace.js', async () => response(500, {}));
  await flush();
  assert.equal(unavailable.get('rfqFields').disabled, true);
  assert.equal(unavailable.get('retryIdentity').hidden, false);
  assert.match(unavailable.get('workspaceStatus').textContent, /could not load your account/);
  const timeout = harness('workspace.js', async () => { const error = new Error('timeout'); error.name = 'AbortError'; throw error; });
  await flush();
  assert.match(timeout.get('workspaceStatus').textContent, /timed out/);
  const negative = harness('workspace.js', async (url) => url === '/api/auth/me' ? response(200, { user: { email: 'a@example.invalid' } }) : response(400, { message: 'Invalid request' }));
  await flush();
  negative.get('rfqPrivacy').checked = true;
  negative.get('projectQuantity').value = '0';
  await negative.get('workspaceRfqForm').events.submit(event);
  assert.match(negative.get('rfqStatus').textContent, /whole number/);

  let publicCalls = 0;
  let publicResolve;
  const publicForm = harness('customer.js', async () => { publicCalls += 1; return new Promise((resolve) => { publicResolve = resolve; }); });
  publicForm.get('customerQuantity').value = '1';
  await publicForm.get('customerRfqForm').events.submit(event);
  assert.equal(publicCalls, 0, 'public intake requires consent');
  publicForm.get('privacyAccepted').checked = true;
  const publicFirst = publicForm.get('customerRfqForm').events.submit(event);
  const publicDuplicate = publicForm.get('customerRfqForm').events.submit(event);
  assert.equal(publicCalls, 1);
  publicResolve(response(200, {}));
  await Promise.all([publicFirst, publicDuplicate]);
  assert.match(publicForm.get('customerStatus').textContent, /did not confirm a request reference/);
  assert.equal(publicForm.get('customerStatus').dataset.tone, 'error', 'unconfirmed success is not reported as submission');
  assert.equal(publicForm.get('privacyAccepted').checked, true, 'unconfirmed submission preserves form content');

  const login = harness('login.js', async () => response(401, {}));
  for (const role of ['viewer', 'admin', 'staff', 'finance_admin', 'accountant', 'production']) assert.equal(login.context.portalPathForUser(role), '/dashboard');
  for (const target of ['/admin', '/finance', '/portal/staff', '/client', '//example.invalid', '/\\example.invalid', '/removed.html']) {
    login.context.window.location.search = '?returnTo=' + encodeURIComponent(target);
    assert.equal(login.context.safeReturnTo('admin'), '/dashboard', target);
  }
  login.context.window.location.search = '?returnTo=' + encodeURIComponent('/security?mfa_setup=required');
  assert.equal(login.context.safeReturnTo('viewer'), '/security?mfa_setup=required');
  login.context.window.location.search = '?returnTo=%2Fprofile';
  assert.equal(login.context.safeReturnTo('viewer'), '/profile');
  const saved = harness('login.js', async () => response(200, { user: { role: 'staff' } }), { search: '?returnTo=%2Fsecurity' });
  await saved.context.redirectSavedSession();
  assert.deepEqual(saved.destinations, ['/security'], 'saved sessions retain current account navigation');
  for (const target of ['/admin', '/finance/reports/RPT_example/view', '/portal/staff', '//evil.invalid', '/security?returnTo=%2Fdashboard']) {
    const mfa = harness('mfa.js', async () => response(200, { user: { role: 'finance_admin' } }), { session: { vv_mfa_challenge: 'test-challenge', vv_mfa_return_to: target } });
    await mfa.get('mfaForm').events.submit(event);
    assert.deepEqual(mfa.destinations, [target.startsWith('/security?') ? target : '/dashboard']);
    assert.equal(mfa.context.sessionStorage.getItem('vv_mfa_challenge'), null);
  }
  console.log('Retained workspace regression passed: identity/error states, consent/quantity, duplicate submission, confirmed reference, failed logout, safe universal login and MFA navigation.');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
