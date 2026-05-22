const express = require('express');
const router = express.Router();
const materialController = require('../controllers/materialController');

router.get('/', materialController.getMaterials);
router.get('/:id/process-sheet.pdf', materialController.viewProcessSheetPdf);
router.post('/', materialController.saveMaterial);
router.post('/delete', materialController.deleteMaterial);

module.exports = router;
