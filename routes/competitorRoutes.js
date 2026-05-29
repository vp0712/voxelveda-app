const express = require('express');
const competitorController = require('../controllers/competitorController');

const router = express.Router();

router.get('/', competitorController.getCompetitors);
router.post('/', competitorController.saveCompetitor);
router.post('/seed', competitorController.seedIndustryCompetitors);
router.post('/delete', competitorController.deleteCompetitor);

module.exports = router;
