const crypto = require('crypto');
const pool = require('../config/db');
const money = require('../utils/money');
const { dateOnly } = require('./financeDomain');
const { hasPermission } = require('./authorizationService');
const { logAudit } = require('./auditService');
const { createNotification } = require('./notificationService');
const { ensureProcurementSchema } = require('./procurementSchema');
const { cancelWorkflow, startWorkflow } = require('./workflowService');

const REQUISITION_ACTIVE = new Set(['DRAFT', 'PENDING_APPROVAL', 'PENDING', 'BLOCKED_ASSIGNMENT', 'NEEDS_CHANGES']);
const PO_ACTIVE = new Set(['DRAFT', 'PENDING_APPROVAL', 'PENDING', 'BLOCKED_ASSIGNMENT', 'NEEDS_CHANGES']);

class ProcurementError extends Error {
  constructor(message, statusCode = 400, code = 'PROCUREMENT_VALIDATION_ERROR', details = null) {
    super(message);
    this.name = 'ProcurementError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function requestContext(req) {
  return {
    ipAddress: req?.ip || null,
    userAgent: req?.get?.('user-agent') || null,
    requestId: req?.id || req?.headers?.['x-request-id'] || null,
    sessionId: req?.session?.id || null
  };
}

function clean(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function positiveNumber(value, field, { allowZero = false, max = 1000000000 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (!allowZero && parsed === 0) || parsed > max) {
    throw new ProcurementError(`${field} must be ${allowZero ? 'zero or ' : ''}greater than zero`, 400, 'INVALID_NUMBER', { field });
  }
  return parsed;
}

function currency(value) {
  const result = clean(value || 'AUD', 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(result)) throw new ProcurementError('Currency must be a three-letter code', 400, 'CURRENCY_INVALID');
  return result;
}

function requiredDate(value, field) {
  const result = dateOnly(value);
  if (!result) throw new ProcurementError(`${field} is required`, 400, 'DATE_REQUIRED', { field });
  return result;
}

function optionalDate(value, field) {
  if (!value) return null;
  const result = dateOnly(value);
  if (!result) throw new ProcurementError(`${field} is invalid`, 400, 'DATE_INVALID', { field });
  return result;
}

function normalizeRequisitionItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > 100) {
    throw new ProcurementError('Add between 1 and 100 requisition items', 400, 'REQUISITION_ITEMS_REQUIRED');
  }
  return items.map((item, index) => {
    const description = clean(item.description, 255);
    if (!description) throw new ProcurementError(`Description is required on line ${index + 1}`, 400, 'DESCRIPTION_REQUIRED');
    return {
      lineNo: index + 1,
      itemCode: clean(item.item_code, 120) || null,
      description,
      quantity: positiveNumber(item.quantity, `Quantity on line ${index + 1}`, { max: 1000000 }),
      unit: clean(item.unit || 'each', 30) || 'each',
      estimatedUnitPrice: positiveNumber(item.estimated_unit_price || 0, `Estimated price on line ${index + 1}`, { allowZero: true }),
      preferredSupplierId: Number(item.preferred_supplier_id || 0) || null
    };
  });
}

function normalizePoItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > 100) {
    throw new ProcurementError('Add between 1 and 100 purchase order items', 400, 'PO_ITEMS_REQUIRED');
  }
  return items.map((item, index) => {
    const description = clean(item.description, 255);
    if (!description) throw new ProcurementError(`Description is required on line ${index + 1}`, 400, 'DESCRIPTION_REQUIRED');
    const quantity = positiveNumber(item.quantity, `Quantity on line ${index + 1}`, { max: 1000000 });
    const unitPrice = positiveNumber(item.unit_price || 0, `Unit price on line ${index + 1}`, { allowZero: true });
    const taxRate = positiveNumber(item.tax_rate || 0, `Tax rate on line ${index + 1}`, { allowZero: true, max: 100 });
    const netCents = money.toCents((quantity * unitPrice).toFixed(2));
    const taxCents = money.toCents(money.percentageOf(money.fromCents(netCents), String(taxRate)));
    return {
      lineNo: index + 1,
      requisitionItemId: Number(item.requisition_item_id || 0) || null,
      itemCode: clean(item.item_code, 120) || null,
      description,
      quantity,
      unit: clean(item.unit || 'each', 30) || 'each',
      unitPrice: money.fromCents(money.toCents(unitPrice)),
      taxRate,
      lineSubtotal: money.fromCents(netCents),
      lineTax: money.fromCents(taxCents),
      lineTotal: money.fromCents(netCents + taxCents)
    };
  });
}

function sumMoney(rows, key) {
  return money.fromCents(rows.reduce((total, row) => total + money.toCents(row[key] || 0), 0n));
}

async function nextReference(db, key, prefix, valueDate = new Date()) {
  const year = Number(dateOnly(valueDate).slice(0, 4));
  await db.query(
    `INSERT INTO procurement_sequences (sequence_key, year_value, next_value)
     VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE sequence_key = VALUES(sequence_key)`,
    [key, year]
  );
  const [[row]] = await db.query(
    'SELECT next_value FROM procurement_sequences WHERE sequence_key = ? AND year_value = ? FOR UPDATE',
    [key, year]
  );
  const sequence = Number(row?.next_value || 1);
  await db.query(
    'UPDATE procurement_sequences SET next_value = ? WHERE sequence_key = ? AND year_value = ?',
    [sequence + 1, key, year]
  );
  return `${prefix}-${year}-${String(sequence).padStart(4, '0')}`;
}

async function activeWorkflowStatus(db, instanceId) {
  if (!instanceId) return null;
  const [[row]] = await db.query('SELECT status FROM workflow_instances WHERE id = ? LIMIT 1', [instanceId]);
  return row?.status || null;
}

async function assertApproved(db, row, label) {
  const workflowStatus = await activeWorkflowStatus(db, row.approval_instance_id);
  if (workflowStatus !== 'APPROVED') {
    throw new ProcurementError(`${label} must be approved before this action`, 409, 'APPROVAL_REQUIRED', { workflow_status: workflowStatus });
  }
}

async function notifyPermission(db, permission, notification, excludeUserId = null) {
  const [users] = await db.query(
    'SELECT id, role, permissions, temporary_permissions, permission_boundary FROM users WHERE active = 1 AND deleted_at IS NULL'
  );
  let count = 0;
  for (const user of users) {
    if (Number(user.id) === Number(excludeUserId) || !hasPermission(user, permission)) continue;
    await createNotification(db, {
      userId: user.id,
      type: notification.type,
      category: notification.category || 'FINANCE',
      title: notification.title,
      message: notification.message,
      priority: notification.priority || 'NORMAL',
      linkedModule: 'PROCUREMENT',
      linkedRecordId: notification.recordId,
      actionUrl: '/procurement'
    });
    count += 1;
  }
  return count;
}

async function audit(db, req, entry) {
  return logAudit(db, {
    actorId: req.user.id,
    module: 'PROCUREMENT',
    result: 'SUCCESS',
    ...entry,
    ...requestContext(req)
  });
}

