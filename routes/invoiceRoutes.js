const express = require('express');
const router = express.Router();

const invoiceController = require('../controllers/invoiceController');
const requireInputPermission = require('../middleware/inputPermissionMiddleware');

/* ================= GET ================= */

router.get('/', invoiceController.getInvoices);
router.get('/:id', invoiceController.getInvoiceDetails);

/* ================= CREATE ================= */

router.post('/', requireInputPermission('invoices_input'), invoiceController.createInvoice);

/* ================= MANUAL INVOICE ================= */

router.post('/manual', requireInputPermission('invoices_input'), invoiceController.createManualInvoice);

/* ================= STATUS ACTIONS ================= */

router.post('/approve', requireInputPermission('invoices_input'), invoiceController.approveInvoice);

router.post('/send', requireInputPermission('invoices_input'), invoiceController.sendInvoice);

router.post('/paid', requireInputPermission('invoices_input'), invoiceController.markInvoicePaid);

router.post('/payment', requireInputPermission('invoices_input'), invoiceController.recordInvoicePayment);

router.post('/payment/delete', requireInputPermission('invoices_input'), invoiceController.deleteInvoicePayment);

router.post('/reject', requireInputPermission('invoices_input'), invoiceController.rejectInvoice);

router.post('/delete', requireInputPermission('invoices_input'), invoiceController.deleteInvoice);

router.post('/edit', requireInputPermission('invoices_input'), invoiceController.editInvoice);

/* ================= PDF ================= */

router.get('/:id/pdf', invoiceController.viewInvoicePdf);

module.exports = router;
