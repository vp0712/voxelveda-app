const express = require('express');
const controller = require('../controllers/vomWhatsAppController');
const { rateLimit } = require('../middleware/securityMiddleware');

const router = express.Router();
const webhookLimit = rateLimit({ windowMs: 60 * 1000, max: 240, keyPrefix: 'vom-whatsapp-webhook' });

router.get('/', webhookLimit, controller.verify);
router.post('/', webhookLimit, controller.receive);

module.exports = router;
