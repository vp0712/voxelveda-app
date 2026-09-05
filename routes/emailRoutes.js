const express = require('express');
const controller = require('../controllers/emailController');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');

const router = express.Router();
router.use(requireAnyPermission('MANAGE_COMPANY_EMAIL'));

router.get('/config', controller.config);
router.post('/verify', controller.verify);
router.post('/test', controller.sendTest);
router.get('/queue', controller.queue);
router.get('/logs', controller.logs);
router.get('/templates', controller.templates);
router.post('/process', controller.process);
router.post('/queue/:id/retry', controller.retry);

module.exports = router;
