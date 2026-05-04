const express = require('express');
const multer = require('multer');
const path = require('path');
const authMiddleware = require('../middleware/authMiddleware');
const pool = require('../config/db');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

router.post('/rfq/:rfq_id', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const { rfq_id } = req.params;

    await pool.query(
      'INSERT INTO rfq_files (rfq_id, file_name, file_path) VALUES (?, ?, ?)',
      [rfq_id, req.file.originalname, `/uploads/${req.file.filename}`]
    );

    res.json({ message: 'File uploaded successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Upload failed', error: err.message });
  }
});

module.exports = router;