async function listWorkspace() {
  await ensureProcurementSchema();
  const [suppliers, requisitions, supplierRfqs, purchaseOrders, receipts, matches, returns] = await Promise.all([
    pool.query(`SELECT id, supplier_name, contact_name, email, payment_terms FROM suppliers WHERE deleted = 0 ORDER BY supplier_name LIMIT 500`).then(([rows]) => rows),
    pool.query(`SELECT pr.*, u.name AS requester_name, wi.status AS workflow_status,
      (SELECT COUNT(*) FROM purchase_requisition_items pri WHERE pri.purchase_requisition_id = pr.id) AS item_count
      FROM purchase_requisitions pr LEFT JOIN users u ON u.id = pr.requested_by
      LEFT JOIN workflow_instances wi ON wi.id = pr.approval_instance_id
      ORDER BY pr.created_at DESC LIMIT 100`).then(([rows]) => rows),
    pool.query(`SELECT sr.*, pr.requisition_no,
      (SELECT COUNT(*) FROM procurement_supplier_rfq_invites i WHERE i.supplier_rfq_id = sr.id) AS supplier_count,
      (SELECT COUNT(*) FROM procurement_supplier_rfq_invites i WHERE i.supplier_rfq_id = sr.id AND i.status = 'RESPONDED') AS response_count
      FROM procurement_supplier_rfqs sr JOIN purchase_requisitions pr ON pr.id = sr.purchase_requisition_id
      ORDER BY sr.created_at DESC LIMIT 100`).then(([rows]) => rows),
    pool.query(`SELECT po.*, s.supplier_name, pr.requisition_no, wi.status AS workflow_status,
      (SELECT COUNT(*) FROM purchase_order_items poi WHERE poi.purchase_order_id = po.id) AS item_count
      FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
      JOIN purchase_requisitions pr ON pr.id = po.purchase_requisition_id
      LEFT JOIN workflow_instances wi ON wi.id = po.approval_instance_id
      ORDER BY po.created_at DESC LIMIT 100`).then(([rows]) => rows),
    pool.query(`SELECT gr.*, po.po_number, s.supplier_name, ri.inspection_no, ri.result AS inspection_result,
      ri.accepted_quantity, ri.rejected_quantity
      FROM goods_receipts gr JOIN purchase_orders po ON po.id = gr.purchase_order_id
      JOIN suppliers s ON s.id = po.supplier_id LEFT JOIN receiving_inspections ri ON ri.goods_receipt_id = gr.id
      ORDER BY gr.created_at DESC LIMIT 100`).then(([rows]) => rows),
    pool.query(`SELECT bm.*, po.po_number, sb.supplier_invoice_no, s.supplier_name, wi.status AS workflow_status
      FROM procurement_bill_matches bm JOIN purchase_orders po ON po.id = bm.purchase_order_id
      JOIN supplier_bills sb ON sb.id = bm.supplier_bill_id JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN workflow_instances wi ON wi.id = bm.approval_instance_id
      ORDER BY bm.created_at DESC LIMIT 100`).then(([rows]) => rows),
    pool.query(`SELECT pr.*, po.po_number, s.supplier_name, scn.credit_no, scn.supplier_credit_reference, scn.amount AS credit_amount
      FROM purchase_returns pr JOIN purchase_orders po ON po.id = pr.purchase_order_id
      JOIN suppliers s ON s.id = pr.supplier_id LEFT JOIN supplier_credit_notes scn ON scn.purchase_return_id = pr.id
      ORDER BY pr.created_at DESC LIMIT 100`).then(([rows]) => rows)
  ]);

  const summary = {
    requisitions_pending: requisitions.filter((row) => ['PENDING', 'PENDING_APPROVAL', 'BLOCKED_ASSIGNMENT'].includes(row.workflow_status || row.status)).length,
    supplier_rfqs_open: supplierRfqs.filter((row) => row.status === 'OPEN').length,
    purchase_orders_open: purchaseOrders.filter((row) => !['CANCELLED', 'CLOSED', 'RECEIVED'].includes(row.status)).length,
    receipts_waiting_inspection: receipts.filter((row) => !row.inspection_result).length,
    bill_exceptions: matches.filter((row) => row.status === 'EXCEPTION').length,
    credits_pending: returns.filter((row) => row.status === 'CREDIT_PENDING').length
  };
  const [requisitionItems, supplierInvites, purchaseOrderItems, receiptItems, returnItems] = await Promise.all([
    pool.query(`SELECT pri.* FROM purchase_requisition_items pri JOIN purchase_requisitions pr ON pr.id = pri.purchase_requisition_id ORDER BY pri.purchase_requisition_id, pri.line_no`).then(([rows]) => rows),
    pool.query(`SELECT i.*, s.supplier_name FROM procurement_supplier_rfq_invites i JOIN suppliers s ON s.id = i.supplier_id ORDER BY i.supplier_rfq_id, s.supplier_name`).then(([rows]) => rows),
    pool.query(`SELECT poi.* FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.purchase_order_id ORDER BY poi.purchase_order_id, poi.line_no`).then(([rows]) => rows),
    pool.query(`SELECT gri.*, poi.description, poi.item_code, poi.unit, poi.unit_price FROM goods_receipt_items gri JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id JOIN purchase_order_items poi ON poi.id = gri.purchase_order_item_id ORDER BY gri.goods_receipt_id, poi.line_no`).then(([rows]) => rows),
    pool.query(`SELECT pri.*, poi.description, poi.item_code FROM purchase_return_items pri JOIN purchase_returns pr ON pr.id = pri.purchase_return_id JOIN purchase_order_items poi ON poi.id = pri.purchase_order_item_id ORDER BY pri.purchase_return_id, pri.id`).then(([rows]) => rows)
  ]);
  const children = (rows, key, id) => rows.filter((row) => Number(row[key]) === Number(id));
  return {
    summary,
    suppliers,
    requisitions: requisitions.map((row) => ({ ...row, items: children(requisitionItems, 'purchase_requisition_id', row.id) })),
    supplier_rfqs: supplierRfqs.map((row) => ({ ...row, invites: children(supplierInvites, 'supplier_rfq_id', row.id) })),
    purchase_orders: purchaseOrders.map((row) => ({ ...row, items: children(purchaseOrderItems, 'purchase_order_id', row.id) })),
    receipts: receipts.map((row) => ({ ...row, items: children(receiptItems, 'goods_receipt_id', row.id) })),
    bill_matches: matches,
    returns: returns.map((row) => ({ ...row, items: children(returnItems, 'purchase_return_id', row.id) }))
  };
}

