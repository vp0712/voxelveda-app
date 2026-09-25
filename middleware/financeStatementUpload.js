'use strict';

const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');
const { sanitizeUploadName, secureMulterOptions, validateUploadedFile } = require('./uploadSecurity');

const financeUploadDir = path.join(__dirname, '..', 'uploads', 'finance');
if (!fs.existsSync(financeUploadDir)) fs.mkdirSync(financeUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination(_req, _file, callback) { callback(null, financeUploadDir); },
  filename(req, file, callback) {
    callback(null, `statement_${req.params.id}_${Date.now()}_${sanitizeUploadName(file.originalname)}`);
  }
});

const upload = multer(secureMulterOptions(storage, Math.max(1, Number(process.env.FINANCE_STATEMENT_MAX_MB || 25))));

module.exports = [upload.single('file'), validateUploadedFile];
