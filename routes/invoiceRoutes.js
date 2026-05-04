const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const invoiceController = require('../controllers/invoiceController');

router.post('/', authMiddleware, invoiceController.createInvoice);
router.get('/', authMiddleware, invoiceController.getInvoices);
router.get('/:id/pdf', authMiddleware, invoiceController.viewInvoicePdf);

module.exports = router;