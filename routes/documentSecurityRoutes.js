const express = require('express');
const { createDocumentGrant, sendDocument, sendGrantedDocument } = require('../services/documentSecurityService');
const requireStepUp = require('../middleware/stepUpMiddleware');

const router = express.Router();
router.get('/access/:token', async (req, res, next) => {
  try { await sendGrantedDocument(req, res); } catch (error) { next(error); }
});
router.post('/:id/grants', requireStepUp('CREATE_DOCUMENT_DOWNLOAD_GRANT'), async (req, res, next) => {
  try { await createDocumentGrant(req, res); } catch (error) { next(error); }
});
router.get('/:id/download', async (req, res, next) => {
  try { await sendDocument(req, res); } catch (error) { next(error); }
});

module.exports = router;
