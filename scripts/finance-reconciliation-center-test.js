const fs = require('node:fs');
const path = require('node:path');

function read(file) { return fs.readFileSync(path.join(__dirname, '..', file), 'utf8'); }
function expect(source, needle, message) { if (!source.includes(needle)) throw new Error(message || `Expected ${needle}`); }
function reject(source, needle, message) { if (source.includes(needle)) throw new Error(message || `Unexpected ${needle}`); }

const controller = read('controllers/financeReconciliationCenterController.js');
const routes = read('routes/financeRoutes.js');
const html = read('public/finance-reconciliation.html');
const js = read('public/finance-reconciliation.js');
const css = read('public/finance-reconciliation.css');
const advanced = read('public/finance-intelligence-advanced.js');

expect(controller, "if (reconciliation === 'RECONCILED') return 'RECONCILED'", 'Actual reconciliation status must remain authoritative.');
expect(controller, "return 'READY'", 'Classified transactions need a Ready workflow state.');
expect(controller, "ft.status='POSTED'", 'Match candidates must be posted finance transactions.');
expect(controller, "ft.reconciliation_status <> 'RECONCILED'", 'Already reconciled finance records must not be suggested.');
expect(controller, "classification_status='CLASSIFIED'", 'Classification must mark the bank transaction classified.');
reject(controller, "SET reconciliation_status='RECONCILED'", 'Classification must never directly mark a bank transaction reconciled.');
expect(routes, "router.get('/intelligence/reconciliation'", 'Reconciliation list route is missing.');
expect(routes, "router.get('/intelligence/reconciliation/:id/candidates'", 'Reconciliation candidate route is missing.');
expect(routes, "requireStepUp('APPLY_FINANCE_INTELLIGENCE')", 'Classification changes must retain step-up verification.');
expect(html, 'Needs action', 'Plain-language Needs action workflow is missing.');
expect(html, 'Ready', 'Plain-language Ready workflow is missing.');
expect(html, 'Reconciled', 'Reconciled workflow is missing.');
expect(html, '/finance-action-reliability.js', 'Security-check UI must load on reconciliation page.');
expect(js, '/api/finance/bank-transactions/${state.active.id}/reconcile', 'UI must use the existing reconciliation engine.');
expect(js, '/api/finance/bank-transactions/${state.ignoreId}/ignore', 'UI must use the audited ignore endpoint.');
expect(js, "const matchable = ['READY','PARTIAL'].includes(row.workflow_status)", 'Ready and partial rows must support proper matching, including transfers.');
expect(css, '@media(max-width:620px)', 'Reconciliation center must have mobile layout rules.');
expect(advanced, 'openReconciliationCenter', 'Finance Intelligence must expose the Reconciliation Center button.');

console.log('Finance reconciliation center regression checks passed.');