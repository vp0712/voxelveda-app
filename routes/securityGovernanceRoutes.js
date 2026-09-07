const express = require('express');
const controller = require('../controllers/securityGovernanceController');
const enterpriseControlPlaneRoutes = require('./enterpriseControlPlaneRoutes');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const { bodyContract } = require('../middleware/requestContractMiddleware');
const { rateLimit } = require('../middleware/securityMiddleware');
const requireStepUp = require('../middleware/stepUpMiddleware');

const router = express.Router();
const readLimit = rateLimit({ windowMs: 60000, max: 90, keyPrefix: 'governance-read' });
const actionLimit = rateLimit({ windowMs: 60000, max: 10, keyPrefix: 'governance-action' });
const action = (permission, name, fields, required = []) => [
  requireAnyPermission(permission), actionLimit, requireStepUp(name), bodyContract(fields, { required })
];

router.get('/summary', requireAnyPermission('VIEW_SECURITY_GOVERNANCE'), readLimit, controller.summary);
router.get('/catalog', requireAnyPermission('VIEW_SECURITY_GOVERNANCE'), readLimit, controller.catalog);
router.get('/audit-integrity/verify', requireAnyPermission('VIEW_AUDIT_LOG'), actionLimit, requireStepUp('VERIFY_AUDIT_INTEGRITY'), controller.verifyAuditIntegrity);
router.post('/break-glass', ...action('MANAGE_BREAK_GLASS', 'REQUEST_BREAK_GLASS', ['beneficiary_user_id','permissions','incident_reference','reason','duration_minutes'], ['beneficiary_user_id','permissions','incident_reference','reason']), controller.requestBreakGlass);
router.post('/break-glass/:id/approve', ...action('MANAGE_BREAK_GLASS', 'APPROVE_BREAK_GLASS', ['approval_reason','confirmation'], ['approval_reason','confirmation']), controller.approveBreakGlass);
router.post('/break-glass/:id/revoke', ...action('MANAGE_BREAK_GLASS', 'REVOKE_BREAK_GLASS', ['reason'], ['reason']), controller.revokeBreakGlass);
router.post('/impersonation', ...action('USE_SUPPORT_IMPERSONATION', 'START_SUPPORT_IMPERSONATION', ['target_user_id','reason','duration_minutes'], ['target_user_id','reason']), controller.startImpersonation);
router.post('/impersonation/:id/end', ...action('USE_SUPPORT_IMPERSONATION', 'END_SUPPORT_IMPERSONATION', ['reason'], ['reason']), controller.endImpersonation);
router.post('/database-attestations', ...action('ATTEST_DATABASE_SECURITY', 'ATTEST_DATABASE_SECURITY', ['database_identity','privilege_scope','tls_in_use','least_privilege_verified','provider_evidence_reference','status','valid_for_days'], ['database_identity','privilege_scope','tls_in_use','least_privilege_verified','provider_evidence_reference','status']), controller.attestDatabaseSecurity);

// Enterprise phases 71-140. Authentication is already enforced at /api/security/governance.
router.use('/enterprise', enterpriseControlPlaneRoutes);

module.exports = router;
