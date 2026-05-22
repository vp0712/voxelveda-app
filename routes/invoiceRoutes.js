const express = require('express');
const router = express.Router();

const invoiceController = require('../controllers/invoiceController');

/* ================= GET ================= */

router.get('/', invoiceController.getInvoices);
router.get('/:id', invoiceController.getInvoiceDetails);

/* ================= CREATE ================= */

router.post('/', invoiceController.createInvoice);

/* ================= MANUAL INVOICE ================= */

router.post('/manual', invoiceController.createManualInvoice);

/* ================= STATUS ACTIONS ================= */

router.post('/approve', invoiceController.approveInvoice);

router.post('/send', invoiceController.sendInvoice);

router.post('/paid', invoiceController.markInvoicePaid);

router.post('/reject', invoiceController.rejectInvoice);

router.post('/delete', invoiceController.deleteInvoice);

router.post('/edit', invoiceController.editInvoice);

/* ================= PDF ================= */

router.get('/:id/pdf', invoiceController.viewInvoicePdf);

module.exports = router;
