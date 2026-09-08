const express = require('express');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const requireStepUp = require('../middleware/stepUpMiddleware');
const qmsTransitionValidation = require('../middleware/qmsTransitionValidationMiddleware');
const controller = require('../controllers/qms/recordController');
const ops = require('../controllers/qmsOperationsController');
const inspections = require('../controllers/qms/inspectionController');
const release = require('../controllers/qms/qualityReleaseController');
const governance = require('../controllers/qms/governanceController');
const enterpriseRoutes = require('./qmsEnterpriseRoutes');

const router = express.Router();
const viewQms = requireAnyPermission('VIEW_QMS', 'VIEW_COMPLIANCE');
const editQms = requireAnyPermission('CREATE_QMS_RECORD', 'EDIT_QMS_RECORD', 'MANAGE_QMS', 'EDIT_COMPLIANCE');
const reviewQms = requireAnyPermission('REVIEW_QMS', 'APPROVE_QMS', 'MANAGE_QMS', 'EDIT_COMPLIANCE');

router.use(viewQms);
router.use('/enterprise', enterpriseRoutes);

router.get('/dashboard', ops.dashboard);
router.get('/definitions', ops.listDefinitions);
router.put('/definitions', requireAnyPermission('MANAGE_QMS', 'MANAGE_DOCUMENT_CONTROL', 'EDIT_COMPLIANCE'), requireStepUp('qms:publish-form-definition'), ops.upsertDefinition);
router.post('/validate', ops.validateValues);

