'use strict';
// Exercises the real account-security event handlers with deferred HTTP replies.
// This is a small DOM fixture, not browser, native-device or production evidence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const markup = fs.readFileSync(path.join(__dirname, '../public/security.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '../public/security-page.js'), 'utf8');
const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const decode = text => text.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

class Element {
  constructor(tag = 'div', attributes = {}) {
    this.tagName = tag.toLowerCase(); this.attributes = { ...attributes }; this.children = []; this.parentNode = null;
    this.listeners = new Map(); this.style = {}; this.value = attributes.value || ''; this.disabled = 'disabled' in attributes;
    this.hidden = 'hidden' in attributes; this.focused = false; this._text = '';
  }
  append(child) { child.parentNode = this; this.children.push(child); }
  get id() { return this.attributes.id || ''; }
  get className() { return this.attributes.class || ''; }
  set className(value) { this.attributes.class = value; }
  get dataset() { return Object.fromEntries(Object.entries(this.attributes).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5), value])); }
  get src() { return this.attributes.src || ''; }
  set src(value) { this.attributes.src = value; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get innerHTML() { return escape(this._text) + this.children.map(child => '<' + child.tagName + '>' + child.innerHTML + '</' + child.tagName + '>').join(''); }
  set innerHTML(value) { this.children = []; this._text = ''; parse(String(value), this); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return Object.hasOwn(this.attributes, key) ? this.attributes[key] : null; }
  removeAttribute(key) { delete this.attributes[key]; }
  matches(selector) { return selector.startsWith('.') ? this.className.split(/\s+/).includes(selector.slice(1)) : selector.startsWith('#') ? this.id === selector.slice(1) : this.tagName === selector; }
  querySelectorAll(selectors) {
    const choices = selectors.split(',').map(value => value.trim()), result = [];
    const visit = parent => { for (const child of parent.children) { if (choices.some(selector => child.matches(selector))) result.push(child); visit(child); } };
    visit(this); return result;
  }
  querySelector(selectors) { return this.querySelectorAll(selectors)[0] || null; }
  closest(selector) { for (let node = this; node; node = node.parentNode) if (node.matches(selector)) return node; return null; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  focus() { this.focused = true; }
  addEventListener(name, listener) { const list = this.listeners.get(name) || []; list.push(listener); this.listeners.set(name, list); }
  dispatch(name, detail = {}) { const event = { target: this, preventDefault() { this.defaultPrevented = true; }, ...detail }; for (const listener of this.listeners.get(name) || []) listener(event); return event; }
}
function parse(html, root = new Element('document')) {
  const stack = [root], voids = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  for (const token of html.match(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g) || []) {
    if (token.startsWith('<!--') || token.startsWith('<!')) continue;
    if (token.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
    if (token.startsWith('<')) {
      const tag = token.match(/^<([\w-]+)/)?.[1]; if (!tag) continue;
      const attrs = {};
      for (const match of token.slice(tag.length + 1, -1).matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[match[1]] = decode(match[2] ?? match[3] ?? match[4] ?? '');
      const node = new Element(tag, attrs); stack.at(-1).append(node); if (!voids.has(tag.toLowerCase()) && !token.endsWith('/>')) stack.push(node);
    } else stack.at(-1)._text += decode(token);
  }
  return root;
}
const tick = async () => { for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve)); };
function fixture() {
  const document = parse(markup); document.getElementById = id => document.querySelector('#' + id); document.createElement = tag => new Element(tag);
  const window = new Element('window'), calls = [], alerts = [], redirects = [], logs = [], timers = new Map(); let sequence = 0, account = { id: 'staff-a' };
  window.VoxelFeedback = { show: details => { alerts.push(details); return Promise.resolve(); } };
  const context = {
    window, document, location: { replace: url => redirects.push(url) },
    localStorage: { getItem: key => key === 'user' ? JSON.stringify(account) : null },
    AbortController, TypeError, console: Object.fromEntries(['log', 'warn', 'error', 'info', 'debug'].map(key => [key, (...args) => logs.push(args)])),
    setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
    fetch(url, options) { return new Promise((resolve, reject) => {
      calls.push({ url, options, resolve, reject, finished: false });
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('Fixture request timed out'), { name: 'AbortError' })), { once: true });
    }); }
  };
  vm.runInNewContext(source, context, { filename: 'public/security-page.js' });
  const node = id => { const found = document.getElementById(id); assert(found, 'Real page control exists: ' + id); return found; };
  const next = url => { const call = calls.find(call => call.url === url && !call.finished); assert(call, 'Expected pending request to ' + url); call.finished = true; return call; };
  return {
    document, window, calls, alerts, redirects, logs, timers, node,
    count: url => calls.filter(call => call.url === url).length,
    submit(id) { node(id).dispatch('submit'); },
    click(id) { node(id).dispatch('click'); },
    revoke(id) { const button = node('sessions').querySelectorAll('button').find(button => button.dataset.id === id); assert(button, 'Rendered sign-out action for ' + id); document.dispatch('click', { target: button }); return button; },
    async answer(url, status, body) { const call = next(url); call.resolve({ status, ok: status >= 200 && status < 300, json: async () => body }); await tick(); },
    async fail(url, error = new TypeError('Fixture network interruption')) { next(url).reject(error); await tick(); },
    async ready(sessions = defaultSessions) { await this.answer('/api/auth/sessions', 200, { sessions }); await this.answer('/api/auth/mfa/status', 200, { enabled: false, required: false }); },
    switchAccount(id = 'staff-b') { account = { id }; window.dispatch('storage', { key: 'user' }); },
    updateProfile(fields) { account = { ...account, ...fields }; window.dispatch('storage', { key: 'user' }); },
    restoreWithAccount(id) { account = { id }; window.dispatch('pageshow', { persisted: true }); },
    assertNoSecretLeak(secrets) {
      const exposed = JSON.stringify({ logs, urls: calls.map(call => call.url), redirects, alerts });
      for (const secret of secrets) assert(!exposed.includes(secret), 'Private values are absent from logs, URLs and feedback');
      for (const call of calls) assert.equal(call.options.credentials, 'same-origin', 'Security requests preserve cookie authentication');
    }
  };
}
const defaultSessions = [
  { id: 'current', current: true, user_agent: 'Current fixture device', last_seen_at: '2026-10-29T09:00:00Z' },
  { id: 'remote-a', current: false, user_agent: 'Other fixture device', last_seen_at: '2026-10-29T08:00:00Z' },
  { id: 'remote-b', current: false, user_agent: 'Second fixture device', last_seen_at: '2026-10-29T07:00:00Z' }
];
const cases = [];
function test(name, run) { cases.push({ name, run }); }

