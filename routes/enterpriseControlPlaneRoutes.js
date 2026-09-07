const express = require('express');
const controller = require('../controllers/enterpriseControlPlaneController');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const requireStepUp = require('../middleware/stepUpMiddleware');
const enterpriseMutationGuard = require('../middleware/enterpriseMutationGuard');
const { rateLimit } = require('../middleware/securityMiddleware');
const { bodyContract } = require('../middleware/requestContractMiddleware');

const router = express.Router();
const readLimit = rateLimit({ windowMs: 60000, max: 90, keyPrefix: 'enterprise-control-read' });
const writeLimit = rateLimit({ windowMs: 60000, max: 12, keyPrefix: 'enterprise-control-write' });

const write = (action, fields, required) => [
  requireAnyPermission('MANAGE_SECURITY'),
  writeLimit,
  requireStepUp(action),
  bodyContract([...fields, 'emergency_reason'], { required }),
  enterpriseMutationGuard
];

router.get('/summary', requireAnyPermission('VIEW_SECURITY_GOVERNANCE'), readLimit, controller.summary);
router.get('/risk/current', requireAnyPermission('VIEW_SECURITY_GOVERNANCE'), readLimit, controller.currentRisk);

router.post('/evidence', ...write('RECORD_CONTROL_EVIDENCE',
  ['control_key','evidence_type','evidence_reference','verification_status','valid_for_days','notes'],
  ['control_key','evidence_type','evidence_reference']), controller.createEvidence);

router.post('/changes', ...write('CREATE_CONTROLLED_CHANGE',
  ['title','change_type','risk_level','description','rollback_plan','validation_plan'],
  ['title','risk_level','description','rollback_plan','validation_plan']), controller.createChange);

router.post('/changes/:id/approve', ...write('APPROVE_CONTROLLED_CHANGE',
  ['confirmation'], ['confirmation']), controller.approveChange);

router.post('/resilience-drills', ...write('RECORD_RESILIENCE_DRILL',
  ['drill_type','scenario','recovery_time_minutes','recovery_point_minutes','result_status','evidence_reference','lessons_learned','next_due_days'],
  ['drill_type','scenario','result_status']), controller.recordDrill);

router.post('/vendor-risk', ...write('RECORD_VENDOR_RISK',
  ['vendor_name','service_scope','data_access_level','criticality','risk_score','status','evidence_reference','owner_user_id','review_days'],
  ['vendor_name','service_scope','criticality','risk_score','status']), controller.recordVendorAssessment);

router.put('/ai-policies', ...write('UPDATE_AI_ACTION_POLICY',
  ['action_key','autonomy_level','max_risk_score','requires_human_approval','requires_step_up','blocked','policy_reason'],
  ['action_key','policy_reason']), controller.upsertAiPolicy);

router.post('/manufacturing-trace', ...write('RECORD_MANUFACTURING_TRACE',
  ['job_reference','batch_reference','event_type','asset_reference','material_lot','quality_status','event_payload'],
  ['job_reference','event_type']), controller.recordTrace);

module.exports = router;
