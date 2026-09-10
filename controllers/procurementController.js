const procurement = require('../services/procurementService');
const { WorkflowError } = require('../services/workflowService');

function respondError(res, error) {
  if (error instanceof procurement.ProcurementError || error instanceof WorkflowError) {
    return res.status(error.statusCode || 400).json({ message: error.message, code: error.code, details: error.details || undefined });
  }
  if (error?.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ message: 'This procurement record already exists', code: 'PROCUREMENT_DUPLICATE' });
  }
  console.error('PROCUREMENT API ERROR:', error);
  return res.status(500).json({ message: 'Procurement operation failed', code: 'PROCUREMENT_INTERNAL_ERROR' });
}

function handler(service, key, message, status = 200, map = (req) => ({ user: req.user, input: req.body, req })) {
  return async (req, res) => {
    try {
      const record = await service(map(req));
      return res.status(status).json({ message: typeof message === 'function' ? message(record) : message, [key]: record });
    } catch (error) { return respondError(res, error); }
  };
}

exports.workspace = async (_req, res) => {
  try { return res.json(await procurement.listWorkspace()); }
  catch (error) { return respondError(res, error); }
};
exports.createRequisition = handler(procurement.createRequisition, 'requisition', 'Purchase requisition saved', 201);
exports.submitRequisition = handler(procurement.submitRequisition, 'requisition', 'Purchase requisition submitted for approval', 200,
  (req) => ({ id: Number(req.params.id), user: req.user, req }));
exports.cancelRequisition = handler(procurement.cancelRequisition, 'requisition', 'Purchase requisition cancelled', 200,
  (req) => ({ id: Number(req.params.id), reason: req.body.reason, user: req.user, req }));
exports.createSupplierRfq = handler(procurement.createSupplierRfq, 'supplier_rfq', 'Supplier RFQ issued', 201);
exports.recordSupplierResponse = handler(procurement.recordSupplierResponse, 'supplier_rfq', 'Supplier quote recorded', 200,
  (req) => ({ rfqId: Number(req.params.id), user: req.user, input: req.body, req }));
exports.closeSupplierRfq = handler(procurement.closeSupplierRfq, 'supplier_rfq',
  (record) => record.status === 'AWARDED' ? 'Supplier selected and RFQ awarded' : 'Supplier RFQ closed', 200,
  (req) => ({ rfqId: Number(req.params.id), user: req.user, input: req.body, req }));
exports.createPurchaseOrder = handler(procurement.createPurchaseOrder, 'purchase_order', 'Purchase order draft saved', 201);
exports.submitPurchaseOrder = handler(procurement.submitPurchaseOrder, 'purchase_order', 'Purchase order submitted for approval', 200,
  (req) => ({ id: Number(req.params.id), user: req.user, req }));
exports.cancelPurchaseOrder = handler(procurement.cancelPurchaseOrder, 'purchase_order', 'Purchase order cancelled', 200,
  (req) => ({ id: Number(req.params.id), reason: req.body.reason, user: req.user, req }));
exports.receiveGoods = handler(procurement.receiveGoods, 'receipt', 'Goods receipt recorded and sent for inspection', 201);
exports.inspectReceipt = handler(procurement.inspectReceipt, 'inspection', 'Receiving inspection completed', 201,
  (req) => ({ receiptId: Number(req.params.id), user: req.user, input: req.body, req }));
exports.createBillMatch = handler(procurement.createBillMatch, 'match',
  (record) => record.status === 'MATCHED' ? 'Supplier bill matched and sent for finance approval' : 'Supplier bill saved on hold with a match exception', 201);
exports.createReturn = handler(procurement.createPurchaseReturn, 'return', 'Purchase return recorded', 201);
exports.recordCreditNote = handler(procurement.recordCreditNote, 'credit_note', 'Supplier credit note recorded', 201,
  (req) => ({ returnId: Number(req.params.id), user: req.user, input: req.body, req }));
