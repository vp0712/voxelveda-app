const express = require('express');
const requirePermission = require('../middleware/permissionMiddleware');
const requireInputPermission = require('../middleware/inputPermissionMiddleware');
const { requireStepUp } = require('../middleware/stepUpMiddleware');
const controller = require('../controllers/qmsRecordController');

const router = express.Router();

router.use(requirePermission('VIEW_COMPLIANCE'));
router.get('/records', controller.listRecords);
router.get('/records/:id', controller.getRecord);
router.post('/records', requireInputPermission('EDIT_COMPLIANCE'), controller.createRecord);
router.put('/records/:id', requireInputPermission('EDIT_COMPLIANCE'), controller.updateRecord);
router.post('/records/:id/transition', requireInputPermission('EDIT_COMPLIANCE'), (req, res, next) => {
  const target = String(req.body?.status || '').toUpperCase();
  if (['APPROVED','CLOSED','VOID','SUPERSEDED'].includes(target)) {
    return requireStepUp(`qms:${target.toLowerCase()}`)(req, res, next);
  }
  return next();
}, controller.transition);

module.exports = router;
