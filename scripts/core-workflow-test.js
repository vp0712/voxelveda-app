'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const { hasAnyPermission } = require('../services/authorizationService');

function isolated(file, dependencies) {
  const fixture = { exports: {} }, filename = path.join(__dirname, '..', file);
  new vm.Script(fs.readFileSync(filename, 'utf8'), { filename }).runInNewContext({
    module: fixture, exports: fixture.exports, Buffer, Date, console: { error() {} },
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      if (['crypto', 'path', 'fs'].includes(name)) return require(name);
      if (name === 'pdfkit') return function PDFDocument() {};
      if (name === '../config/urls') return { absolute: (route) => `https://app.voxelveda.com${route}` };
      if (name === '../services/documentPdfService') return {};
      throw new Error(`Unexpected dependency in ${file}: ${name}`);
    }
  });
  return fixture.exports;
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = plain(body); return this; } }; }
function request(body = {}, query = {}) { return { body, query, params: {}, user: { id: 99, role: 'admin' }, get: () => null, ip: '127.0.0.1', requestId: 'fixture-request', session: { id: 'fixture-session' } }; }
async function invoke(controller, method, body, query) { const res = response(); await controller[method](request(body, query), res); return res; }

function stockFixture() {
  const state = { stocks: [
    { id: 1, product_name: 'Original product', category: 'Original', batch_code: 'BATCH-1', unit_qty: 10, current_unit_qty: 10, unit_price: 2, deleted: 0 },
    { id: 2, product_name: 'Second product', category: 'Original', batch_code: 'BATCH-2', unit_qty: 10, current_unit_qty: 5, unit_price: 3, deleted: 0 }
  ], movements: [], audits: [], queries: [], releases: 0, auditFailure: false };
  let queue = Promise.resolve();
  async function read(sql, params, transactional) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    state.queries.push({ sql: normalized, params: [...params], transactional });
    if (/^(CREATE|ALTER)/.test(normalized) || /^UPDATE stock_batches s LEFT JOIN/.test(normalized)) return [[]];
    if (/^SELECT \* FROM stock_movements WHERE request_key/.test(normalized)) return [[...state.movements.filter((row) => row.request_key === params[0]).map(plain)]];
    if (/^SELECT \* FROM stock_movements WHERE id/.test(normalized)) return [[...state.movements.filter((row) => row.id === params[0] && (!/voided_at IS NULL/.test(normalized) || !row.voided_at)).map(plain)]];
    if (/^SELECT \* FROM stock_batches WHERE id IN/.test(normalized)) {
      assert.match(normalized, /ORDER BY id ASC FOR UPDATE$/, 'multi-batch correction must lock batches in stable order');
      assert.deepEqual(plain(params), [...params].sort((a, b) => a - b));
      return [[...state.stocks.filter((row) => params.includes(row.id)).map(plain)]];
    }
    if (/^SELECT \* FROM stock_batches WHERE id =/.test(normalized)) {
      assert.match(normalized, /FOR UPDATE$/, 'stock mutation must lock the authoritative batch before computing quantity');
      return [[...state.stocks.filter((row) => row.id === params[0] && (!/deleted, 0\) = 0/.test(normalized) || !row.deleted)).map(plain)]];
    }
    if (/^UPDATE stock_batches SET current_unit_qty = current_unit_qty [-+]/.test(normalized)) {
      assert(transactional, 'quantity mutation must be inside transaction');
      const stock = state.stocks.find((row) => row.id === params[2]);
      const allowed = stock && (!/current_unit_qty >=/.test(normalized) || stock.current_unit_qty >= params[3]);
      if (allowed) stock.current_unit_qty += /current_unit_qty \+/.test(normalized) ? params[0] : -params[0];
      return [{ affectedRows: allowed ? 1 : 0 }];
    }
    if (/^UPDATE stock_batches SET product_name/.test(normalized)) {
      const stock = state.stocks.find((row) => row.id === params[8]);
      const keys = ['product_name', 'category', 'batch_code', 'manufacture_date', 'unit_qty', 'unit_price', 'current_unit_qty', 'updated_by'];
      keys.forEach((key, index) => stock[key] = params[index]);
      return [{ affectedRows: 1 }];
    }
    if (/^INSERT INTO stock_movements/.test(normalized)) {
      const row = { id: state.movements.length + 1, stock_id: params[0], movement_type: 'issue', quantity: params[1], unit_price: params[2], total_price: params[3], issued_to: params[4], notes: params[5], created_by: params[6], request_key: params[7], voided_at: null };
      state.movements.push(row); return [{ insertId: row.id }];
    }
    if (/^UPDATE stock_movements SET stock_id/.test(normalized)) {
      const row = state.movements.find((entry) => entry.id === params[6]);
      ['stock_id', 'quantity', 'unit_price', 'total_price', 'issued_to', 'notes'].forEach((key, index) => row[key] = params[index]);
      return [{ affectedRows: 1 }];
    }
    if (/^UPDATE stock_movements SET voided_at/.test(normalized)) {
      const row = state.movements.find((entry) => entry.id === params[1]); row.voided_at = '2026-10-11 10:00:00'; row.voided_by = params[0]; return [{ affectedRows: 1 }];
    }
    if (/^UPDATE stock_batches SET deleted/.test(normalized)) { state.stocks.find((row) => row.id === params[2]).deleted = params[0]; return [{ affectedRows: 1 }]; }
    throw new Error('Unexpected stock fixture query: ' + normalized);
  }
  const db = {
    query: (sql, params = []) => read(sql, params, false),
    async getConnection() {
      let snapshot, unlock, held = false;
      return {
        async beginTransaction() {
          const previous = queue; queue = new Promise((resolve) => { unlock = resolve; }); await previous;
          snapshot = plain({ stocks: state.stocks, movements: state.movements, audits: state.audits }); held = true;
        },
        query: (sql, params = []) => read(sql, params, held),
        async commit() { assert(held); held = false; unlock(); },
        async rollback() { if (held) { state.stocks = snapshot.stocks; state.movements = snapshot.movements; state.audits = snapshot.audits; held = false; unlock(); } },
        release() { assert(!held, 'connection must not leak a held transaction'); state.releases += 1; }
      };
    }
  };
  const controller = isolated('controllers/stockController.js', { '../config/db': db, '../services/auditService': { async logAudit(connection, entry) { if (state.auditFailure) throw new Error('Audit unavailable'); state.audits.push(plain(entry)); } } });
  return { controller, state };
}

