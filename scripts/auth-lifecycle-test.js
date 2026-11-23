const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { IncomingMessage, ServerResponse } = require('node:http');
const { Socket } = require('node:net');
const path = require('node:path');
const Module = require('node:module');
const bcrypt = require('bcryptjs');
const express = require('express');
const jwt = require('jsonwebtoken');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const authController = read('controllers/authController.js');
const loginClient = read('public/login.js');
const loginPage = read('public/login.html');
const session = read('utils/session.js');
const email = read('services/securityEmailService.js');
const schema = read('services/securitySchema.js');

assert(!/res\.json\([\s\S]{0,100}token,/.test(authController), 'login must not return bearer token');
assert(!loginClient.includes("localStorage.setItem('token'"), 'client must not persist auth token');
assert(!loginClient.includes('Login response missing token/user/role.'), 'legacy bearer-token login contract must not return');
assert(loginClient.includes("fetch('/api/auth/me'"), 'cookie login must resolve the authenticated user from /api/auth/me');
assert(loginClient.indexOf('if (data.mfa_required)') < loginClient.indexOf('resolveAuthenticatedUser(data)'), 'MFA challenge must be handled before final user resolution');
assert(loginPage.includes('20260909-secure-session-v2'), 'login page must cache-bust the secure session client');
assert(session.includes("ALLOW_LEGACY_QUERY_TOKENS"), 'legacy query token gate missing');
assert(email.includes("#token="), 'security token must use URL fragment');
assert(!email.includes("queueEmail"), 'raw security token must not enter email queue');
assert(schema.includes('auth_action_tokens'), 'action token schema missing');

async function checkSessionHttpLifecycle() {
  const secret = crypto.randomBytes(32).toString('hex');
  const resumeName = '__Host-vv_resume';
  const email = 'ordinary-employee@example.invalid';
  const password = 'Synthetic-session-passphrase';
  const { tokenHash } = require('../utils/session');
  const { csrfProtection } = require('../middleware/securityMiddleware');
  const user = { id: 56, name: 'Session fixture', email, username: 'fixture-user', password: bcrypt.hashSync(password, 4),
    role: 'staff', active: 1, session_version: 1, account_status: 'ACTIVE', mfa_enabled: 0, permissions: '[]' };
  const sessions = new Map();
  const hooks = [];
  const start = Date.UTC(2030, 0, 1) / 1000;
  let clock = start;
  let storageOffline = false;
  const env = { NODE_ENV: 'test', JWT_SECRET: secret, JWT_EXPIRES_IN: '8h', PRIVILEGED_SESSION_EXPIRES_IN: '4d',
    ALLOWED_ORIGINS: 'https://app.voxelveda.com', ALLOW_LEGACY_QUERY_TOKENS: 'false', COOKIE_DOMAIN: '.voxelveda.com' };
  const oldEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  const prevNow = Date.now;
  Date.now = () => clock * 1000;

  const db = { async query(sql, params = []) {
    if (storageOffline) throw Object.assign(new Error('Test database temporarily offline'), { code: 'TEST_STORAGE_OFFLINE' });
    const query = sql.replace(/\s+/g, ' ').trim();
    if (query.startsWith('INSERT INTO auth_sessions')) {
      assert.match(query, /FROM_UNIXTIME\(\?\)/, 'The database converts the same UTC deadline in its own session timezone.');
      const [id, user_id, hash, assurance_level, session_version, , , expires] = params;
      sessions.set(id, { id, user_id, hash, assurance_level, session_version, expires, expires_at: new Date(expires * 1000) });
    } else if (query.startsWith('SELECT id, user_id, assurance_level')) {
      const [id, hash, userId] = params;
      const row = sessions.get(id);
      return [[row].filter((value) => value?.hash === hash && value.user_id === userId && !value.revoked_at && value.expires > clock)];
    } else if (query.startsWith('UPDATE auth_sessions SET revoked_at = NOW()')) {
      const byCredential = query.includes('token_hash');
      const [reason, id, hash, userId] = byCredential ? params : [params[0], params[1], null, params[2]];
      const row = sessions.get(id);
      if (!row || row.revoked_at || row.user_id !== userId || (byCredential && row.hash !== hash)) return [{ affectedRows: 0 }];
      row.revoked_at = new Date(clock * 1000);
      row.revoke_reason = reason;
    } else if (query.includes('FROM users')) {
      const key = params[0];
      return [[user].filter(() => key === email || key === user.id)];
    } else if (query.includes('FROM privileged_access_requests')) return [[]];
    else assert.match(query, /^(UPDATE users |UPDATE auth_sessions SET last_seen_at |INSERT INTO security_events )/, query);
    return [{ affectedRows: 1 }];
  } };

  const originalLoad = Module._load;
  Module._load = function fixtureLoad(request, parent) {
    const target = request.startsWith('.') ? path.resolve(path.dirname(parent.filename), request).replace(/\.js$/, '') : request;
    const root = path.join(__dirname, '..');
    if (target === path.join(root, 'config/db')) return db;
    if (target === path.join(root, 'services/userLifecycleService')) return { ensureUserLifecycleSchema: async () => {} };
    if (target === path.join(root, 'services/securitySchema')) return { ensureSecuritySchema: async () => {} };
    if (target === path.join(root, 'services/securityContextService')) {
      return { loadBreakGlassPermissions: async () => ({ permissions: [] }), resolveImpersonation: async () => null };
    }
    if (target === path.join(root, 'services/botChallengeService')) return { botChallenge: () => (_req, _res, next) => next() };
    if (target === path.join(root, 'middleware/securityMiddleware')) return { csrfProtection, authRateLimit: () => (_req, _res, next) => next() };
    if (target === path.join(root, 'services/deviceNoticeService')) return {
      onSignIn: async (_req, id) => hooks.push({ signIn: id }),
      onLogout: async ({ user: member, session: active }, options) => hooks.push({ logout: member.id, session: active.id, all: options.all })
    };
    return originalLoad.apply(this, arguments);
  };

  let app;
  function launch() {
    app = express();
    app.use(express.json(), csrfProtection);
    const pageAuth = require('../middleware/pageAuth');
    app.get(['/', '/login'], pageAuth({ signInEntry: true }), (_req, res) => res.send('Sign-in fixture'));
    app.get('/dashboard', pageAuth(), (_req, res) => res.send('Dashboard fixture'));
    app.use('/api/auth', require('../routes/authRoutes'));
  }
  function request(route, { jar = {}, method = 'GET', body, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      const req = new IncomingMessage(socket);
      const bytes = body ? Buffer.from(JSON.stringify(body)) : null;
      req.url = route;
      req.method = method;
      req.headers = {
        host: 'app.voxelveda.com',
        cookie: Object.entries(jar).map(([name, value]) => name + '=' + value).join('; '),
        origin: 'https://app.voxelveda.com',
        'sec-fetch-site': 'same-origin',
        'x-forwarded-proto': 'https',
        'content-type': 'application/json',
        ...(bytes ? { 'content-length': String(bytes.length) } : {}),
        ...Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]))
      };
      if (bytes) req.push(bytes);
      req.push(null);
      const response = new ServerResponse(req);
      const timeout = setTimeout(() => reject(new Error(`Fixture request timed out: ${route}`)), 2000);
      response.end = (chunk) => {
        clearTimeout(timeout);
        response.finished = true;
        const cookieHeaders = [].concat(response.getHeader('set-cookie') || []);
        const cookies = Object.fromEntries(cookieHeaders.map((value) => value.split(';', 1)[0].split('=')));
        resolve({ status: response.statusCode, location: response.getHeader('location'), contents: String(chunk || ''), cookies, cookieHeaders });
        response.emit('finish');
        socket.destroy();
        return response;
      };
      app.handle(req, response, (error) => {
        clearTimeout(timeout);
        socket.destroy();
        reject(error || new Error(`Unhandled fixture route: ${route}`));
      });
    });
  }
  const jwtBody = (value) => jwt.verify(value, secret, { algorithms: ['HS256'] });
  async function signIn() {
    const result = await request('/api/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(result.status, 200, result.contents);
    assert.equal(JSON.parse(result.contents).user.id, user.id);
    assert.deepEqual(Object.keys(result.cookies).sort(), [resumeName, 'vv_session']);
    for (const cookie of result.cookieHeaders) {
      assert.match(cookie, /Expires=.*; HttpOnly; Secure; SameSite=Strict/);
      assert.match(cookie, /Path=\//);
    }
    assert.doesNotMatch(result.cookieHeaders.find((cookie) => cookie.startsWith(resumeName + '=')), /Domain=/i,
      'The durable cookie is host-only even when the deployment configures a shared domain for the legacy cookie.');
    return result.cookies;
  }

  try {
    launch();
    assert.equal((await request('/login')).status, 200, 'Never-signed-in installations see sign-in.');
    const original = await signIn();
    const resume = jwtBody(original[resumeName]);
    const deadline = start + 96 * 3600;
    assert.equal(resume.exp, deadline, 'A stale 8h deployment override must not shorten policy for new ordinary sign-ins.');
    assert.equal(resume.iat, start);
    assert.equal(sessions.get(resume.jti).expires, deadline);
    assert.equal(jwtBody(original.vv_session).exp, start + 900);
    assert.deepEqual((await request('/api/auth/me', { jar: original })).cookies, {});
    assert.equal((await request('/api/auth/me', { headers: { Authorization: 'Bearer ' + original[resumeName] } })).status, 401,
      'A resume credential must never be accepted as a generic API bearer.');
    assert.equal((await request('/api/auth/me', { jar: { vv_resume: original[resumeName] } })).status, 401,
      'A sibling domain cannot install a durable credential over HTTPS.');
    assert.equal((await request('/login?returnTo=%2F%2Fevil.invalid', { jar: original })).location, '/dashboard');
    assert.equal((await request('/login?returnTo=%2Fdashboard%3Fteam_activity%3D1', { jar: original })).location, '/dashboard?team_activity=1');

    clock = start + 900;
    const resumeOnly = { [resumeName]: original[resumeName] };
    const forgedSite = await request('/api/auth/logout', { jar: resumeOnly, method: 'POST',
      headers: { Origin: 'https://evil.invalid', 'Sec-Fetch-Site': 'cross-site' } });
    assert.equal(forgedSite.status, 403, 'Resume-only requests must retain CSRF protections.');
    storageOffline = true;
    const outage = await request('/', { jar: resumeOnly });
    assert.equal(outage.status, 503);
    assert.deepEqual(outage.cookies, {}, 'A transient infrastructure failure does not clear cookies.');
    storageOffline = false;
    launch();
    const returning = await request('/', { jar: resumeOnly });
    assert.equal(returning.status, 302);
    assert.equal(returning.location, '/dashboard', 'Server restart and lost access cookie go straight to the dashboard.');
    assert.equal(returning.cookies[resumeName], undefined, 'Only short access can be renewed.');
    assert.equal(jwtBody(returning.cookies.vv_session).exp, start + 1800);
    assert.equal(sessions.get(resume.jti).expires, deadline);

    const stale = jwt.sign({ id: user.id, iat: clock }, secret, { expiresIn: '1s', jwtid: crypto.randomUUID() });
    const staleBody = jwtBody(stale);
    sessions.set(staleBody.jti, { id: staleBody.jti, user_id: user.id, hash: tokenHash(stale),
      assurance_level: 1, session_version: 1, expires: staleBody.exp });
    const legacy = await request('/api/auth/me', { jar: { vv_session: stale } });
    assert.equal(legacy.status, 200);
    assert.deepEqual(legacy.cookies, {}, 'Existing sessions keep their original lifetime.');
    clock = staleBody.exp;
    assert.equal((await request('/api/auth/me', { jar: { vv_session: stale } })).status, 401);

    clock = deadline - 1;
    const before = await request('/api/auth/me', { jar: resumeOnly });
    assert.equal(before.status, 200);
    assert.equal(jwtBody(before.cookies.vv_session).exp, deadline);
    clock = deadline;
    assert.equal((await request('/api/auth/me', { jar: { ...resumeOnly, ...before.cookies } })).status, 401);
    assert.equal((await request('/', { jar: resumeOnly })).status, 200, 'At 96h the entry page may show sign-in.');

    const signedOut = await signIn();
    const id = jwtBody(signedOut[resumeName]).jti;
    const logout = await request('/api/auth/logout', { jar: { [resumeName]: signedOut[resumeName] }, method: 'POST' });
    assert.equal(logout.status, 200);
    assert.deepEqual(logout.cookies, { vv_session: '', [resumeName]: '' });
    assert.equal(sessions.get(id).revoke_reason, 'LOGOUT');
    assert.deepEqual(hooks.at(-1), { logout: user.id, session: id, all: false });
    assert.equal((await request('/api/auth/me', { jar: signedOut })).status, 401);

    const remote = await signIn();
    const other = await signIn();
    const remoteId = jwtBody(remote[resumeName]).jti;
    assert.equal((await request('/api/auth/sessions/' + remoteId, { jar: other, method: 'DELETE' })).status, 200);
    assert.equal((await request('/api/auth/me', { jar: remote })).status, 401, 'Revocation takes effect during the 15-minute access lifetime.');
    assert.equal((await request('/api/auth/me', { jar: { [resumeName]: remote[resumeName] } })).status, 401);
    user.session_version += 1;
    assert.equal((await request('/api/auth/me', { jar: other })).status, 401, 'Account security version invalidates both credentials.');
  } finally {
    Module._load = originalLoad;
    Date.now = prevNow;
    for (const [key, previous] of Object.entries(oldEnv)) {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  }
}

checkSessionHttpLifecycle().then(() => {
  console.log('Authentication lifecycle tests passed (96h boundary, renewal, restart, transport outage, logout, revocation and deep-link return).');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
