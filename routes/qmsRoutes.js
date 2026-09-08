const express = require('express');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const { requireStepUp } = require('../middleware/stepUpMiddleware');
const qmsTransitionValidation = require('../middleware/qmsTransitionValidationMiddleware');
const controller = require('../controllers/qmsRecordController');
const ops = require('../controllers/qmsOperationsController');

const router = express.Router();
const viewQms = requireAnyPermission('VIEW_QMS', 'VIEW_COMPLIANCE');
const editQms = requireAnyPermission('CREATE_QMS_RECORD', 'EDIT_QMS_RECORD', 'MANAGE_QMS', 'EDIT_COMPLIANCE');
const reviewQms = requireAnyPermission('REVIEW_QMS', 'APPROVE_QMS', 'MANAGE_QMS', 'EDIT_COMPLIANCE');

router.use(viewQms);

router.get('/dashboard', ops.dashboard);
router.get('/definitions', ops.listDefinitions);
router.put('/definitions', requireAnyPermission('MANAGE_QMS', 'MANAGE_DOCUMENT_CONTROL', 'EDIT_COMPLIANCE'), requireStepUp('qms:publish-form-definition'), ops.upsertDefinition);
router.post('/validate', ops.validateValues);

router.get('/records', controller.listRecords);
router.get('/records/:id', controller.getRecord);
router.post('/records', editQms, controller.createRecord);
router.put('/records/:id', editQms, controller.updateRecord);
router.post('/records/import-legacy', editQms, requireStepUp('qms:legacy-import'), ops.importLegacy);
router.post('/records/:id/transition', reviewQms, qmsTransitionValidation, (req, res, next) => {
  const target = String(req.body?.status || '').toUpperCase();
  if (['APPROVED','CLOSED','VOID','SUPERSEDED'].includes(target)) {
    return requireStepUp(`qms:${target.toLowerCase()}`)(req, res, next);
  }
  return next();
}, controller.transition);

router.get('/holds', ops.listHolds);
router.post('/holds', requireAnyPermission('MANAGE_QMS', 'MANAGE_NCR', 'QUALITY_RELEASE', 'EDIT_COMPLIANCE'), ops.placeHold);
router.post('/holds/:id/release', requireAnyPermission('QUALITY_RELEASE', 'MANAGE_QMS', 'EDIT_COMPLIANCE'), requireStepUp('qms:release-quality-hold'), ops.releaseHold);

router.get('/ncrs', ops.listNcrs);
router.post('/ncrs', requireAnyPermission('MANAGE_NCR', 'MANAGE_QMS', 'EDIT_COMPLIANCE'), ops.createNcr);
router.post('/ncrs/:id/transition', requireAnyPermission('MANAGE_NCR', 'MANAGE_QMS', 'EDIT_COMPLIANCE'), (req,res,next) => {
  const target = String(req.body?.status || '').toUpperCase();
  if (['APPROVAL','CLOSED'].includes(target)) return requireStepUp(`qms:ncr-${target.toLowerCase()}`)(req,res,next);
  return next();
}, ops.transitionNcr);

router.get('/capas', ops.listCapas);
router.post('/capas', requireAnyPermission('MANAGE_CAPA', 'MANAGE_QMS', 'EDIT_COMPLIANCE'), ops.createCapa);
router.post('/capas/:id/actions', requireAnyPermission('MANAGE_CAPA', 'MANAGE_QMS', 'EDIT_COMPLIANCE'), ops.addCapaAction);

router.get('/trace/material/:id', ops.genealogyByMaterial);
router.get('/trace/serial/:id', ops.genealogyBySerial);
router.get('/gates/machine/:id', ops.machineGate);
router.post('/gates/operator', ops.operatorGate);
router.get('/gates/calibration/:id', ops.calibrationGate);
router.get('/gates/release/:id', ops.releaseGate);

module.exports = router;
