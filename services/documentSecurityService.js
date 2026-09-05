const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { hasPermission } = require('./authorizationService');
const { ensureSecurityOperationsSchema } = require('./securityOperationsSchema');
const { currentScanStatus } = require('./malwareScanService');
const { logSecurityEvent } = require('./sessionService');

const UPLOAD_ROOT = path.resolve(__dirname, '..', 'uploads');
const MODULE_PERMISSION = Object.freeze({ rfq: 'VIEW_RFQS' });

function safeStoredPath(filePath) {
  const resolved = path.resolve(filePath);
  return resolved.startsWith(`${UPLOAD_ROOT}${path.sep}`) ? resolved : null;
}

async function registerDocument({ module, recordType, recordId, ownerUserId, uploadedBy, file, classification = 'CONFIDENTIAL' }) {
  await ensureSecurityOperationsSchema();
  const id = crypto.randomUUID();
  const safePath = safeStoredPath(file.path);
  if (!safePath) throw Object.assign(new Error('Upload storage path rejected'), { status: 400 });
  await pool.query(
    `INSERT INTO secure_documents
     (id, module, record_type, record_id, owner_user_id, uploaded_by, original_name, stored_name,
      storage_path, mime_type, size_bytes, classification, scan_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, module, recordType, String(recordId), ownerUserId || null, uploadedBy, file.originalname,
      file.filename, safePath, file.mimetype, Number(file.size || 0), classification, currentScanStatus()]
  );
  return { id, classification, scan_status: currentScanStatus(), download_url: `/api/documents/${id}/download` };
}

async function getAuthorisedDocument(user, id) {
  await ensureSecurityOperationsSchema();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ''))) return { status: 404 };
  const [[document]] = await pool.query('SELECT * FROM secure_documents WHERE id = ? AND deleted_at IS NULL LIMIT 1', [id]);
  if (!document) return { status: 404 };
  const permission = MODULE_PERMISSION[document.module] || 'VIEW_CONFIDENTIAL_FILES';
  const ownsDocument = document.owner_user_id && Number(document.owner_user_id) === Number(user.id);
  if (!ownsDocument && !hasPermission(user, permission)) return { status: 403 };
  if (document.scan_status === 'QUARANTINED' || document.scan_status === 'PENDING_SCAN') return { status: 423 };
  const resolved = safeStoredPath(document.storage_path);
  if (!resolved || !fs.existsSync(resolved)) return { status: 404 };
  return { status: 200, document, path: resolved };
}

function safeDispositionName(value) {
  return String(value || 'document').replace(/[\r\n"\\]/g, '_').slice(0, 180);
}

async function sendDocument(req, res) {
  const result = await getAuthorisedDocument(req.user, req.params.id);
  if (result.status === 403) return res.status(403).json({ message: 'Access denied: document is outside your authorised scope' });
  if (result.status === 423) return res.status(423).json({ message: 'Document is not available while security scanning is pending' });
  if (result.status !== 200) return res.status(404).json({ message: 'Document not found' });
  res.setHeader('Content-Type', result.document.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${safeDispositionName(result.document.original_name)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  await logSecurityEvent({ actorId: req.user.id, eventType: 'SENSITIVE_DOCUMENT_VIEWED', req, sessionId: req.session?.id,
    metadata: { documentId: result.document.id, module: result.document.module, recordType: result.document.record_type, recordId: result.document.record_id, classification: result.document.classification } });
  return fs.createReadStream(result.path).pipe(res);
}

module.exports = { registerDocument, safeDispositionName, safeStoredPath, sendDocument };
