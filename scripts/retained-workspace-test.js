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
  const event = { preventDefault() {} };
  const calls = [];
  const page = harness('workspace.js', async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/auth/me') return response(200, { user: { name: '<img onerror=alert(1)>', email: 'account@example.invalid', role: 'admin' } });
    return response(503, { message: 'Unavailable' });
  });
  await flush();
  assert.equal(page.get('welcomeTitle').textContent, 'Welcome, <img onerror=alert(1)>', 'identity uses text content, including imported markup');
  assert.equal(page.get('profileEmail').textContent, 'account@example.invalid');
  assert.deepEqual(calls.map((call) => call.url), ['/api/auth/me'], 'workspace reads only authenticated identity');
  assert.equal(calls[0].options.credentials, 'same-origin');
  await page.get('logoutButton').events.click();
  assert.match(page.get('workspaceStatus').textContent, /Sign out could not be confirmed/);
  assert.equal(page.context.localStorage.getItem('user'), 'cached', 'failed logout does not pretend session was ended');
  assert.equal(page.get('logoutButton').disabled, false);

  const signedOut = harness('workspace.js', async (url) => url === '/api/auth/me' ? response(200, { user: { username: 'Account fixture' } }) : response(200, { message: 'Signed out' }));
  await flush();
  assert.equal(signedOut.get('profileName').textContent, 'Account fixture');
  assert.equal(signedOut.get('profileEmail').textContent, 'Not available', 'missing email is not fabricated');
  await signedOut.get('logoutButton').events.click();
  assert.deepEqual(signedOut.destinations, ['/login']);
  for (const key of ['user', 'role', 'token']) assert.equal(signedOut.context.localStorage.getItem(key), null);

  const unauthorized = harness('workspace.js', async () => response(401, {}), { hash: '#account' });
  await flush();
  assert.deepEqual(unauthorized.destinations, ['/login?returnTo=%2Fdashboard%23account']);
  assert.equal(unauthorized.context.localStorage.getItem('token'), null);
  let identityAttempts = 0;
  const unavailable = harness('workspace.js', async () => ++identityAttempts === 1 ? response(500, {}) : response(200, { user: { name: 'Retry fixture', email: 'retry@example.invalid' } }));
  await flush();
  assert.equal(unavailable.get('profileName').textContent, 'Unavailable');
  assert.equal(unavailable.get('retryIdentity').hidden, false);
  assert.match(unavailable.get('workspaceStatus').textContent, /could not load your account/);
  await unavailable.get('retryIdentity').events.click();
  assert.equal(unavailable.get('profileName').textContent, 'Retry fixture');
  assert.equal(unavailable.get('workspaceStatus').textContent, '');
  assert.equal(unavailable.get('retryIdentity').hidden, true);
  const timeout = harness('workspace.js', async () => { const error = new Error('timeout'); error.name = 'AbortError'; throw error; });
  await flush();
  assert.match(timeout.get('workspaceStatus').textContent, /timed out/);
  const malformed = harness('workspace.js', async () => response(200, {}));
  await flush();
  assert.equal(malformed.get('retryIdentity').hidden, false);
  assert.match(malformed.get('workspaceStatus').textContent, /could not load your account/);

  for (const pageName of ['workspace.html', 'index.html', 'login.html', 'register.html']) {
    const html = read(pageName);
    assert.doesNotMatch(html, /request-quote|workspaceRfqForm|Customer RFQ|quote request|quotations/i, `${pageName} contains no removed business workflow`);
  }
  const workspace = read('workspace.html');
  for (const target of ['/profile', '/security', '/support', '/privacy', '/terms']) assert.ok(workspace.includes('href="' + target + '"'), 'actual retained route ' + target);

  const login = harness('login.js', async () => response(401, {}));
  for (const role of ['viewer', 'admin', 'staff', 'finance_admin', 'accountant', 'production']) assert.equal(login.context.portalPathForUser(role), '/dashboard');
  for (const target of ['/admin', '/finance', '/portal/staff', '/client', '//example.invalid', '/\\example.invalid', '/removed.html', '/request-quote']) {
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
  for (const target of ['/admin', '/finance/reports/RPT_example/view', '/portal/staff', '/request-quote', '//evil.invalid', '/security?returnTo=%2Fdashboard']) {
    const mfa = harness('mfa.js', async () => response(200, { user: { role: 'finance_admin' } }), { session: { vv_mfa_challenge: 'test-challenge', vv_mfa_return_to: target } });
    await mfa.get('mfaForm').events.submit(event);
    assert.deepEqual(mfa.destinations, [target.startsWith('/security?') ? target : '/dashboard']);
    assert.equal(mfa.context.sessionStorage.getItem('vv_mfa_challenge'), null);
  }
  console.log('Retained workspace regression passed: account identity/retry/error states, confirmed/failed logout, absence of removed business workflows, safe universal login and MFA navigation.');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
