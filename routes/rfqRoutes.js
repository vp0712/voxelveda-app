const express = require('express');
const router = express.Router();

const rfqController = require('../controllers/rfqController');

router.get('/', rfqController.getRFQs);
router.post('/', rfqController.createRFQ);
router.post('/approve', rfqController.approveRFQ);
router.post('/reject', rfqController.rejectRFQ);
router.post('/close', rfqController.closeRFQ);

module.exports = router;