const express = require('express');
const controller = require('../controllers/integrationWebhookController');
const { rateLimit } = require('../middleware/securityMiddleware');
const auth = require('../middleware/auth');
const advancedBankingRoutes = require('./advancedBankingRoutes');

const router = express.Router();

// Authenticated banking lifecycle API is mounted here to avoid changing the established finance router contract.
// The public signed-webhook receiver remains isolated below and still requires HMAC/replay protection.
router.use('/banking', auth, advancedBankingRoutes);
router.post('/:source', rateLimit({ windowMs: 60 * 1000, max: 120, keyPrefix: 'signed-webhook' }), controller.receive);

module.exports = router;
