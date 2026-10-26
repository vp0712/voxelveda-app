'use strict';
// Exact controller code with synthetic SQL results. No production DB or account.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const authorization = require('../services/authorizationService');
const customerScope = require('../services/customerRecordScope');
const money = require('../utils/money');
const source = fs.readFileSync(path.join(__dirname, '../controllers/dashboardController.js'), 'utf8');

const companyRow = Object.freeze({
  total_rfqs: 37, pending_rfqs: 13, approved_rfqs: 11, quoted_rfqs: 2,
  total_invoices: 29, total_invoice_value: '123456.78', paid_revenue: '123.45',
  revenue: '123456.78', collected_revenue: '123.45',
  total_expenses: 23, total_expense_value: '100.00',
  gst_paid: '10.00', gst_collected: '20.00', month_key: '2026-10',
  status: 'approved', count: 11, bill_count: 23, supplier_count: 17,
  paid_value: '100.00', pending_value: '200.00', overdue_value: '50.00',
  upcoming_value: '150.00', pending_count: 7, next_due_date: '2026-10-30',
  supplier_name: 'Unrelated company supplier fixture', balance_due: '200.00'
});
function loadController({ denyQueries = false } = {}) {
  const queries = [], module = { exports: {} };
  const pool = { async query(sql, params = []) {
    queries.push({ sql, params });
    if (denyQueries) throw new Error('Customer summary must be rejected before any schema or data query');
    return [[{ ...companyRow }]];
  } };
  const dependency = name => {
    if (name === '../config/db') return pool;
    if (name === '../utils/money') return money;
    if (name === '../services/authorizationService') return authorization;
    if (name === '../services/customerRecordScope') return customerScope;
    if (name === '../services/invoiceSummaryService') return { receivableSelect: () => 'SELECT * FROM invoices' };
    if (name === '../services/expensePaymentDomain') return { paymentSql: () => ({ paid: '0', due: 'e.total_amount', join: '' }) };
    throw new Error('Unexpected dashboard fixture dependency: ' + name);
  };
  vm.runInNewContext(source, { module, exports: module.exports, require: dependency, console: { error() {} } }, { filename: 'controllers/dashboardController.js' });
  return { controller: module.exports, queries };
}
async function invoke(fixture, user) {
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await fixture.controller.getDashboardStats({ user }, res);
  return res;
}
function isolated(file, dependencies) {
  const module = { exports: {} }, filename = path.join(__dirname, '..', file);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, __dirname: path.dirname(filename), Buffer, Date, URL,
    console: { error() {} }, require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      if (['fs', 'path', 'crypto'].includes(name)) return require(name);
      throw new Error('Unexpected customer isolation dependency: ' + name);
    }
  }, { filename });
  return module.exports;
}
function response() { return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }
async function expenseIsolation() {
  const activity = { queries: 0, connections: 0, files: 0, objects: 0, pdf: 0, audit: 0 };
  const unavailable = key => async () => { activity[key]++; throw new Error('Unauthorised company expense activity: ' + key); };
  const pool = { query: unavailable('queries'), getConnection: unavailable('connections') };
  const expense = isolated('controllers/expenseController.js', {
    '../config/db': pool, '../services/customerRecordScope': customerScope,
    '../utils/money': money, '../utils/dateOnly': require('../utils/dateOnly'),
    '../services/expensePaymentDomain': require('../services/expensePaymentDomain'),
    '../services/expenseRegisterFilters': require('../services/expenseRegisterFilters'),
    '../services/documentPdfService': { storedDocumentArtifact: unavailable('pdf'), sendPdfResponse: unavailable('pdf') },
    '../services/documentSecurityService': { safeDispositionName: value => value },
    '../services/sessionService': { logSecurityEvent: unavailable('audit') },
    '../services/auditService': { logAudit: unavailable('audit') },
    fs: { promises: { readFile: unavailable('files') }, existsSync() { activity.files++; throw new Error('No file access'); } }
  });
  const methods = ['getExpenses', 'saveExpense', 'getExpensePayments', 'recordExpensePayment', 'voidExpensePayment', 'deleteExpense', 'restoreExpense', 'expenseHistory', 'saveExpenseFile', 'viewExpenseFile', 'deleteExpenseFile'];
  for (const role of ['client', 'customer', 'viewer', 'view_only', 'Customer']) {
    const user = { id: 701, role, email: 'one-client@example.invalid', permissions: require('../config/permissionCatalog').PERMISSIONS, temporary_permissions: ['VIEW_FINANCE'] };
    for (const method of methods) {
      const res = response();
      await expense[method]({ user, query: {}, body: {}, params: { id: '401', paymentId: '402' } }, res);
      assert.equal(res.code, 403, role + '/' + method + ' must deny before schema, data, files or transactions');
      assert.equal(res.body.code, 'COMPANY_EXPENSES_RESTRICTED');
    }
    let next = 0; const res = response();
    expense.requireCompanyExpenseAccess({ user }, res, () => next++);
    assert.equal(res.code, 403); assert.equal(next, 0);
  }
  let next = 0;
  expense.requireCompanyExpenseAccess({ user: { id: 801, role: 'finance_user' } }, response(), () => next++);
  assert.equal(next, 1, 'Internal company expense permission gates remain available');
  assert.deepEqual(activity, { queries: 0, connections: 0, files: 0, objects: 0, pdf: 0, audit: 0 });

  // Test the actual router registration: the role boundary precedes every
  // endpoint, including multer's file parsing and action/step-up handlers.
  const uses = [], routes = [], noop = (_req, _res, done) => done?.();
  const router = { use(fn) { uses.push(fn); }, get(...args) { routes.push(args); }, post(...args) { routes.push(args); } };
  const multer = () => ({ single: () => noop }); multer.diskStorage = () => ({});
  isolated('routes/expenseRoutes.js', {
    express: { Router: () => router }, multer, fs: { existsSync: () => true },
    '../controllers/expenseController': expense,
    '../middleware/authorizationMiddleware': { requireAnyPermission: () => noop },
    '../middleware/stepUpMiddleware': () => noop,
    '../middleware/uploadSecurity': { sanitizeUploadName: value => value, secureMulterOptions: () => ({}), validateUploadedFile: noop }
  });
  assert.equal(uses[0], expense.requireCompanyExpenseAccess);
  assert(routes.some(route => route[0] === '/files/:id/view'));
  assert(routes.some(route => route[0] === '/:id/files'));
}
async function documentIsolation() {
  const queries = [], pool = { async query(sql, params) {
    queries.push({ sql, params });
    if (/SELECT customer_email FROM invoices/.test(sql)) return [[{ customer_email: params[0] === 901 ? 'one-client@example.invalid' : 'another-client@example.invalid' }]];
    throw new Error('Unexpected document data read: ' + sql);
  } };
  const service = isolated('services/documentSecurityService.js', {
    '../config/db': pool, './authorizationService': authorization, './customerRecordScope': customerScope,
    './securityOperationsSchema': {}, './malwareScanService': {}, './objectStorageService': {}, './sessionService': {}, './stepUpService': {}, './documentPdfService': {},
    './applicationRetirement': require('../services/applicationRetirement')
  });
  for (const role of ['client', 'customer', 'viewer', 'view_only']) {
    const user = { id: 701, role, email: 'one-client@example.invalid', permissions: require('../config/permissionCatalog').PERMISSIONS };
    for (const module of ['expense', 'expenses']) for (const owner of [701, 999]) {
      assert.equal(await service.mayViewDocument(user, { module, owner_user_id: owner, record_id: 401, access_policy: 'AUTHENTICATED', classification: 'PUBLIC' }, pool), false, 'Expense document cannot bypass the role boundary through owner/public/grant shortcuts');
    }
  }
  assert.equal(queries.length, 0, 'Known expense documents are denied before any record read');
  assert.equal(await service.mayViewDocument({ id: 801, role: 'finance_user' }, { module: 'expense', owner_user_id: 999 }, pool), true, 'Internal invoice/expense authority is preserved');
  const client = { id: 701, role: 'customer', email: 'one-client@example.invalid', permissions: ['VIEW_FINANCE', 'VIEW_QMS'] };
  assert.equal(await service.mayViewDocument(client, { module: 'invoice', record_id: 901, owner_user_id: 999 }, pool), true, 'The intended own invoice remains accessible');
  assert.equal(await service.mayViewDocument(client, { module: 'invoice', record_id: 902, owner_user_id: 701 }, pool), false, 'A foreign invoice remains inaccessible even with a misleading owner');
  assert.equal(await service.mayViewDocument(client, { module: 'qms', owner_user_id: 999 }, pool), true, 'Explicit original QMS authority is not blanket-disabled');
  assert.equal(queries.length, 2); assert(queries.every(row => /FROM invoices/.test(row.sql)));
}
async function expenseReportIsolation() {
  const counts = { sql: 0, source: 0, pdf: 0, send: 0 }, rendering = new Error('Authorised fixture reached document rendering');
  const controller = isolated('controllers/originalReportController.js', {
    '../config/db': { async query() { counts.sql++; throw new Error('No direct report SQL'); } },
    '../services/authorizationService': authorization, '../services/customerRecordScope': customerScope,
    '../services/attendanceRecordedTotals': {},
    '../services/documentPdfService': {
      dateLabel: value => String(value), money: value => String(value),
      async createDocumentPdf() { counts.pdf++; throw rendering; },
      async sendPdfResponse() { counts.send++; throw new Error('No fixture transport'); }
    },
    './expenseController': { async getExpenses(req, res) {
      counts.source++;
      return res.json({ expenses: [{ id: 401, expense_date: '2026-10-25', supplier_name: 'Unrelated company supplier fixture', total_amount: '9.00', status: 'unpaid' }], total: 1, page: Number(req.query.page), limit: Number(req.query.limit) });
    } }
  });
  for (const role of ['client', 'customer', 'viewer', 'view_only']) {
    let failure;
    await controller.download({ user: { id: 701, role, permissions: require('../config/permissionCatalog').PERMISSIONS }, params: { type: 'expenses' }, query: {} }, response(), error => { failure = error; });
    assert.equal(failure?.status, 403); assert.equal(failure?.code, 'COMPANY_EXPENSES_RESTRICTED');
  }
  assert.deepEqual(counts, { sql: 0, source: 0, pdf: 0, send: 0 }, 'Company expense reports are denied before source selection or rendering');
  let allowed;
  await controller.download({ user: { id: 801, role: 'finance_user' }, params: { type: 'expenses' }, query: {} }, response(), error => { allowed = error; });
  assert.equal(allowed, rendering, 'Internal report selection still reaches its authorised source and renderer');
  assert.equal(counts.source, 1); assert.equal(counts.pdf, 1); assert.equal(counts.send, 0);
}
async function main() {
  const all = require('../config/permissionCatalog').PERMISSIONS;
  const denied = loadController({ denyQueries: true });
  for (const role of ['client', 'customer', 'viewer', 'view_only', 'CLIENT', 'Customer']) {
    for (const grants of [[], ['VIEW_DASHBOARD', 'VIEW_RFQS', 'VIEW_FINANCE'], all]) {
      const res = await invoke(denied, {
        id: 701, role, email: 'one-client@example.invalid', permissions: grants,
        temporary_permissions: ['VIEW_RFQS', 'VIEW_FINANCE'],
        break_glass_permissions: ['VIEW_RFQS', 'VIEW_FINANCE']
      });
      assert.equal(res.code, 403, role + ' must not read company-wide statistics');
      assert.equal(res.body.code, 'COMPANY_DASHBOARD_RESTRICTED');
      for (const field of ['rfqs', 'invoices', 'finance', 'supplier_payables']) assert.equal(Object.hasOwn(res.body, field), false);
      assert.equal(denied.queries.length, 0, 'Customer rejection precedes DDL and data reads');
    }
  }
  // Internal roles keep their existing permission projections and original totals.
  const internal = loadController();
  for (const role of ['super_admin', 'admin', 'finance_admin', 'finance_user', 'accountant', 'hr', 'manager', 'supervisor', 'sales', 'production', 'staff']) {
    const user = { id: 801, role, permissions: [] }, res = await invoke(internal, user);
    assert.equal(res.code, 200, role + ' company dashboard contract is preserved');
    const canRfq = authorization.hasPermission(user, 'VIEW_RFQS');
    const canFinance = authorization.hasPermission(user, 'VIEW_FINANCE');
    assert.equal(res.body.rfqs.total_rfqs, canRfq ? 37 : undefined);
    assert.equal(res.body.invoices.total_invoices, canFinance ? 29 : undefined);
    assert.equal(res.body.finance.revenue, canFinance ? '123456.78' : undefined);
    assert.equal(res.body.supplier_payables.next_payment?.supplier_name, canFinance ? companyRow.supplier_name : undefined);
    if (!canRfq) assert.deepEqual(JSON.parse(JSON.stringify(res.body.rfqs)), {});
    if (!canFinance) for (const field of ['invoices', 'finance', 'supplier_payables']) assert.deepEqual(JSON.parse(JSON.stringify(res.body[field])), {});
  }
  const explicit = await invoke(internal, { id: 802, role: 'staff', permissions: ['VIEW_RFQS', 'VIEW_FINANCE'] });
  assert.equal(explicit.body.rfqs.total_rfqs, 37, 'Existing explicit internal commercial authority is preserved');
  assert.equal(explicit.body.finance.revenue, '123456.78');
  assert(internal.queries.some(row => /^\s*SELECT/i.test(row.sql)), 'Allowed totals come from source queries');
  assert(internal.queries.every(row => !/\b(?:banking_|bank_accounts|bank_transactions|finance_accounts|finance_transactions|erp_)[a-z_]*\b/i.test(row.sql)), 'No retired banking or separate ERP source is loaded');
  await expenseIsolation(); await documentIsolation(); await expenseReportIsolation();
  console.log('Customer commercial isolation passed: company dashboard, all expense actions/files, expense document ownership shortcuts and full expense reports denied before source reads; own invoices, explicit QMS grants and internal finance authority preserved.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