async function createRequisition({ user, input, req }) {
  await ensureProcurementSchema();
  const title = clean(input.title, 200);
  if (!title) throw new ProcurementError('Requisition title is required', 400, 'TITLE_REQUIRED');
  const items = normalizeRequisitionItems(input.items);
  const estimatedTotal = money.fromCents(items.reduce(
    (total, item) => total + money.toCents((item.quantity * item.estimatedUnitPrice).toFixed(2)), 0n
  ));
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const requisitionNo = await nextReference(db, 'PR', 'VV-PR');
    const [result] = await db.query(
      `INSERT INTO purchase_requisitions
       (requisition_no, title, department, required_date, business_reason, currency, estimated_total, requested_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [requisitionNo, title, clean(input.department, 120) || null, optionalDate(input.required_date, 'Required date'),
        clean(input.business_reason, 4000) || null, currency(input.currency), estimatedTotal, user.id]
    );
    for (const item of items) {
      await db.query(
        `INSERT INTO purchase_requisition_items
         (purchase_requisition_id, line_no, item_code, description, quantity, unit, estimated_unit_price, preferred_supplier_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [result.insertId, item.lineNo, item.itemCode, item.description, item.quantity, item.unit, item.estimatedUnitPrice, item.preferredSupplierId]
      );
    }
    await audit(db, req, {
      action: 'REQUISITION_CREATED', recordType: 'purchase_requisition', recordId: result.insertId,
      newValue: { requisitionNo, title, estimatedTotal, itemCount: items.length }
    });
    await db.commit();
    return { id: result.insertId, requisition_no: requisitionNo, status: 'DRAFT', estimated_total: estimatedTotal };
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }
}

async function submitRequisition({ id, user, req }) {
  await ensureProcurementSchema();
  const [[current]] = await pool.query('SELECT * FROM purchase_requisitions WHERE id = ?', [id]);
  if (!current) throw new ProcurementError('Requisition not found', 404, 'REQUISITION_NOT_FOUND');
  const workflowStatus = await activeWorkflowStatus(pool, current.approval_instance_id);
  if (current.status !== 'DRAFT' && workflowStatus !== 'NEEDS_CHANGES') {
    throw new ProcurementError('Only a draft or returned requisition can be submitted', 409, 'REQUISITION_NOT_SUBMITTABLE');
  }
  const [result] = await pool.query(
    `UPDATE purchase_requisitions SET status = 'SUBMITTING'
     WHERE id = ? AND status = ? AND COALESCE(approval_instance_id, '') = ?`,
    [id, current.status, current.approval_instance_id || '']
  );
  if (!result.affectedRows) throw new ProcurementError('Only a draft or returned requisition can be submitted', 409, 'REQUISITION_NOT_SUBMITTABLE');
  try {
    const [[row]] = await pool.query('SELECT * FROM purchase_requisitions WHERE id = ?', [id]);
    const instance = await startWorkflow({
      user,
      input: {
        workflow_key: 'PROCUREMENT_APPROVAL', entity_type: 'purchase_requisition', entity_id: String(id),
        title: `Approve ${row.requisition_no}: ${row.title}`,
        summary: row.business_reason || `Estimated value ${row.currency} ${row.estimated_total}`,
        payload: { requisition_no: row.requisition_no, estimated_total: row.estimated_total, required_date: row.required_date }
      },
      req
    });
    await pool.query('UPDATE purchase_requisitions SET status = ?, approval_instance_id = ? WHERE id = ?', [instance.status, instance.id, id]);
    return { ...row, status: instance.status, approval_instance_id: instance.id };
  } catch (error) {
    await pool.query('UPDATE purchase_requisitions SET status = ? WHERE id = ? AND status = \'SUBMITTING\' AND COALESCE(approval_instance_id, \'\') = ?', [current.status, id, current.approval_instance_id || '']).catch(() => {});
    throw error;
  }
}

async function cancelRequisition({ id, reason, user, req }) {
  await ensureProcurementSchema();
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[row]] = await db.query('SELECT * FROM purchase_requisitions WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw new ProcurementError('Requisition not found', 404, 'REQUISITION_NOT_FOUND');
    const workflowStatus = await activeWorkflowStatus(db, row.approval_instance_id);
    if (!REQUISITION_ACTIVE.has(workflowStatus || row.status)) throw new ProcurementError('This requisition can no longer be cancelled', 409, 'REQUISITION_LOCKED');
    await db.commit();
    if (row.approval_instance_id && ['PENDING', 'BLOCKED_ASSIGNMENT'].includes(workflowStatus)) {
      await cancelWorkflow({ instanceId: row.approval_instance_id, user, comment: clean(reason, 4000) || 'Requisition cancelled', req });
    }
    await db.beginTransaction();
    await db.query(
      `UPDATE purchase_requisitions SET status = 'CANCELLED', cancelled_by = ?, cancel_reason = ?, cancelled_at = NOW() WHERE id = ?`,
      [user.id, clean(reason, 4000) || 'Cancelled', id]
    );
    await audit(db, req, { action: 'REQUISITION_CANCELLED', recordType: 'purchase_requisition', recordId: id, oldValue: row, newValue: { reason } });
    await db.commit();
    return { id, status: 'CANCELLED' };
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }
}

async function createSupplierRfq({ user, input, req }) {
  await ensureProcurementSchema();
  const requisitionId = Number(input.purchase_requisition_id || 0);
  const supplierIds = [...new Set((Array.isArray(input.supplier_ids) ? input.supplier_ids : []).map(Number).filter((id) => id > 0))];
  if (!requisitionId || !supplierIds.length || supplierIds.length > 20) {
    throw new ProcurementError('An approved requisition and 1-20 suppliers are required', 400, 'SUPPLIER_RFQ_REQUIRED');
  }
  const issueDate = requiredDate(input.issue_date || new Date(), 'Issue date');
  const responseDueDate = optionalDate(input.response_due_date, 'Response due date');
  if (responseDueDate && responseDueDate < issueDate) throw new ProcurementError('Response due date cannot be before issue date', 400, 'RFQ_DUE_DATE_INVALID');
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[requisition]] = await db.query('SELECT * FROM purchase_requisitions WHERE id = ? FOR UPDATE', [requisitionId]);
    if (!requisition) throw new ProcurementError('Requisition not found', 404, 'REQUISITION_NOT_FOUND');
    await assertApproved(db, requisition, 'Requisition');
    const [items] = await db.query('SELECT * FROM purchase_requisition_items WHERE purchase_requisition_id = ? ORDER BY line_no', [requisitionId]);
    const [validSuppliers] = await db.query(`SELECT id FROM suppliers WHERE id IN (${supplierIds.map(() => '?').join(',')}) AND deleted = 0`, supplierIds);
    if (validSuppliers.length !== supplierIds.length) throw new ProcurementError('One or more suppliers are not active', 409, 'SUPPLIER_INVALID');
    const reference = await nextReference(db, 'SRFQ', 'VV-SRFQ', issueDate);
    const [result] = await db.query(
      `INSERT INTO procurement_supplier_rfqs
       (supplier_rfq_no, purchase_requisition_id, title, issue_date, response_due_date, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [reference, requisitionId, clean(input.title || requisition.title, 200), issueDate, responseDueDate, clean(input.notes, 4000) || null, user.id]
    );
    for (const item of items) {
      await db.query(
        `INSERT INTO procurement_supplier_rfq_lines
         (supplier_rfq_id, requisition_item_id, line_no, item_code, description, quantity, unit)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [result.insertId, item.id, item.line_no, item.item_code, item.description, item.quantity, item.unit]
      );
    }
    for (const supplierId of supplierIds) {
      await db.query('INSERT INTO procurement_supplier_rfq_invites (supplier_rfq_id, supplier_id) VALUES (?, ?)', [result.insertId, supplierId]);
    }
    await db.query("UPDATE purchase_requisitions SET status = 'SOURCING' WHERE id = ?", [requisitionId]);
    await audit(db, req, {
      action: 'SUPPLIER_RFQ_ISSUED', recordType: 'procurement_supplier_rfq', recordId: result.insertId,
      newValue: { supplierRfqNo: reference, requisitionId, suppliers: supplierIds }
    });
    await db.commit();
    return { id: result.insertId, supplier_rfq_no: reference, status: 'OPEN' };
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }
}

