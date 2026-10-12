'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
const rows = new Map();
const audits = [];
let snapshot, nextId = 1;
const queries = [];
const db = {
  async getConnection() { return db; },
  async beginTransaction() { snapshot = structuredClone([...rows]); },
  async commit() { snapshot = null; },
  async rollback() { if (snapshot) { rows.clear(); for (const [k, v] of snapshot) rows.set(k, v); } snapshot = null; },
  release() {},
  async query(sql, params = []) {
    queries.push({ sql, params });
    if (/SELECT id, request_hash FROM rfqs WHERE request_key/.test(sql)) return [[...rows.values()].filter((r) => r.request_key === params[0]).map((r) => ({ id: r.id, request_hash: r.request_hash }))];
    if (/INSERT INTO rfqs/.test(sql)) {
      const [customer_name, email, phone, material, quantity, application, request_key, request_hash] = params;
      const record = { id: nextId++, customer_name, email, phone, material, quantity, application, status: 'pending', archived: 0, revision: 0, request_key, request_hash };
      rows.set(record.id, record); return [{ insertId: record.id, affectedRows: 1 }];
    }
    if (/SELECT \* FROM rfqs WHERE id/.test(sql)) {
      const r = rows.get(params[0]);
      const archived = /archived = \?/.test(sql) ? params[1] : undefined;
      const email = /LOWER\(email\)/.test(sql) ? params.at(-1) : undefined;
      return [[r].filter((v) => v && (archived === undefined || v.archived === archived) && (!email || v.email === email))];
    }
    if (/UPDATE rfqs SET status/.test(sql)) { const r = rows.get(params[1]); r.status = params[0]; r.revision++; return [{ affectedRows: 1 }]; }
    if (/UPDATE rfqs SET archived/.test(sql)) { const r = rows.get(params[1]); r.archived = params[0]; r.revision++; return [{ affectedRows: 1 }]; }
    if (/UPDATE rfqs SET customer_name/.test(sql)) {
      const r = rows.get(params[6]); for (const [i, k] of ['customer_name', 'email', 'phone', 'material', 'quantity', 'application'].entries()) r[k] = params[i]; r.revision++; return [{ affectedRows: 1 }];
    }
    if (/SELECT COUNT\(\*\) AS total FROM rfqs/.test(sql)) return [[{ total: rows.size }]];
    if (/SELECT \* FROM rfqs WHERE archived/.test(sql)) return [[...rows.values()].filter((r) => r.archived === params[0] && (!/LOWER\(email\)/.test(sql) || r.email === params[1]))];
    if (/SELECT \* FROM workflow_instances/.test(sql)) return [[{ id: 'retired-fixture', module: 'FINANCE', status: 'PENDING', requester_id: 1 }]];
    throw new Error(`Unexpected fixture query: ${sql}`);
  }
};
Module._load = function(request, parent, main) {
  if (/config\/db$/.test(request)) return db;
  if (/auditService$/.test(request)) return { logAudit: async (_db, a) => { audits.push(structuredClone(a)); } };
  if (/rfqSchema$/.test(request)) return { ensureRfqSchema: async () => {} };
  if (/workflowSchema$/.test(request)) return { ensureWorkflowSchema: async () => {} };
  return originalLoad.call(this, request, parent, main);
};
const controller = require('../controllers/rfqController');
const workflow = require('../services/workflowService');
Module._load = originalLoad;
function request(body = {}, extra = {}) { return { body, params: {}, query: {}, user: { id: 1, role: 'admin', email: 'admin@example.test' }, headers: {}, get(key) { return this.headers[key.toLowerCase()]; }, ...extra }; }
async function call(name, req) {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await controller[name](req, res); return res;
}
const input = { customer_name: 'Fixture Customer', email: 'fixture@example.test', material: 'PLA', quantity: 2, application: 'Fixture only' };
async function run() {
  for (const quantity of ['NaN', Infinity, -1, 0, 1.1234]) {
    const result = await call('createRFQ', request({ ...input, quantity }));
    assert.equal(result.statusCode, 400); assert.ok(result.body.fields.quantity);
  }
  assert.equal(rows.size, 0, 'Invalid quantities must not create records');
  const first = await call('createRFQ', request(input, { headers: { 'idempotency-key': 'test-create-0001' } }));
  assert.equal(first.statusCode, 201); assert.equal(first.body.rfq_id, 1);
  const retry = await call('createRFQ', request(input, { headers: { 'idempotency-key': 'test-create-0001' } }));
  assert.equal(retry.statusCode, 200); assert.equal(retry.body.rfq_id, 1); assert.equal(rows.size, 1);
  const conflict = await call('createRFQ', request({ ...input, quantity: 3 }, { headers: { 'idempotency-key': 'test-create-0001' } }));
  assert.equal(conflict.statusCode, 409); assert.equal(rows.get(1).quantity, 2);
  const approval = await call('approveRFQ', request({ rfq_id: 1 })); assert.equal(approval.body.status, 'approved');
  const approvalRetry = await call('approveRFQ', request({ rfq_id: 1 })); assert.equal(approvalRetry.body.unchanged, true);
  const editApproved = await call('updateRFQ', request(input, { params: { id: 1 } })); assert.equal(editApproved.statusCode, 409);
  rows.get(1).status = 'quoted';
  const rejectQuoted = await call('rejectRFQ', request({ rfq_id: 1 })); assert.equal(rejectQuoted.statusCode, 409); assert.equal(rows.get(1).status, 'quoted');
  await call('closeRFQ', request({ rfq_id: 1 })); assert.equal(rows.get(1).status, 'closed');
  await call('archiveRFQ', request({}, { params: { id: 1 } })); assert.equal(rows.get(1).archived, 1);
  await call('restoreRFQ', request({}, { params: { id: 1 } })); assert.equal(rows.get(1).archived, 0);
  rows.get(1).status = 'pending';
  const stale = await call('updateRFQ', request({ ...input, revision: -1 }, { params: { id: 1 } })); assert.equal(stale.statusCode, 409);
  const edit = await call('updateRFQ', request({ ...input, quantity: 4, revision: rows.get(1).revision }, { params: { id: 1 } })); assert.equal(edit.statusCode, 200); assert.equal(rows.get(1).quantity, 4);
  const customer = request({}, { user: { id: 2, role: 'client', email: 'other@example.test' } });
  const listing = await call('getRFQs', customer); assert.equal(listing.body.rfqs.length, 0);
  const mismatch = await call('createRFQ', request(input, { user: customer.user })); assert.equal(mismatch.statusCode, 403);
  const actions = audits.map((a) => a.action);
  assert.deepEqual(actions, ['RFQ_CREATED', 'RFQ_STATUS_CHANGED', 'RFQ_STATUS_CHANGED', 'RFQ_ARCHIVED', 'RFQ_RESTORED', 'RFQ_UPDATED']);
  assert.ok(audits.every((a) => a.recordId === 1 && a.actorId === 1));
  await assert.rejects(workflow.createDefinition({ user: { id: 1 }, input: { module: 'FINANCE' } }), (e) => e.statusCode === 410);
  const start = queries.length;
  await assert.rejects(workflow.actionWorkflow({ instanceId: 'retired-fixture', user: { id: 1 }, action: 'APPROVE', req: {} }), (e) => e.statusCode === 410);
  assert.ok(queries.slice(start).every((q) => !/^\s*(?:UPDATE|INSERT|DELETE)\b/.test(q.sql)), 'Retired workflow cannot mutate preserved finance history');
  const { dateOnly } = require('../utils/dateOnly');
  assert.equal(dateOnly('2026-02-29'), ''); assert.equal(dateOnly('2026-13-01'), ''); assert.equal(dateOnly('2024-02-29'), '2024-02-29');
  const { normaliseActionUrl } = require('../services/notificationService');
  assert.equal(normaliseActionUrl('/finance-intelligence#banking'), null);
  assert.equal(normaliseActionUrl('/erp'), null); assert.equal(normaliseActionUrl('/admin?view=banking'), null);
  assert.equal(normaliseActionUrl('/procurement'), '/procurement');
  console.log('Original workflow regression passed: validation, safe retry, status conflicts, atomic audit, optimistic edit, archive/restore, customer isolation, retired workflow protection and date validation.');
}
run().catch((err) => { console.error(err); process.exitCode = 1; });
