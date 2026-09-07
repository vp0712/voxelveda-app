const express = require('express');
const controller = require('../controllers/operationalTrustController');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const requireStepUp = require('../middleware/stepUpMiddleware');
const { rateLimit } = require('../middleware/securityMiddleware');
const { bodyContract } = require('../middleware/requestContractMiddleware');

const router = express.Router();
const readLimit = rateLimit({ windowMs: 60 * 1000, max: 120, keyPrefix: 'operational-trust-read' });
const actionLimit = rateLimit({ windowMs: 60 * 1000, max: 20, keyPrefix: 'operational-trust-action' });

router.get('/summary', requireAnyPermission('MANAGE_SECURITY'), readLimit, controller.summary);
router.get('/catalog', requireAnyPermission('MANAGE_SECURITY'), readLimit, controller.catalog);

router.get('/api-tokens', requireAnyPermission('MANAGE_API_TOKENS'), readLimit, controller.listApiTokens);
router.post('/api-tokens', requireAnyPermission('MANAGE_API_TOKENS'), actionLimit, requireStepUp('CREATE_SCOPED_API_TOKEN'), bodyContract(['user_id','name','scopes','expires_at'], { required: ['name','scopes','expires_at'] }), controller.createApiToken);
router.post('/api-tokens/:id/revoke', requireAnyPermission('MANAGE_API_TOKENS'), actionLimit, requireStepUp('REVOKE_API_TOKEN'), bodyContract(['reason'], { required: ['reason'] }), controller.revokeApiToken);

router.get('/webhooks', requireAnyPermission('MANAGE_WEBHOOKS'), readLimit, controller.listWebhooks);
router.post('/webhooks', requireAnyPermission('MANAGE_WEBHOOKS'), actionLimit, requireStepUp('CHANGE_WEBHOOK_POLICY'), bodyContract(['source_key','display_name','allowed_events','active'], { required: ['source_key','display_name','allowed_events'] }), controller.upsertWebhookSource);

router.post('/retention/policies', requireAnyPermission('MANAGE_DATA_RETENTION'), actionLimit, requireStepUp('CHANGE_RETENTION_POLICY'), bodyContract(['data_category','retention_days','legal_basis','active'], { required: ['data_category','retention_days','legal_basis'] }), controller.saveRetentionPolicy);
router.post('/retention/:category/preview', requireAnyPermission('MANAGE_DATA_RETENTION'), actionLimit, bodyContract(['reason']), controller.previewRetention);
router.post('/retention/holds', requireAnyPermission('MANAGE_DATA_RETENTION'), actionLimit, requireStepUp('CREATE_RETENTION_HOLD'), bodyContract(['scope_type','scope_id','reason'], { required: ['scope_type','scope_id','reason'] }), controller.createRetentionHold);

router.post('/exports', requireAnyPermission('AUTHORISE_SENSITIVE_EXPORT'), actionLimit, requireStepUp('REQUEST_SENSITIVE_EXPORT'), bodyContract(['export_type','reason','parameters'], { required: ['export_type','reason'] }), controller.requestExport);
router.get('/exports', requireAnyPermission('AUTHORISE_SENSITIVE_EXPORT'), readLimit, controller.listExports);
router.post('/exports/:id/approve', requireAnyPermission('AUTHORISE_SENSITIVE_EXPORT'), actionLimit, requireStepUp('APPROVE_SENSITIVE_EXPORT'), bodyContract(['reason','confirmation'], { required: ['reason','confirmation'] }), controller.approveExport);

router.post('/secrets/inventory', requireAnyPermission('MANAGE_SECRET_ROTATION'), actionLimit, requireStepUp('RECORD_SECRET_ROTATION'), bodyContract(['secret_name','purpose','key_version','rotate_after_days'], { required: ['secret_name','purpose'] }), controller.upsertSecretInventory);
router.post('/backups/attestations', requireAnyPermission('MANAGE_BACKUP_ATTESTATIONS'), actionLimit, requireStepUp('ATTEST_BACKUP'), bodyContract(['provider','backup_reference','notes','backup_completed_at','restore_tested_at','status','confirmation'], { required: ['provider','backup_reference','notes','backup_completed_at','status'] }), controller.recordBackupAttestation);
router.post('/documents/:id/quarantine', requireAnyPermission('MANAGE_MALWARE_QUARANTINE'), actionLimit, requireStepUp('QUARANTINE_DOCUMENT'), bodyContract(['reason'], { required: ['reason'] }), controller.quarantineDocument);
router.post('/alerts/rules', requireAnyPermission('MANAGE_SECURITY_ALERTS'), actionLimit, requireStepUp('CHANGE_SECURITY_ALERT_RULE'), bodyContract(['rule_key','display_name','severity','event_types','threshold_count','window_minutes','active'], { required: ['rule_key','display_name','severity','event_types','threshold_count','window_minutes'] }), controller.saveAlertRule);

router.get('/trusted-devices', requireAnyPermission('MANAGE_SECURITY'), readLimit, controller.listTrustedDevices);
router.post('/trusted-devices/:id/revoke', requireAnyPermission('MANAGE_SECURITY'), actionLimit, requireStepUp('REVOKE_TRUSTED_DEVICE'), bodyContract(['reason'], { required: ['reason'] }), controller.revokeTrustedDevice);
router.post('/ai/evaluate', requireAnyPermission('MANAGE_AI_SECURITY'), actionLimit, bodyContract(['action','payload'], { required: ['action'] }), controller.evaluateAiRequest);
router.post('/evidence/snapshots', requireAnyPermission('VIEW_SECURITY_EVIDENCE'), actionLimit, requireStepUp('CREATE_SECURITY_EVIDENCE'), bodyContract(['days']), controller.createEvidenceSnapshot);

module.exports = router;
