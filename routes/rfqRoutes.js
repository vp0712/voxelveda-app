const express = require('express');
const router = express.Router();

const rfqController = require('../controllers/rfqController');
const requireInputPermission = require('../middleware/inputPermissionMiddleware');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');

router.get('/', requireAnyPermission('VIEW_RFQS'), rfqController.getRFQs);
router.post('/', requireInputPermission('EDIT_RFQS'), rfqController.createRFQ);
router.post('/approve', requireInputPermission('EDIT_RFQS'), rfqController.approveRFQ);
router.post('/reject', requireInputPermission('EDIT_RFQS'), rfqController.rejectRFQ);
router.post('/close', requireInputPermission('EDIT_RFQS'), rfqController.closeRFQ);
router.get('/:id', requireAnyPermission('VIEW_RFQS'), rfqController.getRFQ);
router.put('/:id', requireInputPermission('EDIT_RFQS'), rfqController.updateRFQ);
router.post('/:id/archive', requireInputPermission('EDIT_RFQS'), rfqController.archiveRFQ);
router.post('/:id/restore', requireInputPermission('EDIT_RFQS'), rfqController.restoreRFQ);

module.exports = router;
