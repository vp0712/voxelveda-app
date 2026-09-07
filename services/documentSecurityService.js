const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { hasPermission } = require('./authorizationService');
const { ensureSecurityOperationsSchema } = require('./securityOperationsSchema');
const { currentScanStatus, queueDocumentScan } = require('./malwareScanService');
const { logSecurityEvent } = require('./sessionService');
const { isStepUpFresh, stepUpTtlMinutes } = require('./stepUpService');

const UPLOAD_ROOT = path.resolve(__dirname, '..', 'uploads');
const MODULE_PERMISSION = Object.freeze({ rfq: 'VIEW_RFQS' });
const CLASSIFICATIONS = new Set(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']);
const ACCESS_POLICIES = Object.freeze({
  PUBLIC: 'AUTHENTICATED', INTERNAL: 'MODULE_OR_OWNER',
  CONFIDENTIAL: 'MODULE_OR_OWNER', RESTRICTED: 'MODULE_AND_STEP_UP'
});

function safeStoredPath(filePath) {
  const resolved = path.resolve(filePath);
  return resolved.startsWith(`${UPLOAD_ROOT}${path.sep}`) ? resolved : null;
}

async function registerDocument({ module, recordType, recordId, ownerUserId, uploadedBy, file, classification = 'CONFIDENTIAL' }) {
  await ensureSecurityOperationsSchema();
  const id = crypto.randomUUID();
  const safePath = safeStoredPath(file.path);
  if (!safePath) throw Object.assign(new Error('Upload storage path rejected'), { status: 400 });
  const normalClassification = String(classification || '').toUpperCase();
  if (!CLASSIFICATIONS.has(normalClassification)) throw Object.assign(new Error('Document classification rejected'), { status: 400 });
  const contentSha256 = await new Promise((resolve, reject) => {
    const digest = crypto.createHash('sha256');
    fs.createReadStream(safePath).on('data', (chunk) => digest.update(chunk)).on('error', reject).on('end', () => resolve(digest.digest('hex')));
  });
  const scanStatus = currentScanStatus();
  await pool.query(
    `INSERT INTO secure_documents
     (id, module, record_type, record_id, owner_user_id, uploaded_by, original_name, stored_name,
      storage_path, mime_type, size_bytes, content_sha256, classification, access_policy, scan_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, module, recordType, String(recordId), ownerUserId || null, uploadedBy, safeDispositionName(file.originalname),
      file.filename, safePath, file.mimetype, Number(file.size || 0), contentSha256, normalClassification,
      ACCESS_POLICIES[normalClassification], scanStatus]
  );
  if (scanStatus === 'PENDING_SCAN') await queueDocumentScan(id, uploadedBy);
  return { id, classification: normalClassification, access_policy: ACCESS_POLICIES[normalClassification], content_sha256: contentSha256, scan_status: scanStatus, download_url: `/api/documents/${id}/download` };
}

async function getAuthorisedDocument(user, id) {
  await ensureSecurityOperationsSchema();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ''))) return { status: 404 };
  const [[document]] = await pool.query('SELECT * FROM secure_documents WHERE id = ? AND deleted_at IS NULL LIMIT 1', [id]);
  if (!document) return { status: 404 };
  const permission = MODULE_PERMISSION[document.module] || 'VIEW_CONFIDENTIAL_FILES';
  const ownsDocument = document.owner_user_id && Number(document.owner_user_id) === Number(user.id);
  const authenticatedOnly = document.access_policy === 'AUTHENTICATED' && document.classification === 'PUBLIC';
  if (!authenticatedOnly && !ownsDocument && !hasPermission(user, permission)) return { status: 403 };
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
  if (result.document.classification === 'RESTRICTED' && !isStepUpFresh(req.session)) {
    return res.status(403).json({ message: 'Security verification is required to download this restricted document.', code: 'STEP_UP_REQUIRED', assurance_required: 3, verification_valid_minutes: stepUpTtlMinutes() });
  }
  return streamDocument(req, res, result);
}

async function streamDocument(req, res, result) {
  res.setHeader('Content-Type', result.document.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${safeDispositionName(result.document.original_name)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  await logSecurityEvent({ actorId: req.user.id, eventType: 'SENSITIVE_DOCUMENT_VIEWED', req, sessionId: req.session?.id,
    metadata: { documentId: result.document.id, module: result.document.module, recordType: result.document.record_type, recordId: result.document.record_id, classification: result.document.classification } });
  return fs.createReadStream(result.path).pipe(res);
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function createDocumentGrant(req, res) {
  const result = await getAuthorisedDocument(req.user, req.params.id);
  if (result.status !== 200) return res.status(result.status === 403 ? 403 : result.status === 423 ? 423 : 404).json({ message: result.status === 403 ? 'Access denied' : result.status === 423 ? 'Document is not available while security scanning is pending' : 'Document not found' });
  const token = crypto.randomBytes(32).toString('base64url');
  const id = crypto.randomUUID();
  const ttlMinutes = Math.max(1, Math.min(15, Number(req.body?.ttl_minutes || 5)));
  await pool.query(
    `INSERT INTO document_download_grants (id,document_id,token_hash,bound_user_id,created_by,expires_at)
     VALUES (?,?,?,?,?,DATE_ADD(NOW(),INTERVAL ? MINUTE))`,
    [id, result.document.id, tokenHash(token), req.user.id, req.user.id, ttlMinutes]
  );
  await logSecurityEvent({ actorId: req.user.id, eventType: 'DOCUMENT_DOWNLOAD_GRANT_CREATED', req, sessionId: req.session?.id,
    metadata: { documentId: result.document.id, classification: result.document.classification, expiresInMinutes: ttlMinutes } });
  return res.status(201).json({ grant_url: `/api/documents/access/${token}`, expires_in_minutes: ttlMinutes, single_use: true });
}

async function sendGrantedDocument(req, res) {
  const hash = tokenHash(req.params.token);
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[grant]] = await db.query(
      'SELECT * FROM document_download_grants WHERE token_hash = ? AND bound_user_id = ? FOR UPDATE',
      [hash, req.user.id]
    );
    if (!grant || grant.used_at || new Date(grant.expires_at) <= new Date()) {
      await db.rollback();
      return res.status(404).json({ message: 'Download grant is invalid or expired' });
    }
    await db.query('UPDATE document_download_grants SET used_at = NOW() WHERE id = ? AND used_at IS NULL', [grant.id]);
    await db.commit();
    const result = await getAuthorisedDocument(req.user, grant.document_id);
    if (result.status !== 200) return res.status(404).json({ message: 'Document not found' });
    return streamDocument(req, res, result);
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }
}

module.exports = { createDocumentGrant, getAuthorisedDocument, registerDocument, safeDispositionName, safeStoredPath, sendDocument, sendGrantedDocument };
