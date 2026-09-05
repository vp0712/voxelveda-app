const express = require('express');
const { sendDocument } = require('../services/documentSecurityService');

const router = express.Router();
router.get('/:id/download', async (req, res, next) => {
  try { await sendDocument(req, res); } catch (error) { next(error); }
});

module.exports = router;
