const path = require('path');
const fs = require('fs');

const ALLOWED_UPLOADS = new Map([
  ['.pdf', ['application/pdf']],
  ['.png', ['image/png']],
  ['.jpg', ['image/jpeg']],
  ['.jpeg', ['image/jpeg']],
  ['.webp', ['image/webp']],
  ['.gif', ['image/gif']],
  ['.csv', ['text/csv', 'application/csv', 'application/vnd.ms-excel']],
  ['.txt', ['text/plain']],
  ['.doc', ['application/msword']],
  ['.docx', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']],
  ['.xls', ['application/vnd.ms-excel']],
  ['.xlsx', ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']]
]);

function sanitizeUploadName(filename) {
  const parsed = path.parse(String(filename || 'file'));
  const safeBase = parsed.name
    .replace(/[^a-zA-Z0-9.\-_]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80) || 'file';
  const ext = parsed.ext.toLowerCase();
  return `${safeBase}${ext}`;
}

function secureFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const allowedMimes = ALLOWED_UPLOADS.get(ext);

  if (!allowedMimes || !allowedMimes.includes(file.mimetype)) {
    return cb(new Error('File type not allowed. Upload PDF, image, CSV, Word or Excel files only.'));
  }

  cb(null, true);
}

function secureMulterOptions(storage, fileSizeMb = 12) {
  return {
    storage,
    fileFilter: secureFileFilter,
    limits: {
      files: 1,
      fileSize: fileSizeMb * 1024 * 1024
    }
  };
}

function matchesSignature(ext, bytes) {
  const hex = bytes.toString('hex');
  if (ext === '.pdf') return bytes.slice(0, 5).toString() === '%PDF-';
  if (ext === '.png') return hex.startsWith('89504e470d0a1a0a');
  if (['.jpg', '.jpeg'].includes(ext)) return hex.startsWith('ffd8ff');
  if (ext === '.gif') return ['GIF87a', 'GIF89a'].includes(bytes.slice(0, 6).toString());
  if (ext === '.webp') return bytes.slice(0, 4).toString() === 'RIFF' && bytes.slice(8, 12).toString() === 'WEBP';
  if (['.docx', '.xlsx'].includes(ext)) return hex.startsWith('504b0304');
  if (['.doc', '.xls'].includes(ext)) return hex.startsWith('d0cf11e0a1b11ae1');
  if (['.csv', '.txt'].includes(ext)) return !bytes.includes(0);
  return false;
}

async function validateUploadedFile(req, res, next) {
  if (!req.file?.path) return next();
  try {
    const handle = await fs.promises.open(req.file.path, 'r');
    const bytes = Buffer.alloc(32);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    await handle.close();
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    if (!matchesSignature(ext, bytes.subarray(0, bytesRead))) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ message: 'File content does not match the selected file type.' });
    }
    return next();
  } catch (error) {
    await fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ message: 'Uploaded file could not be validated.' });
  }
}

module.exports = {
  sanitizeUploadName,
  secureFileFilter,
  secureMulterOptions,
  validateUploadedFile
};
