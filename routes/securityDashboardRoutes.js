const express = require('express');
const controller = require('../controllers/securityDashboardController');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const { rateLimit } = require('../middleware/securityMiddleware');

const router = express.Router();
const securityReadLimit = rateLimit({ windowMs: 60 * 1000, max: 120, keyPrefix: 'security-read' });

router.get('/dashboard', requireAnyPermission('MANAGE_SECURITY'), securityReadLimit, controller.dashboard);
router.get('/issues', requireAnyPermission('MANAGE_SECURITY'), securityReadLimit, controller.issues);
router.get('/events', requireAnyPermission('VIEW_AUDIT_LOG', 'MANAGE_SECURITY'), securityReadLimit, controller.events);
router.get('/audit', requireAnyPermission('VIEW_AUDIT_LOG', 'MANAGE_SECURITY'), securityReadLimit, controller.audit);
router.get('/privileged', requireAnyPermission('MANAGE_SECURITY'), securityReadLimit, controller.privileged);

module.exports = router;