async function recordSupplierResponse({ rfqId, user, input, req }) {
  await ensureProcurementSchema();
  const supplierId = Number(input.supplier_id || 0);
  const quotedTotal = money.fromCents(money.toCents(positiveNumber(input.quoted_total, 'Quoted total')));
  const leadTime = input.lead_time_days == null || input.lead_time_days === '' ? null : Math.trunc(positiveNumber(input.lead_time_days, 'Lead time', { allowZero: true, max: 3650 }));
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[rfq]] = await db.query('SELECT * FROM procurement_supplier_rfqs WHERE id = ? FOR UPDATE', [rfqId]);
    if (!rfq) throw new ProcurementError('Supplier RFQ not found', 404, 'SUPPLIER_RFQ_NOT_FOUND');
    if (rfq.status !== 'OPEN') throw new ProcurementError('Supplier RFQ is closed', 409, 'SUPPLIER_RFQ_CLOSED');
    const [result] = await db.query(
      `UPDATE procurement_supplier_rfq_invites SET status = 'RESPONDED', quote_reference = ?, quoted_total = ?,
       lead_time_days = ?, response_notes = ?, responded_at = NOW() WHERE supplier_rfq_id = ? AND supplier_id = ?`,
      [clean(input.quote_reference, 120) || null, quotedTotal, leadTime, clean(input.response_notes, 4000) || null, rfqId, supplierId]
    );
    if (!result.affectedRows) throw new ProcurementError('Supplier was not invited to this RFQ', 404, 'SUPPLIER_NOT_INVITED');
    await audit(db, req, {
      action: 'SUPPLIER_QUOTE_RECORDED', recordType: 'procurement_supplier_rfq', recordId: rfqId,
      newValue: { supplierId, quotedTotal, leadTime }
    });
    await db.commit();
    return { id: rfqId, supplier_id: supplierId, status: 'RESPONDED' };
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }
}

async function closeSupplierRfq({ rfqId, user, input, req }) {
  await ensureProcurementSchema();
  const supplierId = Number(input.selected_supplier_id || 0) || null;
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[rfq]] = await db.query('SELECT * FROM procurement_supplier_rfqs WHERE id = ? FOR UPDATE', [rfqId]);
    if (!rfq) throw new ProcurementError('Supplier RFQ not found', 404, 'SUPPLIER_RFQ_NOT_FOUND');
    if (rfq.status !== 'OPEN') throw new ProcurementError('Supplier RFQ is already closed', 409, 'SUPPLIER_RFQ_CLOSED');
    if (supplierId) {
      const [[invite]] = await db.query(
        "SELECT * FROM procurement_supplier_rfq_invites WHERE supplier_rfq_id = ? AND supplier_id = ? AND status = 'RESPONDED' FOR UPDATE",
        [rfqId, supplierId]
      );
      if (!invite) throw new ProcurementError('Select a supplier with a recorded response', 409, 'SUPPLIER_RESPONSE_REQUIRED');
      await db.query(
        "UPDATE procurement_supplier_rfq_invites SET status = CASE WHEN supplier_id = ? THEN 'SELECTED' WHEN status = 'RESPONDED' THEN 'NOT_SELECTED' ELSE status END, selected_at = CASE WHEN supplier_id = ? THEN NOW() ELSE selected_at END, selected_by = CASE WHEN supplier_id = ? THEN ? ELSE selected_by END WHERE supplier_rfq_id = ?",
        [supplierId, supplierId, supplierId, user.id, rfqId]
      );
    }
    const status = supplierId ? 'AWARDED' : 'CLOSED';
    await db.query(
      'UPDATE procurement_supplier_rfqs SET status = ?, closed_by = ?, closed_at = NOW(), close_reason = ? WHERE id = ?',
      [status, user.id, clean(input.close_reason, 4000) || null, rfqId]
    );
    await audit(db, req, {
      action: supplierId ? 'SUPPLIER_RFQ_AWARDED' : 'SUPPLIER_RFQ_CLOSED', recordType: 'procurement_supplier_rfq', recordId: rfqId,
      oldValue: rfq, newValue: { status, selectedSupplierId: supplierId }
    });
    await db.commit();
    return { id: rfqId, status, selected_supplier_id: supplierId };
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }
}