async function stockSafety() {
  const { controller, state } = stockFixture();
  const issue = { stock_id: 1, quantity: 7, issued_to: 'Internal production', notes: 'Authorized fixture only' };
  const before = state.queries.length;
  for (const quantity of [NaN, Infinity, -1, 0, 1.5, 'bad', '', {}, 2147483648]) {
    const res = await invoke(controller, 'issueStock', { ...issue, quantity });
    assert.equal(res.statusCode, 400, `invalid quantity ${String(quantity)} must be rejected`);
    assert(res.body.fields.quantity);
  }
  assert.equal(state.queries.length, before, 'invalid stock quantities must not reach schema or mutation queries');
  const concurrent = await Promise.all([invoke(controller, 'issueStock', issue), invoke(controller, 'issueStock', issue)]);
  assert.deepEqual(concurrent.map((res) => res.statusCode).sort(), [200, 400]);
  assert.equal(state.stocks[0].current_unit_qty, 3);
  assert.equal(state.movements.length, 1);
  assert.equal(state.audits.length, 1);
  assert.equal(state.audits[0].actorId, 99);
  const resaved = await invoke(controller, 'saveStock', { id: 1, product_name: 'Original product edited', batch_code: 'BATCH-1', unit_qty: 6, unit_price: 2 });
  assert.equal(resaved.statusCode, 400, 'batch input edit must account for the already issued quantity');
  assert.equal(state.stocks[0].current_unit_qty, 3);
  const successfulSave = await invoke(controller, 'saveStock', { id: 1, product_name: 'Original product edited', batch_code: 'BATCH-1', unit_qty: 12, unit_price: 2 });
  assert.equal(successfulSave.statusCode, 200);
  assert.equal(state.stocks[0].current_unit_qty, 5, 'editing opening units must preserve units already issued');
  state.auditFailure = true;
  const failed = await invoke(controller, 'issueStock', { ...issue, quantity: 2 });
  assert.equal(failed.statusCode, 500);
  assert.equal(state.stocks[0].current_unit_qty, 5, 'audit failure must roll back quantity');
  assert.equal(state.movements.length, 1, 'audit failure must roll back the issue record');
  state.auditFailure = false;
  const correction = await invoke(controller, 'updateStockMovement', { id: 1, stock_id: 2, quantity: 4, issued_to: 'Internal production', notes: 'Correction' });
  assert.equal(correction.statusCode, 200);
  assert.equal(state.stocks[0].current_unit_qty, 12);
  assert.equal(state.stocks[1].current_unit_qty, 1);
  assert.equal(state.movements[0].stock_id, 2);
  const archived = await invoke(controller, 'deleteStock', { id: 2 });
  assert.equal(archived.statusCode, 200);
  const blocked = await invoke(controller, 'deleteStockMovement', { id: 1 });
  assert.equal(blocked.statusCode, 409, 'void must not silently lose quantities belonging to archived batches');
  assert.equal(state.stocks[1].current_unit_qty, 1);
  assert.equal(state.movements[0].voided_at, null);
  await invoke(controller, 'restoreStock', { id: 2 });
  const voided = await invoke(controller, 'deleteStockMovement', { id: 1 });
  assert.equal(voided.statusCode, 200);
  assert.equal(state.stocks[1].current_unit_qty, 5);
  assert.equal(state.movements.length, 1, 'void must retain original movement identity and history');
  const replay = await invoke(controller, 'deleteStockMovement', { id: 1 });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(state.stocks[1].current_unit_qty, 5, 'repeating void must not inflate stock');
  const retryBody = { stock_id: 1, quantity: 2, issued_to: 'Internal production', notes: 'Retry fixture', idempotency_key: crypto.randomUUID() };
  const first = await invoke(controller, 'issueStock', retryBody), retry = await invoke(controller, 'issueStock', retryBody);
  assert.equal(first.statusCode, 200); assert.equal(retry.statusCode, 200);
  assert.equal(first.body.movement_id, retry.body.movement_id);
  assert.equal(retry.body.replayed, true);
  assert.equal(state.stocks[0].current_unit_qty, 10, 'safe retry must issue once');
  assert.equal((await invoke(controller, 'issueStock', { ...retryBody, quantity: 3 })).statusCode, 409, 'different payload cannot reuse a successful retry key');
  assert(!state.queries.some(({ sql }) => /^DELETE FROM stock_movements/.test(sql)), 'historical stock movements cannot be erased');
}

