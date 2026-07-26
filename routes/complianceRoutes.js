const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const complianceController = require('../controllers/complianceController');
const { sanitizeUploadName, secureMulterOptions } = require('../middleware/uploadSecurity');

const router = express.Router();
const uploadDir = path.join(__dirname, '..', 'uploads', 'compliance');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadDir);
  },
  filename(req, file, cb) {
    const safeName = sanitizeUploadName(file.originalname);
    cb(null, `compliance_${req.params.id}_${Date.now()}_${safeName}`);
  }
});

const upload = multer(secureMulterOptions(storage, 15));

router.get('/', complianceController.getComplianceEntries);
router.post('/', complianceController.saveComplianceEntry);
router.post('/delete', complianceController.deleteComplianceEntry);
router.post('/:id/files', upload.single('file'), complianceController.saveComplianceFile);
router.post('/files/delete', complianceController.deleteComplianceFile);

module.exports = router;