test('failed reads show explicit retry, retain saved register and recover without a false empty state', async () => {
  const f = fixture(); await f.fail('/api/auth/sessions'); await f.fail('/api/auth/mfa/status');
  assert.equal(f.node('retrySessionsBtn').hidden, false); assert.match(f.node('sessionsStatus').textContent, /unavailable/i);
  assert(!/No active sessions/.test(f.node('sessions').textContent)); assert.equal(f.node('retryMfaBtn').hidden, false);
  assert.match(f.node('mfaStatus').textContent, /unavailable/i); assert.equal(f.node('sessions').getAttribute('aria-busy'), 'false');
  f.click('retrySessionsBtn'); f.click('retryMfaBtn'); await f.ready();
  assert.match(f.node('sessions').textContent, /Other fixture device/); assert.equal(f.node('retrySessionsBtn').hidden, true);
  f.click('retrySessionsBtn'); await f.fail('/api/auth/sessions'); assert.match(f.node('sessions').textContent, /Other fixture device/);
  assert.match(f.node('sessionsStatus').textContent, /Last loaded.*failed/i); assert.equal(f.node('retrySessionsBtn').hidden, false);
});

test('MFA, password and individual/all-session writes reject duplicate taps while pending', async () => {
  const actions = [
    { form: 'mfaStartForm', field: 'mfaPassword', value: 'Current-private-password', url: '/api/auth/mfa/enroll/start' },
    { form: 'mfaConfirmForm', field: 'mfaConfirmCode', value: '123456', url: '/api/auth/mfa/enroll/confirm' },
    { form: 'changePasswordForm', field: 'currentPassword', value: 'Current-private-password', url: '/api/auth/change-password' }
  ];
  for (const action of actions) {
    const f = fixture(); await f.ready(); f.node(action.field).value = action.value; f.node('newPassword').value = 'Different-private-password';
    f.submit(action.form); f.submit(action.form); assert.equal(f.count(action.url), 1); assert.equal(f.node(action.form).getAttribute('aria-busy'), 'true');
    for (const control of f.node(action.form).querySelectorAll('input,button')) assert.equal(control.disabled, true);
    await f.answer(action.url, 422, { message: 'Validation requires review.' }); assert.equal(f.node(action.form).getAttribute('aria-busy'), 'false');
  }
  const f = fixture(); await f.ready(); f.revoke('remote-a'); f.revoke('remote-a'); assert.equal(f.count('/api/auth/sessions/remote-a'), 1);
  f.click('revokeOthers'); f.click('revokeOthers'); assert.equal(f.count('/api/auth/sessions/revoke-others'), 1);
});

