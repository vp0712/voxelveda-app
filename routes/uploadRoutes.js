const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/db');
const { sanitizeUploadName, secureMulterOptions } = require('../middleware/uploadSecurity');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'uploads', 'rfqs');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const safeName = sanitizeUploadName(file.originalname);
    cb(null, `rfq_${req.params.id}_${Date.now()}_${safeName}`);
  }
});

const upload = multer(secureMulterOptions(storage, 12));

router.post('/rfq/:id', requireAnyPermission('EDIT_RFQS'), upload.single('file'), async (req, res) => {
  try {
    const rfqId = req.params.id;

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const [rfqRows] = await pool.query(
      'SELECT id FROM rfqs WHERE id = ? LIMIT 1',
      [rfqId]
    );

    if (!rfqRows.length) {
      return res.status(404).json({
        message: `RFQ #${rfqId} not found. Use a real RFQ ID.`
      });
    }

    res.json({
      message: 'File uploaded successfully',
      file: {
        original_name: req.file.originalname,
        filename: req.file.filename,
        path: `/uploads/rfqs/${req.file.filename}`
      }
    });
  } catch (err) {
    console.error('UPLOAD RFQ FILE ERROR:', err);
    res.status(500).json({
      message: 'Upload failed',
      error: err.message
    });
  }
});

module.exports = router;