async function createPurchaseOrder({ user, input, req }) {
  await ensureProcurementSchema();
  const requisitionId = Number(input.purchase_requisition_id || 0);
  const supplierId = Number(input.supplier_id || 0);
  if (!requisitionId || !supplierId) throw new ProcurementError('Requisition and supplier are required', 400, 'PO_PARTIES_REQUIRED');
  const issueDate = requiredDate(input.issue_date || new Date(), 'Issue date');
  const expectedDate = optionalDate(input.expected_date, 'Expected date');
  if (expectedDate && expectedDate < issueDate) throw new ProcurementError('Expected date cannot be before issue date', 400, 'PO_DATE_INVALID');
  let items = normalizePoItems(input.items);
  const subtotal = sumMoney(items, 'lineSubtotal');
  const taxAmount = sumMoney(items, 'lineTax');
  const totalAmount = sumMoney(items, 'lineTotal');
  const supplierRfqId = Number(input.supplier_rfq_id || 0) || null;
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[requisition]] = await db.query('SELECT * FROM purchase_requisitions WHERE id = ? FOR UPDATE', [requisitionId]);
    if (!requisition) throw new ProcurementError('Requisition not found', 404, 'REQUISITION_NOT_FOUND');
    await assertApproved(db, requisition, 'Requisition');
    const [requisitionItems] = await db.query(
      'SELECT * FROM purchase_requisition_items WHERE purchase_requisition_id = ? FOR UPDATE',
      [requisitionId]
    );
    const requisitionItemsById = new Map(requisitionItems.map((item) => [Number(item.id), item]));
    if (items.some((item) => !item.requisitionItemId || !requisitionItemsById.has(item.requisitionItemId))) {
      throw new ProcurementError('Every purchase order line must belong to the approved requisition', 409, 'PO_REQUISITION_LINE_INVALID');
    }
    if (new Set(items.map((item) => item.requisitionItemId)).size !== items.length) {
      throw new ProcurementError('Each requisition line can appear only once on a purchase order', 409, 'PO_REQUISITION_LINE_DUPLICATE');
    }
    const [orderedRows] = await db.query(
      `SELECT poi.requisition_item_id, SUM(poi.quantity) AS ordered_quantity
       FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.purchase_order_id
       WHERE po.purchase_requisition_id = ? AND po.status <> 'CANCELLED'
       GROUP BY poi.requisition_item_id`,
      [requisitionId]
    );
    const orderedByItemId = new Map(orderedRows.map((row) => [Number(row.requisition_item_id), Number(row.ordered_quantity || 0)]));
    items = items.map((item) => {
      const requested = requisitionItemsById.get(item.requisitionItemId);
      const remaining = Number(requested.quantity) - Number(orderedByItemId.get(item.requisitionItemId) || 0);
      if (item.quantity > remaining + 0.0001) {
        throw new ProcurementError(`Order quantity exceeds the remaining requisition amount for ${requested.description}`, 409, 'PO_REQUISITION_QUANTITY_EXCEEDED');
      }
      return { ...item, itemCode: requested.item_code, description: requested.description, unit: requested.unit };
    });
    const [[supplier]] = await db.query('SELECT * FROM suppliers WHERE id = ? AND deleted = 0', [supplierId]);
    if (!supplier) throw new ProcurementError('Supplier not found', 404, 'SUPPLIER_NOT_FOUND');
    if (supplierRfqId) {
      const [[selection]] = await db.query(
        `SELECT i.id FROM procurement_supplier_rfq_invites i JOIN procurement_supplier_rfqs r ON r.id = i.supplier_rfq_id
         WHERE i.supplier_rfq_id = ? AND i.supplier_id = ? AND i.status = 'SELECTED' AND r.purchase_requisition_id = ?`,
        [supplierRfqId, supplierId, requisitionId]
      );
      if (!selection) throw new ProcurementError('The supplier is not the selected quote for this RFQ', 409, 'SUPPLIER_NOT_SELECTED');
    }
    const poNumber = await nextReference(db, 'PO', 'VV-PO', issueDate);
    const [result] = await db.query(
      `INSERT INTO purchase_orders
       (po_number, purchase_requisition_id, supplier_rfq_id, supplier_id, currency, issue_date, expected_date,
        payment_terms, delivery_address, notes, subtotal, tax_amount, total_amount, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [poNumber, requisitionId, supplierRfqId, supplierId, currency(input.currency || requisition.currency), issueDate,
        expectedDate, clean(input.payment_terms || supplier.payment_terms, 160) || null, clean(input.delivery_address, 4000) || null,
        clean(input.notes, 4000) || null, subtotal, taxAmount, totalAmount, user.id]
    );
    for (const item of items) {
      await db.query(
        `INSERT INTO purchase_order_items
         (purchase_order_id, requisition_item_id, line_no, item_code, description, quantity, unit,
          unit_price, tax_rate, line_subtotal, line_tax, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [result.insertId, item.requisitionItemId, item.lineNo, item.itemCode, item.description, item.quantity, item.unit,
          item.unitPrice, item.taxRate, item.lineSubtotal, item.lineTax, item.lineTotal]
      );
    }
    await db.query("UPDATE purchase_requisitions SET status = 'ORDER_DRAFTED' WHERE id = ?", [requisitionId]);
    await audit(db, req, {
      action: 'PURCHASE_ORDER_CREATED', recordType: 'purchase_order', recordId: result.insertId,
      newValue: { poNumber, supplierId, subtotal, taxAmount, totalAmount, itemCount: items.length }
    });
    await db.commit();
    return { id: result.insertId, po_number: poNumber, status: 'DRAFT', subtotal, tax_amount: taxAmount, total_amount: totalAmount };
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }
}

async function submitPurchaseOrder({ id, user, req }) {
  await ensureProcurementSchema();
  const [[current]] = await pool.query('SELECT * FROM purchase_orders WHERE id = ?', [id]);
  if (!current) throw new ProcurementError('Purchase order not found', 404, 'PO_NOT_FOUND');
  const workflowStatus = await activeWorkflowStatus(pool, current.approval_instance_id);
  if (current.status !== 'DRAFT' && workflowStatus !== 'NEEDS_CHANGES') {
    throw new ProcurementError('Only a draft or returned purchase order can be submitted', 409, 'PO_NOT_SUBMITTABLE');
  }
  const [result] = await pool.query(
    `UPDATE purchase_orders SET status = 'SUBMITTING'
     WHERE id = ? AND status = ? AND COALESCE(approval_instance_id, '') = ?`,
    [id, current.status, current.approval_instance_id || '']
  );
  if (!result.affectedRows) throw new ProcurementError('Only a draft or returned purchase order can be submitted', 409, 'PO_NOT_SUBMITTABLE');
  try {
    const [[row]] = await pool.query('SELECT po.*, s.supplier_name FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?', [id]);
    const instance = await startWorkflow({
      user,
      input: {
        workflow_key: 'PROCUREMENT_APPROVAL', entity_type: 'purchase_order', entity_id: String(id),
        title: `Approve ${row.po_number} for ${row.supplier_name}`,
        summary: `${row.currency} ${row.total_amount}`,
        payload: { po_number: row.po_number, supplier_id: row.supplier_id, total_amount: row.total_amount, expected_date: row.expected_date }
      },
      req
    });
    await pool.query('UPDATE purchase_orders SET status = ?, approval_instance_id = ? WHERE id = ?', [instance.status, instance.id, id]);
    return { ...row, status: instance.status, approval_instance_id: instance.id };
  } catch (error) {
    await pool.query('UPDATE purchase_orders SET status = ? WHERE id = ? AND status = \'SUBMITTING\' AND COALESCE(approval_instance_id, \'\') = ?', [current.status, id, current.approval_instance_id || '']).catch(() => {});
    throw error;
  }
}

async function cancelPurchaseOrder({ id, reason, user, req }) {
  await ensureProcurementSchema();
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[row]] = await db.query('SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw new ProcurementError('Purchase order not found', 404, 'PO_NOT_FOUND');
    const workflowStatus = await activeWorkflowStatus(db, row.approval_instance_id);
    if (!PO_ACTIVE.has(workflowStatus || row.status)) throw new ProcurementError('Received or completed purchase orders cannot be cancelled', 409, 'PO_LOCKED');
    await db.commit();
    if (row.approval_instance_id && ['PENDING', 'BLOCKED_ASSIGNMENT'].includes(workflowStatus)) {
      await cancelWorkflow({ instanceId: row.approval_instance_id, user, comment: clean(reason, 4000) || 'Purchase order cancelled', req });
    }
    await db.beginTransaction();
    await db.query(
      `UPDATE purchase_orders SET status = 'CANCELLED', cancelled_by = ?, cancel_reason = ?, cancelled_at = NOW() WHERE id = ?`,
      [user.id, clean(reason, 4000) || 'Cancelled', id]
    );
    await audit(db, req, { action: 'PURCHASE_ORDER_CANCELLED', recordType: 'purchase_order', recordId: id, oldValue: row, newValue: { reason } });
    await db.commit();
    return { id, status: 'CANCELLED' };
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }
}