test('HTTP validation remains failure even when its message says saved; private inputs remain editable', async () => {
  for (const action of [
    { form: 'changePasswordForm', field: 'currentPassword', url: '/api/auth/change-password' },
    { form: 'mfaStartForm', field: 'mfaPassword', url: '/api/auth/mfa/enroll/start' },
    { form: 'mfaConfirmForm', field: 'mfaConfirmCode', url: '/api/auth/mfa/enroll/confirm' }
  ]) {
    const f = fixture(); await f.ready(); const value = action.field === 'mfaConfirmCode' ? '123456' : 'Private-input-must-survive';
    f.node(action.field).value = value; f.node('newPassword').value = 'New-private-password'; f.submit(action.form);
    await f.answer(action.url, 422, { message: 'Not saved: review the required value.' });
    assert.equal(f.node('status').getAttribute('role'), 'alert'); assert.equal(f.alerts.at(-1).kind, 'error'); assert.equal(f.node(action.field).value, value);
    assert.equal(f.node(action.field).disabled, false); assert.equal(f.node('mfaSetup').hidden, true); assert.equal(f.node('newRecovery').hidden, true); assert.deepEqual(f.redirects, []);
  }
});

test('uncertain password/setup results stay held across retries and status reads without automatic resend', async () => {
  for (const action of [
    { form: 'changePasswordForm', field: 'currentPassword', url: '/api/auth/change-password', failure: 'network' },
    { form: 'mfaStartForm', field: 'mfaPassword', url: '/api/auth/mfa/enroll/start', failure: 'server' },
    { form: 'mfaStartForm', field: 'mfaPassword', url: '/api/auth/mfa/enroll/start', failure: 'malformed' }
  ]) {
    const f = fixture(); await f.ready(); f.node(action.field).value = 'Uncertain-private-password'; f.submit(action.form);
    if (action.failure === 'network') await f.fail(action.url);
    else await f.answer(action.url, action.failure === 'server' ? 503 : 200, action.failure === 'server' ? { message: 'Unavailable' } : { qr_code: 'https://invalid.test/key', manual_key: 'invalid' });
    assert.equal(f.node(action.field).disabled, true); assert.match(f.node('status').textContent, /uncertain/i);
    f.submit(action.form); f.click('refreshSecurityBtn'); await f.ready(); f.submit(action.form);
    assert.equal(f.count(action.url), 1); assert.equal(f.node(action.field).disabled, true); assert.equal(f.node('mfaQr').src, ''); assert.equal(f.node('mfaSetup').hidden, true);
  }
});

test('a timed-out password request holds its entered values and cannot be resent automatically', async () => {
  const f = fixture(); await f.ready(); f.node('currentPassword').value = 'Private-timeout-value'; f.node('newPassword').value = 'New-private-timeout-value';
  f.submit('changePasswordForm'); const timeout = [...f.timers.values()].find(timer => timer.delay === 15000); assert(timeout); timeout.callback(); await tick();
  assert.equal(f.node('currentPassword').value, 'Private-timeout-value'); assert.equal(f.node('currentPassword').disabled, true);
  assert.match(f.node('status').textContent, /uncertain/i); f.submit('changePasswordForm'); assert.equal(f.count('/api/auth/change-password'), 1); assert.deepEqual(f.redirects, []);
});

