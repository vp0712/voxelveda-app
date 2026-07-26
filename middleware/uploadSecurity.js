const path = require('path');

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

module.exports = {
  sanitizeUploadName,
  secureFileFilter,
  secureMulterOptions
};