router.get('/records', controller.listRecords);
router.get('/records/:id', controller.getRecord);
router.post('/records', editQms, controller.createRecord);
router.put('/records/:id', editQms, controller.updateRecord);
router.post('/records/import-legacy', editQms, requireStepUp('qms:legacy-import'), ops.importLegacy);
router.post('/records/:id/comments', editQms, controller.addComment);
router.post('/records/:id/holds', requireAnyPermission('MANAGE_QMS', 'MANAGE_NCR', 'QUALITY_RELEASE', 'EDIT_COMPLIANCE'), controller.addRecordHold);
router.post('/records/:id/holds/:holdId/release', requireAnyPermission('QUALITY_RELEASE', 'MANAGE_QMS', 'EDIT_COMPLIANCE'), requireStepUp('qms:release-record-hold'), controller.releaseRecordHold);
router.post('/records/:id/transition', reviewQms, qmsTransitionValidation, (req, res, next) => {
  const target = String(req.body?.status || '').toUpperCase();
  if (['APPROVED','CLOSED','VOID','SUPERSEDED'].includes(target)) return requireStepUp(`qms:${target.toLowerCase()}`)(req, res, next);
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

router.get('/inspections/plans', inspections.listPlans);
router.post('/inspections/plans', requireAnyPermission('MANAGE_INSPECTIONS','MANAGE_QMS','EDIT_COMPLIANCE'), inspections.createPlan);
router.post('/inspections/plans/:id/characteristics', requireAnyPermission('MANAGE_INSPECTIONS','MANAGE_QMS','EDIT_COMPLIANCE'), inspections.addCharacteristic);
router.post('/inspections/plans/:id/approve', requireAnyPermission('MANAGE_INSPECTIONS','APPROVE_FAI','MANAGE_QMS','EDIT_COMPLIANCE'), requireStepUp('qms:approve-inspection-plan'), inspections.approvePlan);
router.post('/inspections/runs', requireAnyPermission('MANAGE_INSPECTIONS','MANAGE_QMS','EDIT_COMPLIANCE'), inspections.createRun);
router.get('/inspections/runs/:id', inspections.getRun);
router.post('/inspections/runs/:id/measurements', requireAnyPermission('MANAGE_INSPECTIONS','MANAGE_QMS','EDIT_COMPLIANCE'), inspections.recordMeasurement);
router.post('/inspections/runs/:id/complete', requireAnyPermission('MANAGE_INSPECTIONS','MANAGE_QMS','EDIT_COMPLIANCE'), inspections.completeRun);
router.post('/inspections/runs/:id/approve', requireAnyPermission('APPROVE_FAI','QUALITY_RELEASE','MANAGE_QMS','EDIT_COMPLIANCE'), requireStepUp('qms:approve-inspection'), inspections.approveRun);

router.get('/concessions', release.listConcessions);
router.post('/concessions', requireAnyPermission('APPROVE_CONCESSION','MANAGE_NCR','MANAGE_QMS','EDIT_COMPLIANCE'), release.createConcession);
router.post('/concessions/:id/approve', requireAnyPermission('APPROVE_CONCESSION','MANAGE_QMS','EDIT_COMPLIANCE'), requireStepUp('qms:approve-concession'), release.approveConcession);
router.post('/jobs/:id/release', requireAnyPermission('QUALITY_RELEASE','MANAGE_QMS','EDIT_COMPLIANCE'), requireStepUp('qms:final-product-release'), release.releaseJob);
router.get('/cocs', release.listCocs);
router.post('/cocs', requireAnyPermission('ISSUE_COC','QUALITY_RELEASE','MANAGE_QMS','EDIT_COMPLIANCE'), requireStepUp('qms:issue-coc'), release.issueCoc);
router.get('/cocs/:id/pdf', release.cocPdf);
router.get('/coc/:no/verify', release.verifyCoc);

router.get('/supplier-quality/:id', governance.supplierOverview);
router.post('/supplier-quality/:id/approval', requireAnyPermission('MANAGE_SUPPLIER_QUALITY','MANAGE_QMS','EDIT_COMPLIANCE'), requireStepUp('qms:supplier-approval'), governance.approveSupplier);
router.post('/supplier-quality/:id/events', requireAnyPermission('MANAGE_SUPPLIER_QUALITY','MANAGE_QMS','EDIT_COMPLIANCE'), governance.addSupplierEvent);
router.post('/supplier-quality/:id/scorecard', requireAnyPermission('MANAGE_SUPPLIER_QUALITY','MANAGE_QMS','EDIT_COMPLIANCE'), governance.generateSupplierScore);
router.post('/supplier-quality/:id/scars', requireAnyPermission('MANAGE_SUPPLIER_QUALITY','MANAGE_QMS','EDIT_COMPLIANCE'), governance.createScar);
router.post('/supplier-quality/scars/:id/transition', requireAnyPermission('MANAGE_SUPPLIER_QUALITY','MANAGE_QMS','EDIT_COMPLIANCE'), governance.transitionScar);

router.get('/documents', governance.listDocuments);
router.post('/documents', requireAnyPermission('MANAGE_DOCUMENT_CONTROL','MANAGE_QMS','EDIT_COMPLIANCE'), governance.createDocument);
router.post('/documents/:id/approve', requireAnyPermission('MANAGE_DOCUMENT_CONTROL','APPROVE_QMS','MANAGE_QMS','EDIT_COMPLIANCE'), requireStepUp('qms:approve-controlled-document'), governance.approveDocument);
router.post('/documents/:id/change-requests', requireAnyPermission('MANAGE_DOCUMENT_CONTROL','MANAGE_QMS','EDIT_COMPLIANCE'), governance.createDocumentChange);

router.get('/changes', governance.listChanges);
router.post('/changes', requireAnyPermission('MANAGE_QMS','MANAGE_DOCUMENT_CONTROL','EDIT_COMPLIANCE'), governance.createChange);
router.post('/changes/:id/transition', requireAnyPermission('MANAGE_QMS','MANAGE_DOCUMENT_CONTROL','EDIT_COMPLIANCE'), (req,res,next)=>{
  const target=String(req.body?.status||'').toUpperCase();
  if(['APPROVAL','IMPLEMENTED','VERIFIED','EFFECTIVE'].includes(target)) return requireStepUp(`qms:change-${target.toLowerCase()}`)(req,res,next);
  return next();
}, governance.transitionChange);

router.get('/trace/material/:id', ops.genealogyByMaterial);
router.get('/trace/serial/:id', ops.genealogyBySerial);
router.get('/gates/machine/:id', ops.machineGate);
router.post('/gates/operator', ops.operatorGate);
router.get('/gates/calibration/:id', ops.calibrationGate);
router.get('/gates/release/:id', ops.releaseGate);

module.exports = router;