test('uncertain individual sign-out stays held until its known target disappears from a successful read', async () => {
  const f = fixture(); await f.ready(); f.revoke('remote-a'); await f.fail('/api/auth/sessions/remote-a');
  f.revoke('remote-a'); assert.equal(f.count('/api/auth/sessions/remote-a'), 1);
  f.click('retrySessionsBtn'); await f.fail('/api/auth/sessions'); f.revoke('remote-a'); assert.equal(f.count('/api/auth/sessions/remote-a'), 1);
  f.click('retrySessionsBtn'); await f.answer('/api/auth/sessions', 200, { sessions: defaultSessions }); f.revoke('remote-a'); assert.equal(f.count('/api/auth/sessions/remote-a'), 1, 'Still listed means no automatic resend');
  f.click('retrySessionsBtn'); await f.answer('/api/auth/sessions', 200, { sessions: defaultSessions.filter(session => session.id !== 'remote-a') });
  assert.match(f.node('status').textContent, /confirmed by the current session register/i); assert.equal(f.node('status').getAttribute('role'), 'status');
  assert(!f.node('sessions').querySelectorAll('button').some(button => button.dataset.id === 'remote-a'));
});

test('uncertain all-session sign-out clears only after every known non-current target is absent', async () => {
  const f = fixture(); await f.ready(); f.click('revokeOthers'); await f.fail('/api/auth/sessions/revoke-others');
  f.click('retrySessionsBtn'); await f.answer('/api/auth/sessions', 200, { sessions: defaultSessions.filter(session => session.id !== 'remote-a') });
  assert.equal(f.node('revokeOthers').disabled, true); f.click('revokeOthers'); assert.equal(f.count('/api/auth/sessions/revoke-others'), 1);
  f.click('retrySessionsBtn'); await f.answer('/api/auth/sessions', 200, { sessions: defaultSessions.filter(session => session.current) });
  assert.equal(f.node('revokeOthers').disabled, false); assert.match(f.node('status').textContent, /confirmed/i);
});

test('unknown session inventory cannot falsely reconcile an uncertain all-session sign-out', async () => {
  const f = fixture(); f.click('revokeOthers'); await f.fail('/api/auth/sessions/revoke-others');
  await f.ready(); f.click('revokeOthers');
  assert.equal(f.count('/api/auth/sessions/revoke-others'), 1, 'An unverified prior target list cannot authorise another send');
  assert(!/sign-out is confirmed/.test(f.node('status').textContent), 'A session read cannot prove an unknown earlier target set was signed out');
});

test('confirmed sign-out stays successful when its follow-up register refresh fails', async () => {
  const f = fixture(); await f.ready(); f.revoke('remote-a'); await f.answer('/api/auth/sessions/remote-a', 200, { success: true });
  await f.fail('/api/auth/sessions'); assert.equal(f.node('status').getAttribute('role'), 'status'); assert.match(f.node('status').textContent, /was signed out/i);
  assert(!f.node('sessions').querySelectorAll('button').some(button => button.dataset.id === 'remote-a')); assert.equal(f.node('retrySessionsBtn').hidden, false);
  assert.match(f.node('sessionsStatus').textContent, /Refresh failed/i); assert.equal(f.count('/api/auth/sessions/remote-a'), 1);
});

test('MFA confirmation can reconcile enabled state without inventing recovery codes or resending', async () => {
  const f = fixture(); await f.ready(); f.node('mfaConfirmCode').value = '123456'; f.submit('mfaConfirmForm'); await f.fail('/api/auth/mfa/enroll/confirm');
  assert.equal(f.node('mfaConfirmCode').disabled, true); f.click('retryMfaBtn'); await f.answer('/api/auth/mfa/status', 200, { enabled: false });
  assert.equal(f.node('mfaConfirmCode').disabled, true); f.click('retryMfaBtn'); await f.answer('/api/auth/mfa/status', 200, { enabled: true, recovery_codes_remaining: 2 });
  assert.equal(f.node('mfaConfirmCode').disabled, false); assert.equal(f.node('mfaSetup').hidden, true); assert.equal(f.node('newRecovery').hidden, true);
  assert.equal(f.node('newRecoveryCodes').textContent, ''); assert.equal(f.count('/api/auth/mfa/enroll/confirm'), 1); assert.match(f.node('status').textContent, /no codes were invented/i);
});

