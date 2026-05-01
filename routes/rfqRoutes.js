const express = require('express');
const {
  createRFQ,
  getRFQs,
  approveRFQ,
  rejectRFQ
} = require('../controllers/rfqController');

const authMiddleware = require('../middleware/authMiddleware');
const requireRole = require('../middleware/roleMiddleware');

const router = express.Router();

router.post('/', createRFQ);

router.get(
  '/',
  authMiddleware,
  requireRole('admin', 'sales', 'production', 'viewer', 'staff'),
  getRFQs
);

router.post(
  '/approve',
  authMiddleware,
  requireRole('admin', 'sales'),
  approveRFQ
);

router.post(
  '/reject',
  authMiddleware,
  requireRole('admin', 'sales'),
  rejectRFQ
);

module.exports = router;