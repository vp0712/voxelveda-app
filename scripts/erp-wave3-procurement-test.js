const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const schema = read('services/procurementSchema.js');
const migration = read('migrations/20260910_erp_wave3_procurement.sql');
const service = read('services/procurementService.js');
const routes = read('routes/procurementRoutes.js');
const permissions = read('config/permissionCatalog.js');
const app = read('app.js');
const server = read('server.js');
const workflow = read('services/workflowService.js');
const ui = read('public/procurement-ui.js');
const adminHtml = read('public/admin-dashboard.html');
const staffHtml = read('public/staff-dashboard.html');
const styles = read('public/style.css');

const tables = [
  'procurement_sequences', 'purchase_requisitions', 'purchase_requisition_items',
  'procurement_supplier_rfqs', 'procurement_supplier_rfq_lines', 'procurement_supplier_rfq_invites',
  'purchase_orders', 'purchase_order_items', 'goods_receipts', 'goods_receipt_items',
  'receiving_inspections', 'procurement_bill_matches', 'purchase_returns',
  'purchase_return_items', 'supplier_credit_notes'
];
for (const table of tables) {
  assert(schema.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `${table} must exist in runtime schema`);
  assert(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `${table} must exist in additive migration`);
}

const requiredPermissions = [
  'VIEW_PROCUREMENT', 'CREATE_PURCHASE_REQUISITION', 'MANAGE_SUPPLIER_RFQ',
  'CREATE_PURCHASE_ORDER', 'RECEIVE_PURCHASE_ORDER', 'INSPECT_GOODS_RECEIPT',
  'MANAGE_SUPPLIER_BILL_MATCH', 'MANAGE_PURCHASE_RETURNS'
];
for (const permission of requiredPermissions) {
  assert(permissions.includes(`'${permission}'`), `${permission} must be in the permission catalog`);
  assert(routes.includes(`requireAnyPermission('${permission}')`), `${permission} must protect a procurement route`);
}

assert(!routes.includes('router.delete('), 'procurement must not expose destructive delete routes');
assert(routes.includes("requireStepUp('RECORD_SUPPLIER_CREDIT')"), 'supplier credits must require step-up authentication');
assert(service.includes('FOR UPDATE'), 'procurement mutations must lock controlled records');
assert(service.includes('OVER_RECEIPT'), 'receiving must prevent over-receipt');
assert(service.includes('DUPLICATE_RECEIPT_LINE'), 'receiving must reject duplicate lines');
assert(service.includes('PO_REQUISITION_LINE_INVALID'), 'purchase order lines must belong to the approved requisition');
assert(service.includes('PO_REQUISITION_QUANTITY_EXCEEDED'), 'purchase orders must prevent over-ordering requisition quantities');
assert(service.includes('INSPECTION_QUANTITY_MISMATCH'), 'inspection totals must reconcile');
assert(service.includes('Three-way match exception - payment hold'), 'bill variance must create a payment hold');
assert(service.includes('Supplier invoice variance under review'), 'bill lines must reconcile to the entered invoice total');
assert(service.includes('logAudit'), 'procurement mutations must be audited');
assert(service.includes('createNotification'), 'procurement lifecycle events must notify responsible users');
assert(service.includes("workflow_key: 'PROCUREMENT_APPROVAL'"), 'requisitions and purchase orders must use procurement approval');
assert(service.includes("workflow_key: 'FINANCE_APPROVAL'"), 'matched bills must use finance approval');
assert(workflow.includes("PROCUREMENT: ['VIEW_PROCUREMENT']"), 'generic procurement workflows must enforce module access');

assert(app.includes("app.use('/api/procurement',auth,procurementRoutes)"), 'procurement API must be mounted behind authentication');
assert(app.includes("'/procurement'"), 'procurement must be a protected module route');
assert(server.includes('ensureProcurementSchema'), 'procurement schema must initialize at server startup');
assert(adminHtml.includes('data-section="procurementSection"'), 'admin navigation must include procurement');
assert(staffHtml.includes('permission-procurement'), 'staff navigation must honor granular procurement access');
assert(adminHtml.includes('data-procurement-root'), 'admin portal must contain the shared procurement workspace');
assert(staffHtml.includes('data-procurement-root'), 'staff portal must contain the shared procurement workspace');
assert(ui.includes("api('/workspace')"), 'shared UI must load live procurement data');
assert(ui.includes('reportValidity'), 'procurement forms must validate before submission');
assert(ui.includes('Approved requisition items'), 'purchase order forms must load controlled requisition lines');
assert(ui.includes('data-procurement-action'), 'procurement controls must have delegated activation handlers');
assert(styles.includes('@media (max-width: 760px)'), 'procurement workspace must include mobile behavior');
assert(styles.includes('.procurement-dialog'), 'procurement dialogs must have bounded responsive styling');

const staffRole = permissions.match(/staff:\s*\[([^\]]*)\]/)?.[1] || '';
assert(!staffRole.includes('VIEW_PROCUREMENT'), 'ordinary staff must receive procurement through an explicit access grant');

console.log('ERP Wave 3 procurement source audit passed.');
