const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

function isolated(relativePath, dependencies) {
  const filename = path.join(__dirname, '..', relativePath);
  const fixture = { exports: {} };
  new vm.Script(fs.readFileSync(filename, 'utf8'), { filename }).runInNewContext({
    module: fixture, exports: fixture.exports, URL,
    require(name) {
      if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected retained boundary dependency: ${name}`);
      return dependencies[name];
    }
  });
  return fixture.exports;
}

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

async function settingsBoundaries() {
  const rows = new Map([
    ['company_legal_name', 'Original Company'], ['company_email', 'info@example.com'],
    ['bank_name', 'Archived Bank'], ['payment_terms', 'Archived terms'],
    ['base_currency', 'AUD'], ['financial_year_start', '07-01'],
    ['gst_registration', 'REGISTERED'], ['report_footer', 'Historical report footer']
  ]);
  const retired = new Map([...rows].filter(([key]) => !['company_legal_name', 'company_email'].includes(key)));
  const queries = [];
  const audits = [];
  let connections = 0;
  const db = {
    async query(sql, params = []) {
      queries.push({ sql, params: [...params] });
      if (/SELECT setting_key,setting_value/.test(sql)) {
        return [[...rows].filter(([key]) => params.includes(key)).map(([setting_key, setting_value]) => ({ setting_key, setting_value }))];
      }
      if (/INSERT INTO app_settings/.test(sql)) rows.set(params[0], params[1]);
      return [[]];
    },
    async getConnection() {
      connections += 1;
      return { query: db.query.bind(db), async beginTransaction() {}, async commit() {}, async rollback() {}, release() {} };
    }
  };
  const controller = isolated('controllers/settingsController.js', {
    '../config/db': db,
    '../services/auditService': { async logAudit(connection, entry) { audits.push(entry); } },
    '../utils/secureLogger': { error() {} }
  });
  assert.deepEqual([...controller.ALLOWED_SETTINGS], ['company_legal_name', 'trading_name', 'company_address', 'company_email', 'abn', 'website', 'support_phone']);
  const req = { user: { id: 99, role: 'super_admin' }, ip: '127.0.0.1', get: () => 'boundary-test', requestId: 'request-test', session: { id: 'session-test' } };
  let res = response();
  await controller.getSettings(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(res.body.settings)), { company_legal_name: 'Original Company', company_email: 'info@example.com' });
  const publicRead = queries.find(({ sql }) => /SELECT setting_key,setting_value/.test(sql));
  assert.deepEqual(publicRead.params, [...controller.ALLOWED_SETTINGS]);

  const routeHandlers = new Map();
  const router = {};
  for (const method of ['get', 'post']) router[method] = (route, ...handlers) => routeHandlers.set(method + ' ' + route, handlers);
  const pass = (request, reply, next) => next();
  isolated('routes/settingsRoutes.js', {
    express: { Router: () => router },
    '../middleware/authMiddleware': pass,
    '../middleware/authorizationMiddleware': require('../middleware/authorizationMiddleware'),
    '../middleware/stepUpMiddleware': () => pass,
    '../middleware/requestContractMiddleware': require('../middleware/requestContractMiddleware'),
    '../controllers/settingsController': controller
  });
  async function get(user) {
    const reply = response();
    for (const handler of routeHandlers.get('get /')) {
      let next = false;
      await handler({ ...req, user }, reply, () => { next = true; });
      if (!next) break;
    }
    return reply;
  }
  const beforeUnauthorized = queries.length;
  for (const user of [{ id: 20, role: 'viewer' }, { id: 20, role: 'finance_admin', permissions: ['VIEW_DASHBOARD', 'settings'] }]) {
    res = await get(user);
    assert.equal(res.statusCode, 403, 'company settings must retain administrative permission checks without resurrecting old module aliases');
  }
  assert.equal(queries.length, beforeUnauthorized, 'denied settings reads must not query company data');
  assert.equal((await get({ id: 99, role: 'admin' })).statusCode, 200, 'authorized retained administrators can read company settings');
  async function post(body) {
    const reply = response();
    for (const handler of routeHandlers.get('post /')) {
      let next = false;
      await handler({ ...req, body }, reply, (error) => { if (error) throw error; next = true; });
      if (!next) break;
    }
    return reply;
  }

  const beforeRejected = queries.length;
  for (const [key, value] of retired) {
    res = await post({ [key]: value });
    assert.equal(res.statusCode, 400, `retired setting ${key} must be rejected by the actual route contract`);
    assert.equal(res.body.code, 'UNSUPPORTED_FIELDS');
    res = response();
    await controller.updateSettings({ ...req, body: { [key]: value } }, res);
    assert.equal(res.statusCode, 400, 'controller must also reject bypassed retired fields');
  }
  assert.equal(queries.length, beforeRejected);
  assert.equal(connections, 0, 'rejected retired settings must not open write connections');

  res = await post({ company_legal_name: '  Updated Company  ', website: 'https://example.com' });
  assert.equal(res.statusCode, 200);
  assert.equal(rows.get('company_legal_name'), 'Updated Company');
  assert.equal(rows.get('website'), 'https://example.com');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].actorId, 99);
  assert.deepEqual([...audits[0].metadata.changed_keys], ['company_legal_name', 'website']);
  for (const [key, value] of retired) assert.equal(rows.get(key), value, 'historical settings must remain unchanged');
  for (const { sql, params } of queries) {
    assert.doesNotMatch(sql, /^\s*(?:DELETE|DROP|TRUNCATE)\b/i);
    if (/INSERT INTO app_settings/.test(sql)) assert(controller.ALLOWED_SETTINGS.includes(params[0]));
  }
  assert.throws(() => controller.validateSettings({ website: 'http://example.com' }), /not valid/);
  assert.throws(() => controller.validateSettings({ company_email: 'invalid' }), /not valid/);
}

async function ownershipBoundaries() {
  const documents = [
    { id: 'rfq-a', module: 'rfq', owner_user_id: 20 },
    { id: 'profile-a', module: 'profile', owner_user_id: 20 },
    { id: 'security-a', module: 'security', owner_user_id: 20 },
    { id: 'finance-a', module: 'finance', owner_user_id: 20 },
    { id: 'invoice-a', module: 'invoice', owner_user_id: 20 },
    { id: 'rfq-deleted', module: 'rfq', owner_user_id: 20, deleted_at: '2026-10-01' },
    { id: 'finance-only', module: 'finance', owner_user_id: 30 }
  ];
  const tasks = [{ id: 1, assigned_to: 20 }];
  const assets = [{ id: 1, assigned_to: 20 }];
  const queries = [];
  const events = [];
  const retained = ['profile', 'security'];
  const connection = {
    async query(sql, params = []) {
      queries.push({ sql, params: [...params] });
      if (/information_schema.tables/.test(sql)) return [[{ count: 1 }]];
      if (/SELECT COUNT\(\*\) count FROM secure_documents/.test(sql)) {
        assert.match(sql, /module IN \('profile','security'\)/, 'ownership counts must use the same retained scope as mutations');
        return [[{ count: documents.filter((row) => row.owner_user_id === params[0] && !row.deleted_at && retained.includes(row.module)).length }]];
      }
      if (/SELECT COUNT\(\*\) count FROM (?:service_accounts|security_risk_exceptions)/.test(sql)) return [[{ count: 0 }]];
      if (/SELECT id FROM users/.test(sql)) return [[{ id: params[0] }]];
      if (/UPDATE secure_documents/.test(sql)) {
        assert.match(sql, /module IN \('profile','security'\)/, 'retired document ownership must never change');
        for (const row of documents) if (row.owner_user_id === params[1] && !row.deleted_at && retained.includes(row.module)) row.owner_user_id = params[0];
        return [{ affectedRows: 2 }];
      }
      if (/INSERT INTO ownership_transfer_events/.test(sql)) { events.push([...params]); return [{ affectedRows: 1 }]; }
      throw new Error('Unexpected ownership query: ' + sql);
    }
  };
  const service = isolated('services/userSecurityService.js', {
    '../config/db': {},
    './securitySchema': {},
    './securityGovernanceSchema': {},
    crypto
  });
  await assert.rejects(service.transferOwnedRecords(connection, 20, null, 99, 'Test termination'), (error) => error.code === 'OWNERSHIP_TRANSFER_REQUIRED');
  await assert.rejects(service.transferOwnedRecords(connection, 20, 20, 99, 'Test termination'), /different active user/);
  assert.equal(events.length, 0);
  const counts = await service.transferOwnedRecords(connection, 20, 21, 99, 'Test termination');
  assert.deepEqual(JSON.parse(JSON.stringify(counts)), { secure_documents: 2, service_accounts: 0, security_risk_exceptions: 0 });
  for (const row of documents) assert.equal(row.owner_user_id, retained.includes(row.module) && !row.deleted_at ? 21 : row.id === 'finance-only' ? 30 : 20);
  assert.deepEqual(tasks, [{ id: 1, assigned_to: 20 }]);
  assert.deepEqual(assets, [{ id: 1, assigned_to: 20 }]);
  assert.equal(events.length, 1);
  assert.deepEqual(JSON.parse(events[0][4]), { secure_documents: 2, service_accounts: 0, security_risk_exceptions: 0 });

  const retiredOnly = await service.transferOwnedRecords(connection, 30, null, 99, 'Retired records remain archived');
  assert.equal(retiredOnly.secure_documents, 0, 'archived retired records must not require or undergo ownership transfer');
  assert.equal(documents.find((row) => row.id === 'finance-only').owner_user_id, 30);
  for (const { sql, params } of queries) {
    assert.doesNotMatch(sql, /\b(?:tasks|assets|bank_accounts|bank_transactions|invoices)\b/i);
    assert.equal(params.includes('tasks') || params.includes('assets'), false);
    assert.doesNotMatch(sql, /^\s*(?:DELETE|DROP|TRUNCATE)\b/i);
  }
}

async function run() {
  await settingsBoundaries();
  await ownershipBoundaries();
  console.log('Retained boundaries tests passed: company-only settings DTO/write contract, preserved archived settings and ownership, and retained-scope account termination transfers.');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