test('newer read wins and attacker-controlled device text is rendered as text', async () => {
  const f = fixture(); f.click('retrySessionsBtn');
  // The newest reply arrives first. Resolving by URL normally chooses oldest.
  const older = f.calls.find(call => call.url === '/api/auth/sessions'), newer = f.calls.filter(call => call.url === '/api/auth/sessions')[1];
  newer.finished = true; newer.resolve({ status: 200, ok: true, json: async () => ({ sessions: [{ ...defaultSessions[0], user_agent: '<img src=x onerror=alert(1)>' }] }) }); await tick();
  assert.match(f.node('sessions').textContent, /<img src=x onerror=alert\(1\)>/); assert.equal(f.node('sessions').querySelectorAll('img').length, 0);
  older.finished = true; older.resolve({ status: 200, ok: true, json: async () => ({ sessions: defaultSessions }) }); await tick();
  assert(!f.node('sessions').textContent.includes('Other fixture device')); assert.match(f.node('sessionsStatus').textContent, /^1 active session/);
});

test('old-account setup, recovery codes and session responses never appear after account switching', async () => {
  for (const action of ['setup', 'recovery', 'sessions']) {
    const f = fixture(); await f.ready();
    if (action === 'setup') { f.node('mfaPassword').value = 'Old-account-password'; f.submit('mfaStartForm'); }
    if (action === 'recovery') { f.node('mfaConfirmCode').value = '123456'; f.submit('mfaConfirmForm'); }
    if (action === 'sessions') f.click('retrySessionsBtn');
    f.switchAccount();
    for (const form of ['mfaStartForm','mfaConfirmForm','changePasswordForm']) {
      assert.equal(f.node(form).dataset.nativeRequestState, undefined, 'Account switching clears stale native Back request ownership');
      assert.equal(f.node(form).getAttribute('aria-busy'), 'false');
    }
    if (action === 'setup') await f.answer('/api/auth/mfa/enroll/start', 200, { qr_code: 'data:image/png;base64,T0xE', manual_key: 'ABCDEFGHIJKLMNOP' });
    if (action === 'recovery') await f.answer('/api/auth/mfa/enroll/confirm', 200, { recovery_codes: ['old-account-private-code'] });
    if (action === 'sessions') await f.answer('/api/auth/sessions', 200, { sessions: defaultSessions });
    assert.equal(f.node('mfaQr').src, ''); assert.equal(f.node('mfaManual').value, ''); assert.equal(f.node('mfaPassword').value, '');
    assert.equal(f.node('newRecovery').hidden, true); assert.equal(f.node('newRecoveryCodes').textContent, ''); assert.equal(f.node('sessions').textContent, '');
    await f.ready([{ ...defaultSessions[0], user_agent: 'New account device' }]); assert.match(f.node('sessions').textContent, /New account device/); assert(!f.node('sessions').textContent.includes('Other fixture device'));
    const form = action === 'setup' ? 'mfaStartForm' : action === 'recovery' ? 'mfaConfirmForm' : null;
    if (form) for (const control of f.node(form).querySelectorAll('input,button')) assert.equal(control.disabled, false, 'Account switch restores the new account controls');
  }
});

test('a stale old-account authentication failure cannot redirect the new signed-in account', async () => {
  const f = fixture(); f.switchAccount(); await f.answer('/api/auth/sessions', 401, { message: 'Old account session expired.' });
  assert.deepEqual(f.redirects, [], 'Old account authentication outcomes do not navigate the current account');
  await f.answer('/api/auth/mfa/status', 401, { message: 'Old account session expired.' }); assert.deepEqual(f.redirects, []);
  await f.ready([{ ...defaultSessions[0], user_agent: 'New account device' }]); assert.match(f.node('sessions').textContent, /New account device/);
});

test('a current-account 401 still requires sign-in instead of displaying unauthorised security data', async () => {
  const f = fixture(); await f.answer('/api/auth/sessions', 401, { sessions: defaultSessions });
  assert.deepEqual(f.redirects, ['/login?returnTo=%2Fsecurity']); assert.equal(f.node('sessions').textContent, '');
});

test('old-account write completion cannot release the new account duplicate guard', async () => {
  const f = fixture(); await f.ready(); f.node('currentPassword').value = 'Old-private-value'; f.submit('changePasswordForm');
  f.switchAccount(); await f.ready(); f.node('currentPassword').value = 'New-private-value'; f.submit('changePasswordForm');
  assert.equal(f.count('/api/auth/change-password'), 2); await f.answer('/api/auth/change-password', 422, { message: 'Old account result.' });
  f.submit('changePasswordForm'); assert.equal(f.count('/api/auth/change-password'), 2); assert.equal(f.node('currentPassword').disabled, true);
  await f.answer('/api/auth/change-password', 422, { message: 'New account validation.' }); assert.equal(f.node('currentPassword').disabled, false); assert.equal(f.node('currentPassword').value, 'New-private-value');
});

