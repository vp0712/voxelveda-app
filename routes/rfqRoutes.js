const express = require('express');
const router = express.Router();

const rfqController = require('../controllers/rfqController');
const requireInputPermission = require('../middleware/inputPermissionMiddleware');

router.get('/', rfqController.getRFQs);
router.post('/', requireInputPermission('rfqs_input'), rfqController.createRFQ);
router.post('/approve', requireInputPermission('rfqs_input'), rfqController.approveRFQ);
router.post('/reject', requireInputPermission('rfqs_input'), rfqController.rejectRFQ);
router.post('/close', requireInputPermission('rfqs_input'), rfqController.closeRFQ);

module.exports = router;