async function receiveGoods({ user, input, req }) {
  await ensureProcurementSchema();
  const poId = Number(input.purchase_order_id || 0);
  const lines = Array.isArray(input.items) ? input.items : [];
  if (!poId || !lines.length || lines.length > 100) throw new ProcurementError('Purchase order and receipt quantities are required', 400, 'RECEIPT_ITEMS_REQUIRED');
  const receivedDate = requiredDate(input.received_date || new Date(), 'Received date');
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[po]] = await db.query('SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE', [poId]);
    if (!po) throw new ProcurementError('Purchase order not found', 404, 'PO_NOT_FOUND');
    await assertApproved(db, po, 'Purchase order');
    const [poItems] = await db.query('SELECT * FROM purchase_order_items WHERE purchase_order_id = ? FOR UPDATE', [poId]);
    const byId = new Map(poItems.map((item) => [Number(item.id), item]));
    const normalized = lines.map((line) => {
      const item = byId.get(Number(line.purchase_order_item_id));
      if (!item) throw new ProcurementError('Receipt item does not belong to this purchase order', 409, 'RECEIPT_ITEM_INVALID');
      const quantity = positiveNumber(line.quantity_received, 'Received quantity', { max: 1000000 });
      const outstanding = Number(item.quantity) - Number(item.received_quantity);
      if (quantity > outstanding + 0.0001) throw new ProcurementError(`Received quantity exceeds the outstanding amount for ${item.description}`, 409, 'OVER_RECEIPT');
      return { item, quantity, lotBatchNo: clean(line.lot_batch_no, 120) || null, notes: clean(line.notes, 4000) || null };
    });
    if (new Set(normalized.map((line) => Number(line.item.id))).size !== normalized.length) {
      throw new ProcurementError('Each purchase order line can appear only once per receipt', 409, 'DUPLICATE_RECEIPT_LINE');
    }
    const receiptNo = await nextReference(db, 'GR', 'VV-GR', receivedDate);
    const [result] = await db.query(
      `INSERT INTO goods_receipts
       (receipt_no, purchase_order_id, received_date, delivery_reference, status, notes, received_by)
       VALUES (?, ?, ?, ?, 'PENDING_INSPECTION', ?, ?)`,
      [receiptNo, poId, receivedDate, clean(input.delivery_reference, 160) || null, clean(input.notes, 4000) || null, user.id]
    );
    for (const line of normalized) {
      await db.query(
        `INSERT INTO goods_receipt_items
         (goods_receipt_id, purchase_order_item_id, quantity_received, lot_batch_no, notes)
         VALUES (?, ?, ?, ?, ?)`,
        [result.insertId, line.item.id, line.quantity, line.lotBatchNo, line.notes]
      );
      await db.query('UPDATE purchase_order_items SET received_quantity = received_quantity + ? WHERE id = ?', [line.quantity, line.item.id]);
    }
    const [[remaining]] = await db.query(
      'SELECT SUM(GREATEST(quantity - received_quantity, 0)) AS outstanding FROM purchase_order_items WHERE purchase_order_id = ?', [poId]
    );
    await db.query('UPDATE purchase_orders SET status = ? WHERE id = ?', [Number(remaining.outstanding || 0) > 0 ? 'PART_RECEIVED' : 'RECEIVED', poId]);
    await audit(db, req, {
      action: 'GOODS_RECEIVED', recordType: 'goods_receipt', recordId: result.insertId,
      newValue: { receiptNo, poId, lines: normalized.map((line) => ({ itemId: line.item.id, quantity: line.quantity })) }
    });
    await notifyPermission(db, 'INSPECT_GOODS_RECEIPT', {
      type: 'goods_receipt_inspection', title: 'Goods inspection required',
      message: `${receiptNo} is waiting for receiving inspection.`, priority: 'HIGH', recordId: result.insertId
    }, user.id);
    await db.commit();
    return { id: result.insertId, receipt_no: receiptNo, status: 'PENDING_INSPECTION' };
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }
}

