const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const complianceController = require('../controllers/complianceController');
const qmsRoutes = require('./qmsRoutes');
const requireInputPermission = require('../middleware/inputPermissionMiddleware');
const { sanitizeUploadName, secureMulterOptions, validateUploadedFile } = require('../middleware/uploadSecurity');

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

router.use('/qms', qmsRoutes);
router.get('/', complianceController.getComplianceEntries);
router.get('/files/:id/view', complianceController.viewComplianceFile);
router.post('/', requireInputPermission('EDIT_COMPLIANCE'), complianceController.saveComplianceEntry);
router.post('/delete', requireInputPermission('EDIT_COMPLIANCE'), complianceController.deleteComplianceEntry);
router.post('/:id/files', requireInputPermission('EDIT_COMPLIANCE'), upload.single('file'), validateUploadedFile, complianceController.saveComplianceFile);
router.post('/files/delete', requireInputPermission('EDIT_COMPLIANCE'), complianceController.deleteComplianceFile);

module.exports = router;
