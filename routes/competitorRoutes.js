const express = require('express');
const competitorController = require('../controllers/competitorController');

const router = express.Router();

router.get('/', competitorController.getCompetitors);
router.post('/', competitorController.saveCompetitor);
router.post('/seed', (_req, res) => res.status(409).json({ code: 'EXPLICIT_IMPORT_REQUIRED', message: 'Add or import verified competitor records before they appear in this register.' }));
router.post('/delete', competitorController.deleteCompetitor);

module.exports = router;