function simpleFixture(file, existing = null) {
  const queries = [], audits = [], movements = [];
  let rollbacks = 0, commits = 0;
  const db = {
    async query(sql, params = []) {
      queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params: [...params] });
      if (/SELECT COUNT/.test(sql)) return [[{ total: 2 }]];
      if (/SELECT id, active, deleted_at FROM users/.test(sql)) return [[{ id: 4, active: 1, deleted_at: null }]];
      if (/SELECT \* FROM (?:customers|material_inventory|meetings)/.test(sql)) return [[...(existing ? [plain(existing)] : [])]];
      if (/INSERT INTO material_movements/.test(sql)) movements.push([...params]);
      if (/INSERT INTO/.test(sql)) return [{ insertId: 44 }];
      if (/UPDATE/.test(sql)) return [{ affectedRows: 1 }];
      if (/SELECT/.test(sql)) return [[]];
      return [[]];
    },
    async getConnection() { return { query: db.query.bind(db), async beginTransaction() {}, async commit() { commits += 1; }, async rollback() { rollbacks += 1; }, release() {} }; }
  };
  const controller = isolated(file, { '../config/db': db, '../services/trashService': { moveToTrash: async () => ({}) }, '../services/auditService': { logAudit: async (_db, entry) => audits.push(plain(entry)) } });
  return { controller, queries, audits, movements, stats: () => ({ rollbacks, commits }) };
}

