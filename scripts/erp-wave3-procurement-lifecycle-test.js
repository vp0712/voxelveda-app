const assert = require('node:assert/strict');
const path = require('node:path');

const audits = [];
const notifications = [];
let commits = 0;
let rollbacks = 0;

const connection = {
  async beginTransaction() {},
  async commit() { commits += 1; },
  async rollback() { rollbacks += 1; },
  release() {},
  async query(sql, params = []) {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    if (compact.startsWith('INSERT INTO procurement_sequences')) return [{ affectedRows: 1 }];
    if (compact.startsWith('SELECT next_value FROM procurement_sequences')) return [[{ next_value: 1 }]];
    if (compact.startsWith('UPDATE procurement_sequences SET next_value')) return [{ affectedRows: 1 }];
    if (compact.startsWith('INSERT INTO purchase_requisitions')) return [{ insertId: 101, affectedRows: 1 }];
    if (compact.startsWith('INSERT INTO purchase_requisition_items')) return [{ insertId: 102, affectedRows: 1 }];
    if (compact.startsWith('SELECT * FROM purchase_requisitions WHERE id = ? FOR UPDATE')) {
      return [[{ id: params[0], requisition_no: 'VV-PR-2026-0001', currency: 'AUD', approval_instance_id: 'wf-approved' }]];
    }
    if (compact.startsWith('SELECT * FROM purchase_requisition_items WHERE purchase_requisition_id = ? FOR UPDATE')) {
      return [[{ id: 301, purchase_requisition_id: params[0], item_code: 'FIL-01', description: 'Engineering filament', quantity: 5, unit: 'roll' }]];
    }
    if (compact.startsWith('SELECT poi.requisition_item_id, SUM(poi.quantity)')) return [[]];
    if (compact.startsWith('SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE')) {
      return [[{ id: params[0], po_number: 'VV-PO-2026-0001', approval_instance_id: 'wf-approved', status: 'APPROVED' }]];
    }
    if (compact.startsWith('SELECT status FROM workflow_instances')) return [[{ status: 'APPROVED' }]];
    if (compact.startsWith('SELECT * FROM purchase_order_items WHERE purchase_order_id')) {
      return [[{ id: 501, purchase_order_id: 55, description: 'Engineering filament', quantity: 10, received_quantity: 4 }]];
    }
    if (compact.startsWith('INSERT INTO goods_receipts')) return [{ insertId: 601, affectedRows: 1 }];
    if (compact.startsWith('INSERT INTO goods_receipt_items')) return [{ insertId: 602, affectedRows: 1 }];
    if (compact.startsWith('UPDATE purchase_order_items SET received_quantity')) return [{ affectedRows: 1 }];
    if (compact.startsWith('SELECT SUM(GREATEST(quantity - received_quantity')) return [[{ outstanding: 0 }]];
    if (compact.startsWith('UPDATE purchase_orders SET status')) return [{ affectedRows: 1 }];
    if (compact.startsWith('SELECT id, role, permissions, temporary_permissions')) {
      return [[{ id: 9, role: 'supervisor', permissions: '[]', temporary_permissions: '[]', permission_boundary: null }]];
    }
    throw new Error(`Unhandled procurement lifecycle query: ${compact}`);
  }
};

const pool = { getConnection: async () => connection };

function mockModule(relativePath, exports) {
  const filename = require.resolve(path.join(__dirname, relativePath));
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

mockModule('../config/db', pool);
mockModule('../services/procurementSchema', { ensureProcurementSchema: async () => true });
mockModule('../services/auditService', { logAudit: async (_db, event) => audits.push(event) });
mockModule('../services/notificationService', { createNotification: async (_db, event) => notifications.push(event) });
mockModule('../services/authorizationService', { hasPermission: (_user, permission) => permission === 'INSPECT_GOODS_RECEIPT' });
mockModule('../services/workflowService', {
  cancelWorkflow: async () => true,
  startWorkflow: async () => ({ id: 'workflow-test', status: 'PENDING' })
});

const { ProcurementError, createPurchaseOrder, createRequisition, receiveGoods } = require('../services/procurementService');
const user = { id: 7, role: 'manager' };
const req = { user, ip: '127.0.0.1', headers: { 'x-request-id': 'procurement-lifecycle-test' }, get: () => 'test-agent' };

async function run() {
  await assert.rejects(
    () => createRequisition({ user, req, input: { title: 'Missing lines', items: [] } }),
    (error) => error instanceof ProcurementError && error.code === 'REQUISITION_ITEMS_REQUIRED'
  );

  const requisition = await createRequisition({
    user,
    req,
    input: {
      title: 'Production material',
      currency: 'aud',
      items: [{ description: 'Engineering filament', quantity: 2, unit: 'roll', estimated_unit_price: 125.5 }]
    }
  });
  assert.equal(requisition.requisition_no, 'VV-PR-2026-0001');
  assert.equal(requisition.estimated_total, '251.00');
  assert.equal(audits.at(-1).action, 'REQUISITION_CREATED');
  assert.equal(commits, 1);

  const poRollbackBefore = rollbacks;
  await assert.rejects(
    () => createPurchaseOrder({
      user,
      req,
      input: {
        purchase_requisition_id: 101,
        supplier_id: 1,
        issue_date: '2026-09-10',
        items: [{ requisition_item_id: 301, description: 'Engineering filament', quantity: 6, unit: 'roll', unit_price: 120, tax_rate: 10 }]
      }
    }),
    (error) => error instanceof ProcurementError && error.code === 'PO_REQUISITION_QUANTITY_EXCEEDED'
  );
  assert.equal(rollbacks, poRollbackBefore + 1, 'requisition over-ordering must roll back its transaction');

  const rollbackBefore = rollbacks;
  await assert.rejects(
    () => receiveGoods({
      user,
      req,
      input: { purchase_order_id: 55, received_date: '2026-09-10', items: [{ purchase_order_item_id: 501, quantity_received: 7 }] }
    }),
    (error) => error instanceof ProcurementError && error.code === 'OVER_RECEIPT'
  );
  assert.equal(rollbacks, rollbackBefore + 1, 'over-receipt must roll back its transaction');

  const receipt = await receiveGoods({
    user,
    req,
    input: { purchase_order_id: 55, received_date: '2026-09-10', items: [{ purchase_order_item_id: 501, quantity_received: 6 }] }
  });
  assert.equal(receipt.receipt_no, 'VV-GR-2026-0001');
  assert.equal(receipt.status, 'PENDING_INSPECTION');
  assert.equal(audits.at(-1).action, 'GOODS_RECEIVED');
  assert.equal(notifications.at(-1).type, 'goods_receipt_inspection');
  assert.equal(notifications.at(-1).actionUrl, '/procurement');

  console.log('ERP Wave 3 procurement lifecycle tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
