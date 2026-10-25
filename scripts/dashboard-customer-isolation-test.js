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
  console.log('Dashboard customer isolation passed: client/customer/viewer/view_only denied before DDL/data reads despite stored/temporary grants; original internal role totals and explicit grants preserved; no retired source queries.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

