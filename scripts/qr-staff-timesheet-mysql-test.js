'use strict';

// Run against the local, disposable database initialized by retained-mysql-test.js.
// This intentionally waits one real minute so the weekly report can verify worked time.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { once } = require('node:events');
const { DateTime } = require('luxon');
const { setTimeout: wait } = require('node:timers/promises');
const { buildDatabaseConfig } = require('../config/databaseConfig');

const config = buildDatabaseConfig(process.env).options;
if (process.env.REPAIR_DB_TEST !== 'true' || process.env.NODE_ENV !== 'test' ||
    !['127.0.0.1', 'localhost', '::1'].includes(config.host) || config.database !== 'voxelveda_repair_test') {
  throw new Error('Use the disposable loopback voxelveda_repair_test database with REPAIR_DB_TEST=true and NODE_ENV=test.');
}
const appHost = 'app.voxelveda.com';
const qrHost = 'qr.voxelveda.com';
const remote = process.argv.includes('--remote');
Object.assign(process.env, {
  PUBLIC_APP_URL: 'https://' + appHost,
  ALLOWED_ORIGINS: 'https://' + appHost,
  QR_STAFF_ORIGIN: 'https://' + qrHost,
  QR_STAFF_EMIT: 'true',
  JWT_SECRET: crypto.randomBytes(48).toString('hex'),
  SHIFT_QR_SIGNING_KEY: crypto.randomBytes(48).toString('hex')
});

const pool = require('../config/db');
const app = require('../app');
const qr = require('../services/attendanceQrService');
const { createAuthenticatedSession } = require('../services/authSessionService');

function request(port, host, path, cookie = '', input) {
  const body = input === undefined ? null : JSON.stringify(input);
  const headers = { Host: host, Cookie: cookie, 'X-Forwarded-Proto': 'https' };
  if (body !== null) Object.assign(headers, { Origin: 'https://' + host, 'Content-Type': 'application/json' });
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, headers, method: body === null ? 'GET' : 'POST' }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('error', reject);
      res.on('end', () => {
        try {
          const data = res.headers['content-type']?.includes('json') ? JSON.parse(text) : null;
          resolve({ status: res.statusCode, headers: res.headers, data });
        } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}
function ok(response) {
  assert.equal(response.status, 200, 'HTTP ' + response.status + ' ' + (response.data?.code || response.data?.message || ''));
  return response.data;
}
function readCookie(response, name) {
  const field = response.headers['set-cookie']?.find(value => value.startsWith(name + '='));
  assert(field, 'Expected ' + name + ' cookie');
  return field.split(';')[0];
}

async function main() {
  const [[connected]] = await pool.query('SELECT DATABASE() AS db');
  assert.equal(connected.db, config.database);
  const id = crypto.randomInt(100000000, 900000000);
  const user = { id, name: 'Synthetic QR tester', username: 'qr-fixture-' + id, email: 'qr-' + id + '@example.invalid',
    role: 'staff', permissions: ['VIEW_ATTENDANCE', 'VIEW_OWN_TIMESHEET'], session_version: 1 };
  await pool.query(
    'INSERT INTO users (id,name,username,email,password,role,permissions,active,account_status,session_version) VALUES (?,?,?,?,?,?,?,1,\'ACTIVE\',1)',
    [id, user.name, user.username, user.email, 'synthetic-never-used', user.role, JSON.stringify(user.permissions)]
  );
  // Start from an authenticated portal session with the real session issuer, on the local fixture only.
  const portalCookies = [];
  await createAuthenticatedSession({
    user, assuranceLevel: 2,
    req: { secure: true, ip: '127.0.0.1', headers: {}, get: () => 'Synthetic QR test' },
    res: { cookie: (name, value) => portalCookies.push(name + '=' + value) }
  });
  const portalCookie = portalCookies.join('; ');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const qrPost = (path, input, cookie) => request(port, qrHost, '/qr-api/' + path, cookie, input);
  try {
    const start = await qrPost('link/start', {});
    const challenge = new URL(ok(start).url).searchParams.get('challenge');
    const ephemeral = readCookie(start, '__Host-vv_qr_link');
    const approval = await request(port, appHost, '/attendance/link-phone', portalCookie, { challenge });
    const handoff = new URLSearchParams(new URL(ok(approval).url).hash.slice(1)).get('code');
    const finish = await qrPost('link/finish', { code: handoff }, ephemeral);
    ok(finish);
    const device = readCookie(finish, '__Host-vv_qr_staff');
    assert.equal(ok(await request(port, qrHost, '/qr-api/session', device)).staff_id, id);

    async function punch(expected) {
      const code = new URL(remote ? '/remote' : qr.createSiteToken().qr_data, 'https://' + qrHost);
      assert.equal(code.hostname, qrHost);
      assert.equal((await request(port, qrHost, code.pathname + code.search, device)).status, 200);
      const token = code.searchParams.get('t');
      const source = remote ? 'remote/' : '';
      const site = remote ? {} : { token };
      const scan = ok(await qrPost(source + 'scan', site, device));
      assert.equal(scan.action, expected);
      const body = { ...site, action: expected, attendance_id: scan.attendance_id, qr_proof: scan.qr_proof, request_id: crypto.randomUUID() };
      const responses = await Promise.all([qrPost(source + 'confirm', body, device), qrPost(source + 'confirm', body, device)]);
      const receipt = ok(responses[0]).receipt;
      assert.deepEqual(ok(responses[1]).receipt, receipt);
      const result = ok(await qrPost('reconcile', { request_id: body.request_id }, device));
      assert.equal(result.found, true);
      assert.deepEqual(result.receipt, receipt);
      return receipt;
    }

    const first = await punch('CHECK_IN');
    assert.equal(ok(await request(port, qrHost, '/qr-api/session', device)).action, 'CHECK_OUT');
    await wait(61000);
    const last = await punch('CHECK_OUT');
    assert.equal(first.attendance_id, last.attendance_id);
    assert(Date.parse(last.saved_at) > Date.parse(first.saved_at));
    const weekStart = DateTime.fromISO(first.saved_at, { setZone: true })
      .setZone(first.timezone).startOf('week').toISODate();
    const weekly = ok(await request(port, appHost, '/api/attendance/week?week_start=' + weekStart, portalCookie));
    const rows = weekly.attendance.filter(row => row.id === first.attendance_id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, id);
    assert(rows[0].verified_worked_minutes >= 1);
    assert.equal(weekly.verified_total_minutes, rows[0].verified_worked_minutes);
    const [[entries]] = await pool.query('SELECT COUNT(*) AS count FROM staff_attendance WHERE user_id=?', [id]);
    const [[receipts]] = await pool.query('SELECT COUNT(*) AS count FROM attendance_action_receipts WHERE user_id=?', [id]);
    assert.equal(entries.count, 1);
    assert.equal(receipts.count, 2);

    ok(await request(port, appHost, '/attendance/phones/revoke-all', portalCookie, {}));
    assert.equal(ok(await request(port, qrHost, '/qr-api/session', device)).linked, false);
    const revoked = remote ? await qrPost('remote/scan', {}, device) : await qrPost('scan', { token: qr.createSiteToken().token }, device);
    assert.equal(revoked.status, 401);
    console.log('PASS real HTTP phone linking, two confirmed actions, concurrent retries, receipt reconciliation, weekly verified minutes and revocation.');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