async function validationAndLists() {
  const customer = simpleFixture('controllers/customerController.js');
  for (const body of [{ company_name: '' }, { company_name: 'Valid company', email: 'invalid' }, { company_name: 'Valid company', file_link: 'javascript:alert(1)' }, { id: -1, company_name: 'Valid company' }]) {
    const res = await invoke(customer.controller, 'saveCustomer', body); assert.equal(res.statusCode, 400); assert(Object.keys(res.body.fields).length);
  }
  assert.equal(customer.queries.length, 0, 'invalid customer fields must not produce writes');
  const saved = await invoke(customer.controller, 'saveCustomer', { id: 0, company_name: ' Original Company ', email: 'contact@example.test' });
  assert.equal(saved.statusCode, 200); assert.equal(saved.body.customer_id, 44);
  assert.equal(customer.audits[0].newValue.company_name, 'Original Company'); assert.equal(customer.stats().commits, 1);
  const list = await invoke(customer.controller, 'getCustomers', {}, { search: "ACME' OR 1=1", page: 2, limit: 1, sort: 'company_name', direction: 'desc' });
  assert.equal(list.statusCode, 200); assert.equal(list.body.pagination.total, 2);
  const customerQuery = customer.queries.find(({ sql }) => /SELECT c\.\*/.test(sql));
  assert(!customerQuery.sql.includes("ACME' OR 1=1"), 'search remains a bound parameter'); assert.deepEqual(customerQuery.params.slice(-2), [1, 1]);
  assert.equal((await invoke(customer.controller, 'getCustomers', {}, { sort: 'toString' })).statusCode, 400, 'sort whitelist must not accept inherited object keys');
  const material = simpleFixture('controllers/materialController.js');
  const sheet = Object.fromEntries(['po_number', 'supplier_batch', 'received_by', 'inspected_by', 'visual_condition', 'dimension_check', 'contamination_check', 'storage_condition', 'coa_available', 'sds_available', 'quarantine_status', 'approved_by'].map((key) => [key, 'pass']));
  sheet.received_date = '2026-10-11'; sheet.final_disposition = 'accepted';
  const materialBody = { item_name: 'Original raw material', input_qty: 8, current_qty: 5, unit_price: 2, process_sheet: sheet };
  for (const body of [{ ...materialBody, input_qty: Infinity }, { ...materialBody, current_qty: 9 }, { ...materialBody, input_qty: 1.0001 }, { ...materialBody, inventory_type: 'invalid' }, { ...materialBody, process_sheet: { ...sheet, visual_condition: 'fail' } }]) {
    const res = await invoke(material.controller, 'saveMaterial', body); assert.equal(res.statusCode, 400); assert(Object.keys(res.body.fields).length);
  }
  assert.equal(material.queries.length, 0);
  assert.equal((await invoke(material.controller, 'saveMaterial', materialBody)).statusCode, 200);
  assert.equal(material.movements.length, 1); assert.deepEqual(material.movements[0].slice(0, 7), [44, 'opening', 5, 0, 8, 0, 5]);
  assert.equal(material.audits[0].actorId, 99); assert.equal(material.stats().commits, 1);
  const materialList = await invoke(material.controller, 'getMaterials', {}, { type: 'raw_material', stock_status: 'low', page: 1, limit: 10 });
  assert.equal(materialList.statusCode, 200); assert.equal(materialList.body.pagination.total, 2);
  assert(material.queries.some(({ sql }) => /current_qty <= m.reorder_level/.test(sql)));
  const meeting = simpleFixture('controllers/meetingController.js');
  const meetingBody = { title: 'Original operational meeting', meeting_date: '2026-10-20', meeting_time: '09:00', assigned_user_ids: [4, 4], status: 'scheduled' };
  for (const body of [{ ...meetingBody, meeting_date: '2026-02-30' }, { ...meetingBody, meeting_time: '25:00' }, { ...meetingBody, assigned_user_ids: [0, -1] }, { ...meetingBody, status: 'approved' }]) assert.equal((await invoke(meeting.controller, 'saveMeeting', body)).statusCode, 400);
  assert.equal(meeting.queries.length, 0);
  assert.equal((await invoke(meeting.controller, 'saveMeeting', meetingBody)).statusCode, 200);
  assert.deepEqual(meeting.audits[0].newValue.assigned_user_ids, [4], 'duplicate attendees must not duplicate reminders');
  const finished = simpleFixture('controllers/meetingController.js', { id: 1, status: 'completed', assigned_user_ids: '[4]' });
  assert.equal((await invoke(finished.controller, 'saveMeeting', { ...meetingBody, id: 1 })).statusCode, 409);
  assert.equal(finished.stats().rollbacks, 1);
  await invoke(meeting.controller, 'listMyMeetings');
  assert(meeting.queries.some(({ sql, params }) => /JSON_CONTAINS/.test(sql) && params.includes(99)), 'own meetings must scope the SQL query to the authenticated attendee');
}

