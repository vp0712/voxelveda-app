const express = require('express');
const router = express.Router();

const invoiceController = require('../controllers/invoiceController');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const requireStepUp = require('../middleware/stepUpMiddleware');

/* ================= GET ================= */

router.get('/', invoiceController.getInvoices);

router.get('/statement/search', invoiceController.searchCustomerStatements);
router.get('/statement/pdf', invoiceController.viewCustomerStatementPdf);
router.post('/statement/send', requireAnyPermission('SEND_COMPANY_EMAIL'), invoiceController.sendCustomerStatement);

router.get('/:id', invoiceController.getInvoiceDetails);

/* ================= CREATE ================= */

router.post('/', requireAnyPermission('EDIT_FINANCE'), invoiceController.createInvoice);

/* ================= MANUAL INVOICE ================= */

router.post('/manual', requireAnyPermission('EDIT_FINANCE'), invoiceController.createManualInvoice);

/* ================= STATUS ACTIONS ================= */

router.post('/approve', requireAnyPermission('POST_TRANSACTION'), requireStepUp('APPROVE_INVOICE'), invoiceController.approveInvoice);

router.post('/send', requireAnyPermission('EDIT_FINANCE'), invoiceController.sendInvoice);

router.post('/paid', requireAnyPermission('POST_TRANSACTION'), requireStepUp('MARK_INVOICE_PAID'), invoiceController.markInvoicePaid);

router.post('/payment', requireAnyPermission('POST_TRANSACTION'), requireStepUp('RECORD_INVOICE_PAYMENT'), invoiceController.recordInvoicePayment);

router.post('/payment/delete', requireAnyPermission('VOID_TRANSACTION'), requireStepUp('VOID_INVOICE_PAYMENT'), invoiceController.deleteInvoicePayment);

router.post('/reject', requireAnyPermission('VOID_TRANSACTION'), requireStepUp('REJECT_INVOICE'), invoiceController.rejectInvoice);

router.post('/delete', requireAnyPermission('VOID_TRANSACTION'), requireStepUp('DELETE_INVOICE'), invoiceController.deleteInvoice);

router.post('/edit', requireAnyPermission('EDIT_FINANCE'), invoiceController.editInvoice);

/* ================= PDF ================= */

router.get('/:id/pdf', invoiceController.viewInvoicePdf);

module.exports = router;
