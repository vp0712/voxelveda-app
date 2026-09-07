const express = require('express');
const controller = require('../controllers/securityIncidentController');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const requireStepUp = require('../middleware/stepUpMiddleware');
const { rateLimit } = require('../middleware/securityMiddleware');
const { bodyContract } = require('../middleware/requestContractMiddleware');

const router = express.Router();
const readLimit = rateLimit({ windowMs: 60 * 1000, max: 120, keyPrefix: 'incident-read' });
const actionLimit = rateLimit({ windowMs: 60 * 1000, max: 20, keyPrefix: 'incident-action' });

router.get('/incidents', requireAnyPermission('MANAGE_SECURITY_INCIDENTS', 'MANAGE_SECURITY'), readLimit, controller.list);
router.get('/incidents/:id', requireAnyPermission('MANAGE_SECURITY_INCIDENTS', 'MANAGE_SECURITY'), readLimit, controller.detail);
router.post('/incidents', requireAnyPermission('MANAGE_SECURITY_INCIDENTS'), actionLimit, requireStepUp('OPEN_SECURITY_INCIDENT'), bodyContract(['title','summary','severity','scope'], { required: ['title','summary','severity'] }), controller.create);
router.post('/incidents/:id/notes', requireAnyPermission('MANAGE_SECURITY_INCIDENTS'), actionLimit, bodyContract(['note'], { required: ['note'] }), controller.addNote);
router.post('/incidents/:id/contain-user', requireAnyPermission('MANAGE_SECURITY_INCIDENTS'), actionLimit, requireStepUp('CONTAIN_COMPROMISED_ACCOUNT'), bodyContract(['target_user_id','reason'], { required: ['target_user_id','reason'] }), controller.containUser);
router.post('/incidents/:id/prepare-recovery', requireAnyPermission('MANAGE_SECURITY_INCIDENTS'), actionLimit, requireStepUp('INITIATE_ACCOUNT_RECOVERY'), bodyContract(['target_user_id','reason'], { required: ['target_user_id','reason'] }), controller.prepareRecovery);
router.post('/incidents/:id/status', requireAnyPermission('MANAGE_SECURITY_INCIDENTS'), actionLimit, requireStepUp('CHANGE_SECURITY_INCIDENT_STATUS'), bodyContract(['status','reason'], { required: ['status','reason'] }), controller.updateStatus);
router.post('/emergency/revoke-all-sessions', requireAnyPermission('REVOKE_ORGANISATION_SESSIONS'), actionLimit, requireStepUp('REVOKE_ORGANISATION_SESSIONS'), bodyContract(['incident_id','reason','confirmation'], { required: ['incident_id','reason','confirmation'] }), controller.revokeOrganisationSessions);
router.get('/report', requireAnyPermission('VIEW_AUDIT_LOG', 'EXPORT_SECURITY_REPORT'), readLimit, controller.report);
router.get('/report.csv', requireAnyPermission('EXPORT_SECURITY_REPORT'), actionLimit, requireStepUp('EXPORT_SECURITY_REPORT'), controller.exportReport);

module.exports = router;