async function routePermissions() {
  for (const [file, controllerName, expectations] of [
    ['routes/customerRoutes.js', '../controllers/customerController', [['get /', 'VIEW_CUSTOMERS'], ['post /', 'EDIT_CUSTOMERS'], ['post /delete', 'EDIT_CUSTOMERS']]],
    ['routes/stockRoutes.js', '../controllers/stockController', [['get /', 'VIEW_INVENTORY'], ['get /movements', 'VIEW_INVENTORY'], ['post /issue', 'EDIT_INVENTORY'], ['post /restore', 'EDIT_INVENTORY']]],
    ['routes/materialRoutes.js', '../controllers/materialController', [['get /', 'VIEW_INVENTORY'], ['get /:id/process-sheet.pdf', 'VIEW_INVENTORY'], ['post /', 'EDIT_INVENTORY'], ['post /restore', 'EDIT_INVENTORY']]],
    ['routes/meetingRoutes.js', '../controllers/meetingController', [['get /', 'MANAGE_MEETINGS'], ['get /my', 'VIEW_MEETINGS'], ['post /', 'MANAGE_MEETINGS']]]
  ]) {
    const handlers = new Map(), router = {};
    for (const method of ['get', 'post']) router[method] = (route, ...chain) => handlers.set(`${method} ${route}`, chain);
    const pass = (_req, _res, next) => next();
    const controller = new Proxy({}, { get: () => pass });
    isolated(file, { express: { Router: () => router }, [controllerName]: controller,
      '../middleware/authorizationMiddleware': { requireAnyPermission },
      '../middleware/inputPermissionMiddleware': (required) => (req, res, next) => hasAnyPermission(req.user, typeof required === 'function' ? required(req) : required) ? next() : res.status(403).json({ message: 'Denied' }) });
    for (const [route, permission] of expectations) {
      const first = handlers.get(route)[0];
      let next = false; const denied = response();
      await first({ ...request(), method: route.split(' ')[0].toUpperCase(), user: { id: 4, role: 'viewer' } }, denied, () => next = true);
      assert.equal(denied.statusCode, 403, `${route} must reject a viewer`); assert.equal(next, false);
      const allowed = response();
      await first({ ...request(), method: route.split(' ')[0].toUpperCase(), user: { id: 4, role: 'viewer', permissions: [permission] } }, allowed, () => next = true);
      assert.equal(next, true, `${route} must retain explicit original permission ${permission}`);
    }
  }
}
async function run() {
  await stockSafety(); await validationAndLists(); await routePermissions();
  console.log('Core workflow tests passed: bounded validation, atomic stock edit/issue/correction/void, rollback, safe retries, preserved movement history, material quantity audit, meeting attendee scope, bound search/pagination and original route permissions.');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