test('MFA confirmation retains one-time recovery codes without automatic reads, redirects or repeated confirmation', async () => {
  const f = fixture(); await f.answer('/api/auth/mfa/status', 200, { enabled: false });
  // The initial session read remains in flight while MFA revokes prior sessions.
  f.node('mfaConfirmCode').value = '123456'; f.submit('mfaConfirmForm');
  await f.answer('/api/auth/mfa/enroll/confirm', 200, { recovery_codes: ['private-one-time-code'] });
  assert.equal(f.node('newRecovery').hidden, false); assert.equal(f.node('newRecoveryCodes').textContent, 'private-one-time-code');
  assert.equal(f.count('/api/auth/mfa/status'), 1); assert.equal(f.count('/api/auth/sessions'), 1); assert.deepEqual(f.redirects, []);
  f.window.dispatch('pageshow', { persisted: true }); await tick();
  assert.equal(f.count('/api/auth/mfa/status'), 1); assert.equal(f.count('/api/auth/sessions'), 1);
  await f.answer('/api/auth/sessions', 401, { message: 'Session revoked after confirmed MFA enrollment.' });
  assert.deepEqual(f.redirects, [], 'Expected post-enrollment 401 cannot discard one-time codes'); assert.equal(f.node('newRecoveryCodes').textContent, 'private-one-time-code');
  assert.equal(f.node('refreshSecurityBtn').disabled, true); assert.match(f.node('recoveryContinue').getAttribute('href'), /^\/login(?:\?|$)/);
  assert.equal(f.node('mfaConfirmForm').nativeHasUnsavedChanges(), true, 'Native Back protects unsaved recovery codes');
  f.click('recoveryContinue'); assert.equal(f.node('mfaConfirmForm').nativeHasUnsavedChanges(), false, 'Explicit Continue permits leaving after the employee saves the codes');
});

test('same-account profile storage updates preserve entered values and authenticator setup without new reads', async () => {
  const f = fixture(); await f.ready(); f.node('mfaPassword').value = 'Setup-private-value'; f.submit('mfaStartForm');
  await f.answer('/api/auth/mfa/enroll/start', 200, { qr_code: 'data:image/png;base64,U0FNRQ==', manual_key: 'ABCDEFGHIJKLMNOP' });
  f.node('currentPassword').value = 'Entered-current-private-value'; f.node('newPassword').value = 'Entered-new-private-value'; f.node('mfaConfirmCode').value = '123456';
  const before = f.calls.length, sessions = f.node('sessions').textContent;
  f.updateProfile({ name: 'Updated profile name', photo: '/api/profile/avatar' }); await tick();
  assert.equal(f.calls.length, before, 'A same-ID profile update does not reset or reload security state');
  assert.equal(f.node('currentPassword').value, 'Entered-current-private-value'); assert.equal(f.node('newPassword').value, 'Entered-new-private-value');
  assert.equal(f.node('mfaConfirmCode').value, '123456'); assert.equal(f.node('mfaQr').src, 'data:image/png;base64,U0FNRQ==');
  assert.equal(f.node('mfaManual').value, 'ABCDEFGHIJKLMNOP'); assert.equal(f.node('mfaSetup').hidden, false); assert.equal(f.node('sessions').textContent, sessions);
});

test('same-owner cached-page restoration preserves one-time codes and avoids revoked-session reads', async () => {
  const f = fixture(); await f.ready(); f.node('mfaConfirmCode').value = '123456'; f.submit('mfaConfirmForm');
  await f.answer('/api/auth/mfa/enroll/confirm', 200, { recovery_codes: ['same-owner-one-time-code'] });
  const before = f.calls.length; f.updateProfile({ name: 'Same owner with a new profile name' }); f.window.dispatch('pageshow', { persisted: true }); await tick();
  assert.equal(f.calls.length, before); assert.deepEqual(f.redirects, []); assert.equal(f.node('newRecovery').hidden, false);
  assert.equal(f.node('newRecoveryCodes').textContent, 'same-owner-one-time-code'); assert.equal(f.node('mfaConfirmForm').nativeHasUnsavedChanges(), true);
  assert.equal(f.node('refreshSecurityBtn').disabled, true);
});

