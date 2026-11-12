const express = require('express');
const controller = require('../controllers/emailController');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');

const router = express.Router();
// These report actions have per-source permissions and explicit recipient
// controls. They do not grant company-email administration to ordinary senders.
router.get('/reports/catalog', controller.reportCatalog);
router.post('/reports/prepare', controller.prepareReport);
router.get('/reports/:id/pdf', controller.reportPdf);
router.get('/reports/:id', controller.reportStatus);
router.post('/reports/:id/send', controller.sendReport);
router.get('/documents/:id/pdf', controller.documentPdf);
router.get('/documents/:id', controller.documentStatus);
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
