const express = require('express');
const controller = require('../controllers/integrationWebhookController');
const { rateLimit } = require('../middleware/securityMiddleware');

const router = express.Router();
router.post('/:source', rateLimit({ windowMs: 60 * 1000, max: 120, keyPrefix: 'signed-webhook' }), controller.receive);

module.exports = router;
