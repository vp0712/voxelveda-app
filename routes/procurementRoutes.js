const express = require('express');
const controller = require('../controllers/procurementController');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const { bodyContract } = require('../middleware/requestContractMiddleware');
const requireStepUp = require('../middleware/stepUpMiddleware');

const router = express.Router();

router.get('/workspace', requireAnyPermission('VIEW_PROCUREMENT'), controller.workspace);
router.post('/requisitions', requireAnyPermission('CREATE_PURCHASE_REQUISITION'), bodyContract(
  ['title', 'department', 'required_date', 'business_reason', 'currency', 'items'], { required: ['title', 'items'] }
), controller.createRequisition);
router.post('/requisitions/:id/submit', requireAnyPermission('CREATE_PURCHASE_REQUISITION'), bodyContract([], { allowEmpty: true }), controller.submitRequisition);
router.post('/requisitions/:id/cancel', requireAnyPermission('CREATE_PURCHASE_REQUISITION'), bodyContract(['reason'], { required: ['reason'] }), controller.cancelRequisition);
router.post('/supplier-rfqs', requireAnyPermission('MANAGE_SUPPLIER_RFQ'), bodyContract(
  ['purchase_requisition_id', 'supplier_ids', 'title', 'issue_date', 'response_due_date', 'notes'], { required: ['purchase_requisition_id', 'supplier_ids'] }
), controller.createSupplierRfq);
router.post('/supplier-rfqs/:id/respond', requireAnyPermission('MANAGE_SUPPLIER_RFQ'), bodyContract(
  ['supplier_id', 'quote_reference', 'quoted_total', 'lead_time_days', 'response_notes'], { required: ['supplier_id', 'quoted_total'] }
), controller.recordSupplierResponse);
router.post('/supplier-rfqs/:id/close', requireAnyPermission('MANAGE_SUPPLIER_RFQ'), bodyContract(
  ['selected_supplier_id', 'close_reason'], { allowEmpty: true }
), controller.closeSupplierRfq);
router.post('/purchase-orders', requireAnyPermission('CREATE_PURCHASE_ORDER'), bodyContract(
  ['purchase_requisition_id', 'supplier_rfq_id', 'supplier_id', 'currency', 'issue_date', 'expected_date', 'payment_terms', 'delivery_address', 'notes', 'items'],
  { required: ['purchase_requisition_id', 'supplier_id', 'items'] }
), controller.createPurchaseOrder);
router.post('/purchase-orders/:id/submit', requireAnyPermission('CREATE_PURCHASE_ORDER'), bodyContract([], { allowEmpty: true }), controller.submitPurchaseOrder);
router.post('/purchase-orders/:id/cancel', requireAnyPermission('CREATE_PURCHASE_ORDER'), bodyContract(['reason'], { required: ['reason'] }), controller.cancelPurchaseOrder);
router.post('/goods-receipts', requireAnyPermission('RECEIVE_PURCHASE_ORDER'), bodyContract(
  ['purchase_order_id', 'received_date', 'delivery_reference', 'notes', 'items'], { required: ['purchase_order_id', 'items'] }
), controller.receiveGoods);
router.post('/goods-receipts/:id/inspect', requireAnyPermission('INSPECT_GOODS_RECEIPT'), bodyContract(
  ['result', 'accepted_quantity', 'rejected_quantity', 'nonconformance_reference', 'notes'],
  { required: ['result', 'accepted_quantity', 'rejected_quantity'] }
), controller.inspectReceipt);
router.post('/bill-matches', requireAnyPermission('MANAGE_SUPPLIER_BILL_MATCH'), bodyContract(
  ['purchase_order_id', 'goods_receipt_id', 'supplier_invoice_no', 'issue_date', 'due_date', 'bill_total', 'tolerance_amount', 'exception_reason'],
  { required: ['purchase_order_id', 'goods_receipt_id', 'supplier_invoice_no', 'bill_total'] }
), controller.createBillMatch);
router.post('/returns', requireAnyPermission('MANAGE_PURCHASE_RETURNS'), bodyContract(
  ['purchase_order_id', 'goods_receipt_id', 'return_date', 'reason', 'items'], { required: ['purchase_order_id', 'goods_receipt_id', 'reason', 'items'] }
), controller.createReturn);
router.post('/returns/:id/credit-note', requireAnyPermission('MANAGE_PURCHASE_RETURNS'), requireStepUp('RECORD_SUPPLIER_CREDIT'), bodyContract(
  ['supplier_credit_reference', 'issue_date', 'amount', 'notes'], { required: ['supplier_credit_reference', 'amount'] }
), controller.recordCreditNote);

module.exports = router;
