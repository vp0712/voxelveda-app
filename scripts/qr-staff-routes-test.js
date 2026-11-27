'use strict';

// HTTP integration test for the router boundary. Stub the DB-backed services;
// run the separate InnoDB tests for persistence, transactions and revocation.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');
const http = require('node:http');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const decodeQr = require('jsqr');

test('QR host isolates the portal and requires a linked phone and explicit workplace or remote confirmation', async t => {
  const domain = 'qr.voxelveda.com';
  const qrOrigin = 'https://' + domain;
  const appHost = 'app.voxelveda.com';
  const configBefore = process.env.QR_STAFF_ORIGIN;
  process.env.QR_STAFF_ORIGIN = qrOrigin;
  t.after(() => {
    if (configBefore === undefined) delete process.env.QR_STAFF_ORIGIN;
    else process.env.QR_STAFF_ORIGIN = configBefore;
  });

  const token = 'a'.repeat(43), verifier = 'b'.repeat(43), code = 'c'.repeat(43), challenge = 'd'.repeat(64);
  const requestId = '97269cea-c6c0-4937-924e-68736b4baac1';
  const remoteRequestId = '9c483248-239c-42d8-b122-5b7001adc017';
  const user = { id: 17, role: 'staff', username: 'Test staff' };
  const state = {
    allowed_actions: ['CHECK_IN'], status: 'NOT_STARTED', profile: { name: 'Test staff' },
    company_timezone: 'Australia/Melbourne', tasks: ['private'], timeline: ['private']
  };
  const records = new Map();
  let confirmed, removed = false;
  function stub(name, exports) {
    const filename = require.resolve(name);
    const previous = require.cache[filename];
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
    t.after(() => { if (previous) require.cache[filename] = previous; else delete require.cache[filename]; });
  }
  stub('../services/qrPhoneService', {
    LINK_SECONDS: 600, DEVICE_SECONDS: 2592000,
    begin: () => ({ verifier, challenge }),
    issueHandoff: async input => { assert.deepEqual(input, { userId: user.id, challenge }); return { code }; },
    redeem: async input => {
      if (input.verifier !== verifier) throw Object.assign(new Error('Invalid link.'), { statusCode: 401 });
      assert.equal(input.code, code);
      return { credential: token, deviceId: 7 };
    },
    verify: async value => {
      if (value !== token || removed) throw Object.assign(new Error('Unlinked'), { statusCode: 401 });
      return { user, deviceId: 7 };
    },
    revoke: async value => { assert.equal(value, token); removed = true; },
    revokeAll: async () => { removed = true; }
  });
  stub('../services/attendanceDailyService', { readToday: async () => state });
  stub('../services/attendanceMobilePolicy', {
    actor: actor => { assert.equal(actor.id, user.id); return actor.id; },
    requestId: id => { assert.equal(id, requestId); return id; }
  });
  stub('../services/attendanceQrService', {
    validateSiteToken: value => {
      assert.equal(value, 'site-token');
      return { exp: Math.floor(Date.now() / 1000) + 15 };
    }
  });
  stub('../services/attendanceActionService', {
    resolveQr: async ({ user: actor, input, remoteDeviceId }) => {
      assert.equal(actor.id, user.id);
      if (remoteDeviceId != null) {
        assert.equal(remoteDeviceId, 7);
        assert.equal(input.token, undefined);
        assert.equal(input.action, 'CHECK_IN');
        assert.equal(input.attendance_id, null);
        return { qr_proof: 'remote-proof', expires_at: new Date(Date.now() + 30000).toISOString() };
      }
      assert.deepEqual(input, { token: 'site-token', action: 'CHECK_IN', attendance_id: null });
      return { qr_proof: 'proof', expires_at: new Date(Date.now() + 30000).toISOString() };
    },
    performAction: async args => {
      confirmed = args;
      const id = args.input.request_id;
      if (!records.has(id)) {
        records.set(id, { attendance: { clock_in: '2026-01-20T00:10:00Z', notes: 'private' }, action: 'CHECK_IN', attendance_id: 5, request_id: id });
      }
      return { ...records.get(id), state };
    },
    reconcileAction: async ({ user: actor, requestId: id }) => {
      assert.equal(actor.id, user.id);
      assert.equal(id, requestId);
      return { receipt: records.get(id), state };
    }
  });
  stub('../middleware/securityMiddleware', { rateLimit: () => (_req, _res, next) => next() });
  stub('../middleware/auth', (req, _res, next) => {
    req.user = user;
    req.session = { id: 87 };
    req.securityContext = { impersonation: req.get('Test-Impersonate') === 'yes' };
    next();
  });
  stub('../middleware/pageAuth', () => (_req, _res, next) => next());

  const route = require('../routes/qrStaffSite');
  const app = express();
  app.use(route.host);
  app.use(express.json());
  app.use(route.portal);
  app.use((_req, res) => res.json({ portal: true }));
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + server.address().port;
  function request(path, method, host, headers, body) {
    return new Promise((resolve, reject) => {
      const call = http.request(origin + path, { method, headers: { ...headers, Host: host } }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('error', reject);
        response.once('end', () => {
          const bytes = Buffer.concat(chunks);
          resolve({
            status: response.statusCode,
            headers: {
              get: name => String(response.headers[name.toLowerCase()] || ''),
              getSetCookie: () => response.headers['set-cookie'] || []
            },
            bytes,
            json: () => JSON.parse(bytes.toString())
          });
        });
      });
      call.on('error', reject);
      call.end(body);
    });
  }
  function get(path, cookie = '', host = domain) {
    return request(path, 'GET', host, { Cookie: cookie });
  }
  function post(path, body, cookie = '', host = domain, overrides = {}) {
    return request(path, 'POST', host, { Origin: 'https://' + host, Cookie: cookie, 'Content-Type': 'application/json', ...overrides }, JSON.stringify(body));
  }
  const deviceJar = '__Host-vv_qr_staff=' + token;
  assert.equal((await get('/dashboard')).status, 404);
  assert.equal((await get('/api/attendance/timesheets', deviceJar)).status, 404);
  assert.equal((await get('/qr-api/session', 'token=portal-cookie')).status, 200);
  assert.deepEqual(await (await get('/qr-api/session', 'token=portal-cookie')).json(), { linked: false });
  assert.deepEqual(await (await get('/', '', appHost)).json(), { portal: true });
  delete process.env.QR_STAFF_ORIGIN;
  assert.equal((await get('/')).status, 503);
  process.env.QR_STAFF_ORIGIN = qrOrigin;
  for (const file of ['index.html', 'approve.html', 'display.html', 'display.js', 'staff.js', 'attendance.png', 'current']) {
    assert.equal((await get('/qr-staff/' + file, '', appHost)).status, 404);
  }
  assert.equal((await get('/qr-staff/approve.js', '', appHost)).status, 200);
  assert.equal((await get('/qr-staff/display.js')).status, 200);
  assert.equal((await get('/qr-staff/attendance-location.js')).status, 200);
  assert.equal((await get('/qr-staff/site.css', '', appHost)).status, 200);
  const display = await get('/');
  assert.equal(display.status, 200);
  assert.match(display.bytes.toString(), /src="\/qr-staff\/display\.js"/);

  const qrImagePath = '/qr-staff/attendance.png';
  const rotationMs = 30000;
  let now = Date.UTC(2026, 0, 20, 0, 10, 15);
  const clock = t.mock.method(Date, 'now', () => now);
  async function currentDisplay() {
    const response = await get('/qr-staff/current');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    return response.json();
  }
  async function readQr(path, slot) {
    const response = await get(path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^image\/png\b/);
    const image = await loadImage(response.bytes);
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, image.width, image.height);
    assert.equal(decodeQr(data, image.width, image.height)?.data, `${qrOrigin}/remote?v=${slot}`);
    return response.bytes;
  }
  const firstSlot = Math.floor(now / rotationMs);
  const first = await currentDisplay();
  assert.deepEqual(first, {
    image_url: `${qrImagePath}?v=${firstSlot}`,
    expires_at: new Date((firstSlot + 1) * rotationMs).toISOString(),
    server_time: new Date(now).toISOString()
  });
  const firstPng = await readQr(first.image_url, firstSlot);
  assert.deepEqual((await get(qrImagePath)).bytes, firstPng);

  now = (firstSlot + 1) * rotationMs;
  const next = await currentDisplay();
  assert.deepEqual(next, {
    image_url: `${qrImagePath}?v=${firstSlot + 1}`,
    expires_at: new Date(now + rotationMs).toISOString(),
    server_time: new Date(now).toISOString()
  });
  const nextPng = await readQr(next.image_url, firstSlot + 1);
  assert.notDeepEqual(nextPng, firstPng);
  const previous = await get(first.image_url);
  assert.equal(previous.status, 200);
  assert.deepEqual(previous.bytes, firstPng);
  for (const slot of [firstSlot - 1, firstSlot + 2, 'invalid']) {
    assert.equal((await get(`${qrImagePath}?v=${slot}`)).status, 404);
  }
  clock.mock.restore();

  const page = await get('/a?t=site-token');
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.match(page.headers.get('cache-control'), /no-store/);
  for (const path of ['/setup', '/remote', `/remote?v=${firstSlot - 1}`]) {
    const entry = await get(path);
    assert.equal(entry.status, 200);
    assert.deepEqual(entry.bytes, page.bytes);
  }
  assert.equal(records.size, 0);

  assert.equal((await post('/qr-api/link/start', {}, '', domain, { Origin: 'https://' + appHost })).status, 403);
  const start = await post('/qr-api/link/start', {});
  const verifierJar = start.headers.getSetCookie()[0].split(';')[0];
  assert.match(start.headers.get('set-cookie'), /HttpOnly/);
  assert.match(start.headers.get('set-cookie'), /Secure/);
  assert.doesNotMatch(start.headers.get('set-cookie'), /Domain=/i);
  assert.equal((await start.json()).url, 'https://' + appHost + '/attendance/link-phone?challenge=' + challenge);
  const approval = await post('/attendance/link-phone', { challenge }, '', appHost);
  assert.equal((await approval.json()).url, qrOrigin + '/setup#code=' + code);
  assert.equal((await post('/attendance/link-phone', { challenge }, '', appHost, { 'Test-Impersonate': 'yes' })).status, 403);
  assert.equal((await post('/qr-api/link/finish', { code })).status, 401);
  const linked = await post('/qr-api/link/finish', { code }, verifierJar);
  assert.equal(linked.status, 200);
  assert.ok(linked.headers.getSetCookie().some(value => value.startsWith(deviceJar + ';')));
  assert.equal((await post('/qr-api/link/start', {}, deviceJar)).status, 409);

  const initial = await (await get('/qr-api/session', deviceJar)).json();
  assert.equal(initial.staff_id, 17);
  assert.equal(initial.action, 'CHECK_IN');
  assert.equal(initial.tasks, undefined);
  const previousLocationSetting = process.env.ATTENDANCE_LOCATION_REQUIRED;
  try {
    process.env.ATTENDANCE_LOCATION_REQUIRED = 'false';
    assert.equal((await (await get('/qr-api/session', deviceJar)).json()).location_required, false);
    assert.doesNotMatch((await get('/remote')).headers.get('permissions-policy'), /geolocation=\(self\)/);
    process.env.ATTENDANCE_LOCATION_REQUIRED = 'true';
    assert.equal((await (await get('/qr-api/session', deviceJar)).json()).location_required, true);
    assert.match((await get('/remote')).headers.get('permissions-policy'), /geolocation=\(self\)/);
    assert.doesNotMatch((await get('/')).headers.get('permissions-policy'), /geolocation=\(self\)/);
  } finally {
    if (previousLocationSetting === undefined) delete process.env.ATTENDANCE_LOCATION_REQUIRED;
    else process.env.ATTENDANCE_LOCATION_REQUIRED = previousLocationSetting;
  }
  assert.equal((await post('/qr-api/scan', { token: 'site-token', user_id: 298 }, deviceJar)).status, 400);
  const scan = await (await post('/qr-api/scan', { token: 'site-token' }, deviceJar)).json();
  assert.equal(scan.qr_proof, 'proof');
  assert.equal(records.size, 0);
  const confirm = { token: 'site-token', qr_proof: scan.qr_proof, request_id: requestId, action: scan.action, attendance_id: null };
  assert.equal((await post('/qr-api/confirm', { ...confirm, action: 'BREAK_START' }, deviceJar)).status, 422);
  const saved = await (await post('/qr-api/confirm', confirm, deviceJar)).json();
  assert.equal(confirmed.requireSiteScan, true);
  assert.equal(confirmed.phoneDeviceId, 7);
  assert.equal(confirmed.user.id, 17);
  assert.deepEqual(confirmed.input, { site_token: 'site-token', qr_proof: 'proof', action: 'CHECK_IN', attendance_id: null, request_id: requestId });
  assert.equal(saved.receipt.saved_at, '2026-01-20T00:10:00Z');
  assert.equal(saved.receipt.notes, undefined);
  const reconcile = await (await post('/qr-api/reconcile', { request_id: requestId }, deviceJar)).json();
  assert.equal(reconcile.found, true);
  assert.deepEqual(reconcile.receipt, saved.receipt);
  assert.equal(records.size, 1);

  assert.equal((await get('/qr-api/remote/confirm', deviceJar)).status, 404);
  assert.equal((await post('/qr-api/remote/scan', {})).status, 401);
  assert.equal((await post('/qr-api/remote/scan', {}, deviceJar, domain, { Origin: 'https://' + appHost })).status, 403);
  assert.equal((await post('/qr-api/remote/scan', { token: 'site-token' }, deviceJar)).status, 400);
  const remoteScan = await post('/qr-api/remote/scan', {}, deviceJar);
  assert.equal(remoteScan.status, 200);
  const remote = await remoteScan.json();
  assert.equal(remote.qr_proof, 'remote-proof');
  assert.equal(records.size, 1);

  const remoteConfirm = { qr_proof: remote.qr_proof, request_id: remoteRequestId, action: remote.action, attendance_id: null };
  assert.equal((await post('/qr-api/remote/confirm', remoteConfirm)).status, 401);
  assert.equal((await post('/qr-api/remote/confirm', remoteConfirm, deviceJar, domain, { Origin: 'https://' + appHost })).status, 403);
  assert.equal((await post('/qr-api/remote/confirm', { ...remoteConfirm, token: 'site-token' }, deviceJar)).status, 400);
  assert.equal(records.size, 1);
  const remoteSaved = await post('/qr-api/remote/confirm', remoteConfirm, deviceJar);
  assert.equal(remoteSaved.status, 200);
  assert.equal(confirmed.remoteQr, true);
  assert.equal(confirmed.requireSiteScan, false);
  assert.equal(confirmed.phoneDeviceId, 7);
  assert.equal(confirmed.user.id, 17);
  const { site_token: siteToken, ...remoteInput } = confirmed.input;
  assert.equal(siteToken, undefined);
  assert.deepEqual(remoteInput, remoteConfirm);
  assert.equal((await remoteSaved.json()).receipt.request_id, remoteRequestId);
  assert.equal(records.size, 2);

  assert.equal((await post('/qr-api/unlink', {}, deviceJar)).status, 200);
  assert.equal((await post('/qr-api/scan', { token: 'site-token' }, deviceJar)).status, 401);
  assert.equal((await post('/qr-api/remote/confirm', remoteConfirm, deviceJar)).status, 401);
});