test('cached-page restoration for another account clears old setup and recovery secrets even without a storage event', async () => {
  for (const stage of ['setup', 'recovery']) {
    const f = fixture(); await f.ready(); f.node('mfaPassword').value = 'Old-owner-password'; f.submit('mfaStartForm');
    await f.answer('/api/auth/mfa/enroll/start', 200, { qr_code: 'data:image/png;base64,T0xE', manual_key: 'ABCDEFGHIJKLMNOP' });
    if (stage === 'recovery') { f.node('mfaConfirmCode').value = '123456'; f.submit('mfaConfirmForm'); await f.answer('/api/auth/mfa/enroll/confirm', 200, { recovery_codes: ['old-owner-private-code'] }); }
    f.node('currentPassword').value = 'Old-owner-current-password'; f.node('newPassword').value = 'Old-owner-new-password';
    const before = f.calls.length; f.restoreWithAccount('staff-b'); await tick();
    assert.equal(f.calls.length, before + 2, 'Changed owner triggers fresh MFA and session reads');
    assert.equal(f.node('mfaQr').src, ''); assert.equal(f.node('mfaManual').value, ''); assert.equal(f.node('mfaSetup').hidden, true);
    assert.equal(f.node('newRecoveryCodes').textContent, ''); assert.equal(f.node('newRecovery').hidden, true); assert.equal(f.node('sessions').textContent, '');
    assert.equal(f.node('currentPassword').value, ''); assert.equal(f.node('newPassword').value, ''); assert.equal(f.node('mfaConfirmCode').value, '');
    assert.equal(f.node('refreshSecurityBtn').disabled, false); assert.equal(f.node('status').textContent, '');
    await f.ready([{ ...defaultSessions[0], user_agent: 'Restored new account device' }]); assert.match(f.node('sessions').textContent, /Restored new account device/);
    assert(!f.document.textContent.includes('old-owner-private-code'));
  }
});

test('secrets only enter their intended request bodies; account exit clears displayed values', async () => {
  const f = fixture(); await f.ready(); const password = 'Fixture-password-private-729', newPassword = 'Fixture-new-password-private-729';
  f.node('mfaPassword').value = password; f.submit('mfaStartForm'); await f.answer('/api/auth/mfa/enroll/start', 200, { qr_code: 'data:image/png;base64,UElYRUw=', manual_key: 'ABCDEFGHIJKLMNOP' });
  assert.equal(f.node('mfaSetup').hidden, false); assert.equal(f.node('mfaManual').value, 'ABCDEFGHIJKLMNOP'); assert.equal(f.node('mfaPassword').value, '');
  f.node('mfaConfirmCode').value = '123456'; f.submit('mfaConfirmForm'); await f.answer('/api/auth/mfa/enroll/confirm', 200, { recovery_codes: ['private-recovery-729'] });
  assert.equal(f.node('newRecovery').hidden, false); assert.equal(f.node('newRecoveryCodes').textContent, 'private-recovery-729'); assert.equal(f.node('mfaQr').src, '');
  assert.equal(f.count('/api/auth/mfa/status'), 1, 'Confirmed enrollment does not immediately read using the revoked session');
  f.node('currentPassword').value = password; f.node('newPassword').value = newPassword; f.submit('changePasswordForm');
  await f.answer('/api/auth/change-password', 422, { message: 'Review the password policy.' });
  f.assertNoSecretLeak([password, newPassword, 'ABCDEFGHIJKLMNOP', 'private-recovery-729', '123456']);
  const passwordCall = f.calls.find(call => call.url === '/api/auth/change-password'); assert.deepEqual(JSON.parse(passwordCall.options.body), { current_password: password, new_password: newPassword });
  f.switchAccount(); assert.equal(f.node('currentPassword').value, ''); assert.equal(f.node('newPassword').value, ''); assert.equal(f.node('newRecoveryCodes').textContent, ''); assert.equal(f.node('status').textContent, '');
});

(async () => {
  const failed = [];
  for (const { name, run } of cases) {
    try { await run(); console.log('PASS security page: ' + name); }
    catch (error) { failed.push(name); console.error('FAIL security page: ' + name + '\n' + error.stack); }
  }
  assert.equal(failed.length, 0, 'Security page behaviour failures: ' + failed.join('; '));
  console.log('Security page state tests passed: real handlers, deferred responses, privacy, duplicate guards, retry/reconciliation and account isolation. DOM fixtures only; no production or browser claim.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