async function inspectReceipt({ receiptId, user, input, req }) {
  await ensureProcurementSchema();
  const result = clean(input.result, 30).toUpperCase();
  if (!['PASS', 'PARTIAL', 'FAIL'].includes(result)) throw new ProcurementError('Inspection result must be pass, partial or fail', 400, 'INSPECTION_RESULT_INVALID');
  const accepted = positiveNumber(input.accepted_quantity || 0, 'Accepted quantity', { allowZero: true, max: 1000000 });
  const rejected = positiveNumber(input.rejected_quantity || 0, 'Rejected quantity', { allowZero: true, max: 1000000 });
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[receipt]] = await db.query('SELECT * FROM goods_receipts WHERE id = ? FOR UPDATE', [receiptId]);
    if (!receipt) throw new ProcurementError('Goods receipt not found', 404, 'RECEIPT_NOT_FOUND');
    const [[existing]] = await db.query('SELECT id FROM receiving_inspections WHERE goods_receipt_id = ?', [receiptId]);
    if (existing) throw new ProcurementError('This receipt has already been inspected', 409, 'RECEIPT_ALREADY_INSPECTED');
    const [[totals]] = await db.query('SELECT SUM(quantity_received) AS quantity FROM goods_receipt_items WHERE goods_receipt_id = ?', [receiptId]);
    const received = Number(totals.quantity || 0);
    if (Math.abs((accepted + rejected) - received) > 0.0001) {
      throw new ProcurementError('Accepted plus rejected quantity must equal the received quantity', 409, 'INSPECTION_QUANTITY_MISMATCH');
    }
    if ((result === 'PASS' && rejected > 0) || (result === 'FAIL' && accepted > 0) || (result === 'PARTIAL' && (!accepted || !rejected))) {
      throw new ProcurementError('Inspection quantities do not match the selected result', 409, 'INSPECTION_RESULT_MISMATCH');
    }
    const inspectionNo = await nextReference(db, 'INSP', 'VV-INSP', receipt.received_date);
    const [insert] = await db.query(
      `INSERT INTO receiving_inspections
       (inspection_no, goods_receipt_id, result, accepted_quantity, rejected_quantity, nonconformance_reference, notes, inspected_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [inspectionNo, receiptId, result, accepted, rejected, clean(input.nonconformance_reference, 120) || null, clean(input.notes, 4000) || null, user.id]
    );
    const receiptStatus = result === 'PASS' ? 'ACCEPTED' : result === 'FAIL' ? 'REJECTED' : 'PARTIALLY_ACCEPTED';
    await db.query('UPDATE goods_receipts SET status = ? WHERE id = ?', [receiptStatus, receiptId]);
    await db.query('UPDATE goods_receipt_items SET condition_status = ? WHERE goods_receipt_id = ?', [receiptStatus, receiptId]);
    await audit(db, req, {
      action: 'GOODS_RECEIPT_INSPECTED', recordType: 'receiving_inspection', recordId: insert.insertId,
      newValue: { inspectionNo, receiptId, result, accepted, rejected }
    });
    await db.commit();
    return { id: insert.insertId, inspection_no: inspectionNo, result, receipt_status: receiptStatus };
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }
}

async function createBillMatch({ user, input, req }) {
  await ensureProcurementSchema();
  const poId = Number(input.purchase_order_id || 0);
  const receiptId = Number(input.goods_receipt_id || 0);
  const supplierInvoiceNo = clean(input.supplier_invoice_no, 120);
  if (!poId || !receiptId || !supplierInvoiceNo) throw new ProcurementError('Purchase order, inspected receipt and supplier invoice number are required', 400, 'BILL_MATCH_REQUIRED');
  const issueDate = requiredDate(input.issue_date || new Date(), 'Issue date');
  const dueDate = optionalDate(input.due_date, 'Due date');
  const tolerance = money.fromCents(money.toCents(positiveNumber(input.tolerance_amount || 0, 'Tolerance', { allowZero: true })));
  const billTotal = money.fromCents(money.toCents(positiveNumber(input.bill_total, 'Bill total')));
  const db = await pool.getConnection();
  let matchId;
  let matchNo;
  let matchStatus;
  let billId;
  try {
    await db.beginTransaction();
    const [[po]] = await db.query('SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE', [poId]);
    if (!po) throw new ProcurementError('Purchase order not found', 404, 'PO_NOT_FOUND');
    await assertApproved(db, po, 'Purchase order');
    const [[receipt]] = await db.query('SELECT * FROM goods_receipts WHERE id = ? AND purchase_order_id = ? FOR UPDATE', [receiptId, poId]);
    if (!receipt) throw new ProcurementError('Receipt does not belong to this purchase order', 409, 'RECEIPT_PO_MISMATCH');
    const [[inspection]] = await db.query('SELECT * FROM receiving_inspections WHERE goods_receipt_id = ?', [receiptId]);
    if (!inspection || inspection.result === 'FAIL') throw new ProcurementError('An accepted or partially accepted inspection is required', 409, 'ACCEPTED_INSPECTION_REQUIRED');
    const [[duplicate]] = await db.query("SELECT id FROM supplier_bills WHERE supplier_id = ? AND supplier_invoice_no = ? AND status <> 'VOID'", [po.supplier_id, supplierInvoiceNo]);
    if (duplicate) throw new ProcurementError('This supplier invoice number already exists', 409, 'SUPPLIER_INVOICE_DUPLICATE');
    const [receivedLines] = await db.query(
      `SELECT gri.quantity_received, poi.* FROM goods_receipt_items gri
       JOIN purchase_order_items poi ON poi.id = gri.purchase_order_item_id WHERE gri.goods_receipt_id = ? ORDER BY poi.line_no`, [receiptId]
    );
    const acceptedRatio = Number(inspection.accepted_quantity) / Math.max(0.000001, Number(inspection.accepted_quantity) + Number(inspection.rejected_quantity));
    let receiptCents = 0n;
    let receiptNetCents = 0n;
    let receiptTaxCents = 0n;
    const billLines = receivedLines.map((line, index) => {
      const acceptedQty = Number(line.quantity_received) * acceptedRatio;
      const net = money.toCents((acceptedQty * Number(line.unit_price)).toFixed(2));
      const tax = money.toCents(money.percentageOf(money.fromCents(net), String(line.tax_rate || 0)));
      receiptNetCents += net;
      receiptTaxCents += tax;
      receiptCents += net + tax;
      return { ...line, lineNo: index + 1, acceptedQty, net: money.fromCents(net), tax: money.fromCents(tax), total: money.fromCents(net + tax) };
    });
    const amountVarianceCents = money.toCents(billTotal) - receiptCents;
    const absVariance = amountVarianceCents < 0n ? -amountVarianceCents : amountVarianceCents;
    matchStatus = absVariance <= money.toCents(tolerance) ? 'MATCHED' : 'EXCEPTION';
    const billUid = `BILL-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const [billInsert] = await db.query(
      `INSERT INTO supplier_bills
       (bill_uid, supplier_id, supplier_invoice_no, issue_date, due_date, job_reference,
        net_amount, gst_amount, total_amount, status, approval_note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [billUid, po.supplier_id, supplierInvoiceNo, issueDate, dueDate, po.po_number,
        money.fromCents(receiptNetCents), money.fromCents(receiptTaxCents), billTotal,
        matchStatus === 'MATCHED' ? 'PENDING_APPROVAL' : 'DRAFT',
        matchStatus === 'MATCHED' ? `Three-way matched to ${po.po_number}` : 'Three-way match exception - payment hold', user.id]
    );
    billId = billInsert.insertId;
    for (const line of billLines) {
      await db.query(
        `INSERT INTO supplier_bill_items
         (supplier_bill_id, line_no, description, quantity, unit_price, net_amount, gst_amount, total_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [billId, line.lineNo, line.description, line.acceptedQty, line.unit_price, line.net, line.tax, line.total]
      );
    }
    if (amountVarianceCents !== 0n) {
      const varianceAmount = money.fromCents(amountVarianceCents);
      await db.query(
        `INSERT INTO supplier_bill_items
         (supplier_bill_id, line_no, description, quantity, unit_price, net_amount, gst_amount, total_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [billId, billLines.length + 1, 'Supplier invoice variance under review', 1, varianceAmount, varianceAmount, 0, varianceAmount]
      );
    }
    matchNo = await nextReference(db, 'MATCH', 'VV-MATCH', issueDate);
    const [matchInsert] = await db.query(
      `INSERT INTO procurement_bill_matches
       (match_no, purchase_order_id, goods_receipt_id, supplier_bill_id, purchase_total, receipt_total,
        bill_total, quantity_variance, amount_variance, tolerance_amount, status, exception_reason, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [matchNo, poId, receiptId, billId, po.total_amount, money.fromCents(receiptCents), billTotal,
        Number(inspection.rejected_quantity || 0), money.fromCents(amountVarianceCents), tolerance, matchStatus,
        matchStatus === 'EXCEPTION' ? clean(input.exception_reason, 4000) || 'Supplier bill is outside the approved match tolerance' : null, user.id]
    );
    matchId = matchInsert.insertId;
    await audit(db, req, {
      action: 'THREE_WAY_MATCH_COMPLETED', recordType: 'procurement_bill_match', recordId: matchId,
      newValue: { matchNo, poId, receiptId, billId, status: matchStatus, billTotal, receiptTotal: money.fromCents(receiptCents), tolerance }
    });
    if (matchStatus === 'EXCEPTION') {
      await notifyPermission(db, 'MANAGE_SUPPLIER_BILL_MATCH', {
        type: 'procurement_match_exception', title: 'Supplier bill match exception',
        message: `${matchNo} is on hold and needs review.`, priority: 'CRITICAL', recordId: matchId
      }, user.id);
    }
    await db.commit();
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }

  if (matchStatus === 'MATCHED') {
    try {
      const instance = await startWorkflow({
        user,
        input: {
          workflow_key: 'FINANCE_APPROVAL', entity_type: 'supplier_bill', entity_id: String(billId),
          title: `Approve matched supplier bill ${supplierInvoiceNo}`,
          summary: `${matchNo} matched against the purchase order and inspected receipt.`,
          payload: { match_id: matchId, match_no: matchNo, purchase_order_id: poId, goods_receipt_id: receiptId, bill_total: billTotal }
        },
        req
      });
      await pool.query('UPDATE procurement_bill_matches SET approval_instance_id = ? WHERE id = ?', [instance.id, matchId]);
      return { id: matchId, match_no: matchNo, status: matchStatus, supplier_bill_id: billId, approval_instance_id: instance.id };
    } catch (error) {
      await pool.query("UPDATE procurement_bill_matches SET status = 'EXCEPTION', exception_reason = 'Finance approval workflow could not be started' WHERE id = ?", [matchId]).catch(() => {});
      await pool.query("UPDATE supplier_bills SET status = 'DRAFT', approval_note = 'Finance workflow handoff failed - payment hold' WHERE id = ?", [billId]).catch(() => {});
      throw error;
    }
  }
  return { id: matchId, match_no: matchNo, status: matchStatus, supplier_bill_id: billId };
}

async function createPurchaseReturn({ user, input, req }) {
  await ensureProcurementSchema();
  const poId = Number(input.purchase_order_id || 0);
  const receiptId = Number(input.goods_receipt_id || 0);
  const reason = clean(input.reason, 4000);
  const lines = Array.isArray(input.items) ? input.items : [];
  if (!poId || !receiptId || !reason || !lines.length || lines.length > 100) {
    throw new ProcurementError('Purchase order, receipt, reason and return items are required', 400, 'RETURN_REQUIRED');
  }
  const returnDate = requiredDate(input.return_date || new Date(), 'Return date');
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[po]] = await db.query('SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE', [poId]);
    const [[receipt]] = await db.query('SELECT * FROM goods_receipts WHERE id = ? AND purchase_order_id = ? FOR UPDATE', [receiptId, poId]);
    if (!po || !receipt) throw new ProcurementError('Purchase order or matching receipt not found', 404, 'RETURN_SOURCE_NOT_FOUND');
    const [receiptItems] = await db.query(
      `SELECT gri.quantity_received, poi.* FROM goods_receipt_items gri JOIN purchase_order_items poi ON poi.id = gri.purchase_order_item_id
       WHERE gri.goods_receipt_id = ? FOR UPDATE`, [receiptId]
    );
    const byId = new Map(receiptItems.map((item) => [Number(item.id), item]));
    let totalCents = 0n;
    const normalized = lines.map((line) => {
      const item = byId.get(Number(line.purchase_order_item_id));
      if (!item) throw new ProcurementError('Return item does not belong to this receipt', 409, 'RETURN_ITEM_INVALID');
      const quantity = positiveNumber(line.quantity, 'Return quantity', { max: 1000000 });
      const available = Number(item.quantity_received) - Number(item.returned_quantity || 0);
      if (quantity > available + 0.0001) throw new ProcurementError(`Return quantity exceeds received stock for ${item.description}`, 409, 'OVER_RETURN');
      const lineCents = money.toCents((quantity * Number(item.unit_price)).toFixed(2));
      totalCents += lineCents;
      return { item, quantity, lineTotal: money.fromCents(lineCents), reason: clean(line.reason, 500) || null };
    });
    if (new Set(normalized.map((line) => Number(line.item.id))).size !== normalized.length) throw new ProcurementError('Each purchase order line can be returned only once per return', 409, 'DUPLICATE_RETURN_LINE');
    const returnNo = await nextReference(db, 'RET', 'VV-RET', returnDate);
    const [result] = await db.query(
      `INSERT INTO purchase_returns
       (return_no, purchase_order_id, goods_receipt_id, supplier_id, return_date, reason, total_amount, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [returnNo, poId, receiptId, po.supplier_id, returnDate, reason, money.fromCents(totalCents), user.id]
    );
    for (const line of normalized) {
      await db.query(
        `INSERT INTO purchase_return_items
         (purchase_return_id, purchase_order_item_id, quantity, unit_price, line_total, reason)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [result.insertId, line.item.id, line.quantity, line.item.unit_price, line.lineTotal, line.reason]
      );
      await db.query('UPDATE purchase_order_items SET returned_quantity = returned_quantity + ? WHERE id = ?', [line.quantity, line.item.id]);
    }
    await audit(db, req, {
      action: 'PURCHASE_RETURN_CREATED', recordType: 'purchase_return', recordId: result.insertId,
      newValue: { returnNo, poId, receiptId, totalAmount: money.fromCents(totalCents), reason }
    });
    await notifyPermission(db, 'MANAGE_PURCHASE_RETURNS', {
      type: 'supplier_credit_pending', title: 'Supplier credit note pending',
      message: `${returnNo} is waiting for a supplier credit note.`, priority: 'HIGH', recordId: result.insertId
    }, user.id);
    await db.commit();
    return { id: result.insertId, return_no: returnNo, status: 'CREDIT_PENDING', total_amount: money.fromCents(totalCents) };
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }
}

