const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const supplierController = require('../controllers/supplierController');
const requireInputPermission = require('../middleware/inputPermissionMiddleware');
const { sanitizeUploadName, secureMulterOptions } = require('../middleware/uploadSecurity');

const router = express.Router();
const uploadDir = path.join(__dirname, '..', 'uploads', 'suppliers');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadDir);
  },
  filename(req, file, cb) {
    const safeName = sanitizeUploadName(file.originalname);
    cb(null, `supplier_${req.params.id}_${Date.now()}_${safeName}`);
  }
});

const upload = multer(secureMulterOptions(storage, 12));

router.get('/', supplierController.getSuppliers);
router.get('/files/:id/view', supplierController.viewSupplierFile);
router.post('/', requireInputPermission('suppliers_input'), supplierController.saveSupplier);
router.post('/delete', requireInputPermission('suppliers_input'), supplierController.deleteSupplier);
router.post('/:id/files', requireInputPermission('suppliers_input'), upload.single('file'), supplierController.saveSupplierFile);
router.post('/files/delete', requireInputPermission('suppliers_input'), supplierController.deleteSupplierFile);

module.exports = router;
