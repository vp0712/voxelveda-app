const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const requireRole = require('../middleware/roleMiddleware');

const {
  createInvoice,
  getInvoices,
  getInvoiceById,
  sendInvoice,
  approveInvoice,
  markInvoicePaid
} = require('../controllers/invoiceController');

const router = express.Router();

router.post(
  '/',
  authMiddleware,
  requireRole('admin', 'sales'),
  createInvoice
);

router.get(
  '/',
  authMiddleware,
  requireRole('admin', 'sales', 'production', 'viewer', 'staff'),
  getInvoices
);

router.get(
  '/:id',
  authMiddleware,
  requireRole('admin', 'sales', 'production', 'viewer', 'staff'),
  getInvoiceById
);

router.post(
  '/approve',
  authMiddleware,
  requireRole('admin', 'sales'),
  approveInvoice
);

router.post(
  '/send',
  authMiddleware,
  requireRole('admin', 'sales'),
  sendInvoice
);

router.post(
  '/paid',
  authMiddleware,
  requireRole('admin', 'sales'),
  markInvoicePaid
);

module.exports = router;