async function recordCreditNote({ returnId, user, input, req }) {
  await ensureProcurementSchema();
  const supplierReference = clean(input.supplier_credit_reference, 120);
  const amount = money.fromCents(money.toCents(positiveNumber(input.amount, 'Credit amount')));
  const issueDate = requiredDate(input.issue_date || new Date(), 'Issue date');
  if (!supplierReference) throw new ProcurementError('Supplier credit reference is required', 400, 'CREDIT_REFERENCE_REQUIRED');
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[purchaseReturn]] = await db.query('SELECT * FROM purchase_returns WHERE id = ? FOR UPDATE', [returnId]);
    if (!purchaseReturn) throw new ProcurementError('Purchase return not found', 404, 'RETURN_NOT_FOUND');
    if (purchaseReturn.status !== 'CREDIT_PENDING') throw new ProcurementError('This return is not waiting for a credit note', 409, 'CREDIT_NOT_PENDING');
    if (money.toCents(amount) > money.toCents(purchaseReturn.total_amount)) throw new ProcurementError('Credit amount cannot exceed the return value', 409, 'CREDIT_EXCEEDS_RETURN');
    const creditNo = await nextReference(db, 'CN', 'VV-CN', issueDate);
    const [result] = await db.query(
      `INSERT INTO supplier_credit_notes
       (credit_no, purchase_return_id, supplier_id, supplier_credit_reference, issue_date, amount, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [creditNo, returnId, purchaseReturn.supplier_id, supplierReference, issueDate, amount, clean(input.notes, 4000) || null, user.id]
    );
    await db.query("UPDATE purchase_returns SET status = 'CREDIT_RECEIVED' WHERE id = ?", [returnId]);
    await audit(db, req, {
      action: 'SUPPLIER_CREDIT_RECORDED', recordType: 'supplier_credit_note', recordId: result.insertId,
      newValue: { creditNo, returnId, supplierReference, amount }
    });
    await db.commit();
    return { id: result.insertId, credit_no: creditNo, status: 'RECEIVED', amount };
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }
}

module.exports = {
  ProcurementError,
  cancelPurchaseOrder,
  cancelRequisition,
  closeSupplierRfq,
  createBillMatch,
  createPurchaseOrder,
  createPurchaseReturn,
  createRequisition,
  createSupplierRfq,
  inspectReceipt,
  listWorkspace,
  receiveGoods,
  recordCreditNote,
  recordSupplierResponse,
  submitPurchaseOrder,
  submitRequisition
};
