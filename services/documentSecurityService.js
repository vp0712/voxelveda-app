const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { hasPermission } = require('./authorizationService');
const { ensureSecurityOperationsSchema } = require('./securityOperationsSchema');
const { currentScanStatus, queueDocumentScan } = require('./malwareScanService');
const { deleteObject, getObject, isConfigured: objectStorageConfigured, keyFromStorageUri, putObject, storageUri } = require('./objectStorageService');
const { logSecurityEvent } = require('./sessionService');
const { isStepUpFresh, stepUpTtlMinutes } = require('./stepUpService');
const { documentModuleAvailable } = require('./applicationRetirement');
const { validatePdf, safePdfFilename, storedDocumentArtifact } = require('./documentPdfService');
const { customerScoped, ownsCustomerRecord } = require('./customerRecordScope');

const UPLOAD_ROOT = path.resolve(__dirname, '..', 'uploads');
const CLASSIFICATIONS = new Set(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']);
const ACCESS_POLICIES = Object.freeze({
  PUBLIC: 'AUTHENTICATED', INTERNAL: 'MODULE_OR_OWNER',
  CONFIDENTIAL: 'MODULE_OR_OWNER', RESTRICTED: 'MODULE_AND_STEP_UP'
});

function requireAvailableDocumentModule(module) {
  if (!documentModuleAvailable(module)) {
    throw Object.assign(new Error('This document belongs to a module that has been removed.'), { status: 410, code: 'MODULE_RETIRED' });
  }
}

function retiredDocumentResponse(res) {
  return res.status(410).json({ code: 'MODULE_RETIRED', message: 'This document belongs to a module that has been removed.' });
}

function safeStoredPath(filePath) {
  const resolved = path.resolve(filePath);
  return resolved.startsWith(`${UPLOAD_ROOT}${path.sep}`) ? resolved : null;
}

function objectStorageDocumentsEnabled() {
  return String(process.env.OBJECT_STORAGE_DOCUMENTS_ENABLED || '').trim().toLowerCase() === 'true' && objectStorageConfigured();
}

function documentObjectKey(id, file) {
  const storedName = path.basename(String(file?.filename || 'document')) || 'document';
  return `secure-documents/${id}/${encodeURIComponent(storedName)}`;
}

function scanStatusForFile(file) {
  const synchronous = String(file?.malwareScan?.status || '').toUpperCase();
  if (synchronous === 'CLEAN') return 'CLEAN';
  if (synchronous === 'UNVERIFIED') return 'UNAVAILABLE';
  return currentScanStatus();
}

const ORIGINAL_DOCUMENT_PERMISSIONS=Object.freeze({
  rfq:['VIEW_RFQS'],invoice:['VIEW_FINANCE'],invoices:['VIEW_FINANCE'],quotation:['VIEW_FINANCE'],quotes:['VIEW_FINANCE'],
  customer:['VIEW_CUSTOMERS'],customers:['VIEW_CUSTOMERS'],supplier:['VIEW_SUPPLIERS'],suppliers:['VIEW_SUPPLIERS'],
  procurement:['VIEW_PROCUREMENT'],stock:['VIEW_INVENTORY'],materials:['VIEW_INVENTORY'],
  expense:['VIEW_FINANCE'],expenses:['VIEW_FINANCE'],qms:['VIEW_QMS'],compliance:['VIEW_COMPLIANCE'],
  meeting:['VIEW_MEETINGS','MANAGE_MEETINGS'],meetings:['VIEW_MEETINGS','MANAGE_MEETINGS'],
  careers:['VIEW_STAFF_HR','MANAGE_USERS'],staff:['VIEW_STAFF_HR','MANAGE_USERS'],hr:['VIEW_STAFF_HR','MANAGE_USERS'],
  'employee-identities':['VIEW_STAFF_HR','MANAGE_USERS']
});
async function mayViewDocument(user,document,db=pool){
  if(!documentModuleAvailable(document.module))return false;
  if(!user || !Number.isSafeInteger(Number(user.id)) || Number(user.id)<1)return false;
  const module=String(document.module || '').toLowerCase();
  if (customerScoped(user) && ['expense','expenses'].includes(module)) return false;
  if (customerScoped(user) && ['rfq','rfqs','invoice','invoices','quotation','quotes'].includes(module)) {
    const invoiceModule = ['invoice','invoices','quotation','quotes'].includes(module);
    if (!hasPermission(user, invoiceModule ? 'VIEW_FINANCE' : 'VIEW_RFQS')) return false;
    const id = Number(document.record_id);
    if (!Number.isSafeInteger(id) || id < 1) return false;
    const [[record]] = invoiceModule
      ? await db.query('SELECT customer_email FROM invoices WHERE id=? AND IFNULL(deleted,0)=0 LIMIT 1', [id])
      : await db.query('SELECT email FROM rfqs WHERE id=? AND IFNULL(deleted,0)=0 LIMIT 1', [id]);
    return Boolean(record && ownsCustomerRecord(user, invoiceModule ? record.customer_email : record.email));
  }
  const ownsDocument=Number(document.owner_user_id)>0 && Number(document.owner_user_id)===Number(user.id);
  if(ownsDocument)return true;
  if(['profile','security'].includes(module)){
    const publicDocument=document.access_policy==='AUTHENTICATED' && document.classification==='PUBLIC';
    return publicDocument || hasPermission(user,'VIEW_CONFIDENTIAL_FILES');
  }
  if(ORIGINAL_DOCUMENT_PERMISSIONS[module])return ORIGINAL_DOCUMENT_PERMISSIONS[module].some(permission=>hasPermission(user,permission));
  if(['attendance','timesheet','timesheets','roster'].includes(module)){
    if(hasPermission(user,'VIEW_ALL_TIMESHEETS') || hasPermission(user,'EDIT_ATTENDANCE'))return true;
    if(!hasPermission(user,'VIEW_TEAM_TIMESHEET') || !Number.isSafeInteger(Number(document.owner_user_id)) || Number(document.owner_user_id)<1)return false;
    const [[owner]]=await db.query('SELECT manager_id FROM users WHERE id=? LIMIT 1',[Number(document.owner_user_id)]);
    return Number(owner?.manager_id)===Number(user.id);
  }
  if(['task','tasks'].includes(module)){
    if(hasPermission(user,'MANAGE_JOBS'))return true;
    const id=Number(document.record_id);
    if(!Number.isSafeInteger(id) || id<1 || !/^(task|job)$/i.test(String(document.record_type)))return false;
    if(!hasPermission(user,'MANAGE_TEAM_JOBS') && !hasPermission(user,'VIEW_OWN_JOBS'))return false;
    const [[task]]=await db.query('SELECT t.assigned_to,u.manager_id FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to WHERE t.id=? AND IFNULL(t.deleted,0)=0 LIMIT 1',[id]);
    return Boolean(task && ((hasPermission(user,'VIEW_OWN_JOBS') && Number(task.assigned_to)===Number(user.id)) || (hasPermission(user,'MANAGE_TEAM_JOBS') && Number(task.manager_id)===Number(user.id))));
  }
  return false;
}

async function registerDocument({ module, recordType, recordId, ownerUserId, uploadedBy, file, classification = 'CONFIDENTIAL' }) {
  requireAvailableDocumentModule(module);
  const normalizedModule = String(module).toLowerCase();
  await ensureSecurityOperationsSchema();
  const id = crypto.randomUUID();
  const safePath = safeStoredPath(file.path);
  if (!safePath) throw Object.assign(new Error('Upload storage path rejected'), { status: 400 });
  const normalClassification = String(classification || '').toUpperCase();
  if (!CLASSIFICATIONS.has(normalClassification)) throw Object.assign(new Error('Document classification rejected'), { status: 400 });

  const body = await fs.promises.readFile(safePath);
  const contentSha256 = crypto.createHash('sha256').update(body).digest('hex');
  const scanStatus = scanStatusForFile(file);
  let storagePath = safePath;
  let objectKey = null;

  try {
    if (objectStorageDocumentsEnabled()) {
      objectKey = documentObjectKey(id, file);
      await putObject(objectKey, body, file.mimetype || 'application/octet-stream');
      storagePath = storageUri(objectKey);
    }

    await pool.query(
      `INSERT INTO secure_documents
       (id, module, record_type, record_id, owner_user_id, uploaded_by, original_name, stored_name,
        storage_path, mime_type, size_bytes, content_sha256, classification, access_policy, scan_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, normalizedModule, recordType, String(recordId), ownerUserId || null, uploadedBy, safeDispositionName(file.originalname),
        file.filename, storagePath, file.mimetype, Number(file.size || body.length), contentSha256, normalClassification,
        ACCESS_POLICIES[normalClassification], scanStatus]
    );
  } catch (error) {
    if (objectKey) await deleteObject(objectKey).catch(() => {});
    throw error;
  }

  if (objectKey) await fs.promises.unlink(safePath).catch(() => {});
  if (scanStatus === 'PENDING_SCAN') await queueDocumentScan(id, uploadedBy);
  return {
    id,
    classification: normalClassification,
    access_policy: ACCESS_POLICIES[normalClassification],
    content_sha256: contentSha256,
    scan_status: scanStatus,
    storage: objectKey ? 'OBJECT_STORAGE' : 'LOCAL_LEGACY',
    download_url: `/api/documents/${id}/download`
  };
}

async function getAuthorisedDocument(user, id, db = pool) {
  await ensureSecurityOperationsSchema();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ''))) return { status: 404 };
  const [[document]] = await db.query(`SELECT * FROM secure_documents WHERE id = ? AND deleted_at IS NULL LIMIT 1${db === pool ? '' : ' FOR UPDATE'}`, [id]);
  if (!document) return { status: 404 };
  if (!documentModuleAvailable(document.module)) return { status: 410, code: 'MODULE_RETIRED' };
  if(!await mayViewDocument(user,document,db))return {status:403};
  if (document.scan_status === 'QUARANTINED' || document.scan_status === 'PENDING_SCAN') return { status: 423 };

  const objectKey = keyFromStorageUri(document.storage_path);
  if (objectKey) return { status: 200, document, storage: 'OBJECT_STORAGE', objectKey };

  const resolved = safeStoredPath(document.storage_path);
  if (!resolved || !fs.existsSync(resolved)) return { status: 404 };
  return { status: 200, document, storage: 'LOCAL_LEGACY', path: resolved };
}

async function readDocumentBodyInternal(id) {
  await ensureSecurityOperationsSchema();
  const [[document]] = await pool.query('SELECT * FROM secure_documents WHERE id=? AND deleted_at IS NULL LIMIT 1', [id]);
  if (!document) throw Object.assign(new Error('Stored document was not found.'), { code: 'STORED_DOCUMENT_NOT_FOUND', status: 404 });
  requireAvailableDocumentModule(document.module);
  if (['QUARANTINED', 'PENDING_SCAN'].includes(String(document.scan_status || '').toUpperCase())) {
    throw Object.assign(new Error('Stored document is not available while security scanning is pending.'), { code: 'STORED_DOCUMENT_SECURITY_PENDING', status: 423 });
  }
  const objectKey = keyFromStorageUri(document.storage_path);
  let body;
  if (objectKey) body = await getObject(objectKey);
  else {
    const resolved = safeStoredPath(document.storage_path);
    if (!resolved || !fs.existsSync(resolved)) throw Object.assign(new Error('Stored document bytes were not found.'), { code: 'STORED_DOCUMENT_BYTES_NOT_FOUND', status: 404 });
    body = await fs.promises.readFile(resolved);
  }
  const actualSha256 = crypto.createHash('sha256').update(body).digest('hex');
  if (document.content_sha256 && actualSha256 !== document.content_sha256) {
    throw Object.assign(new Error('Stored document integrity verification failed.'), { code: 'DOCUMENT_INTEGRITY_MISMATCH', status: 409 });
  }
  return { document, body, contentSha256: actualSha256, storage: objectKey ? 'OBJECT_STORAGE' : 'LOCAL_LEGACY' };
}

async function removeDocumentInternal(id) {
  const [[document]] = await pool.query('SELECT * FROM secure_documents WHERE id=? LIMIT 1', [id]);
  if (!document) return false;
  requireAvailableDocumentModule(document.module);
  // Archive access without erasing the original attachment or its hash/history.
  await pool.query('UPDATE secure_documents SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL', [id]);
  return true;
}

function safeDispositionName(value) {
  return String(value || 'document').replace(/[\r\n"\\]/g, '_').slice(0, 180);
}

async function sendDocument(req, res) {
  const result = await getAuthorisedDocument(req.user, req.params.id);
  if (result.status === 410) return retiredDocumentResponse(res);
  if (result.status === 403) return res.status(403).json({ message: 'Access denied: document is outside your authorised scope' });
  if (result.status === 423) return res.status(423).json({ message: 'Document is not available while security scanning is pending' });
  if (result.status !== 200) return res.status(404).json({ message: 'Document not found' });
  if (result.document.classification === 'RESTRICTED' && !isStepUpFresh(req.session)) {
    return res.status(403).json({ message: 'Security verification is required to download this restricted document.', code: 'STEP_UP_REQUIRED', assurance_required: 3, verification_valid_minutes: stepUpTtlMinutes() });
  }
  return streamDocument(req, res, result);
}

async function prepareStoredPdf(result) {
  requireAvailableDocumentModule(result.document.module);
  const body = result.storage === 'OBJECT_STORAGE' ? await getObject(result.objectKey) : await fs.promises.readFile(result.path);
  const actual = crypto.createHash('sha256').update(body).digest('hex');
  if (result.document.content_sha256 && actual !== result.document.content_sha256) throw Object.assign(new Error('Document integrity verification failed'), { code: 'DOCUMENT_INTEGRITY_MISMATCH', status: 409 });
  return storedDocumentArtifact(body, result.document.original_name);
}

async function streamDocument(req, res, result, preparedArtifact) {
  let artifact;
  try { artifact = preparedArtifact || await prepareStoredPdf(result); }
  catch (error) {
    if(error.status===410 || error.status===409)throw error;
    return res.status(422).json({ code: error.code || 'PDF_DOCUMENT_INVALID', message: error.message });
  }
  await logSecurityEvent({ actorId: req.user.id, eventType: 'SENSITIVE_DOCUMENT_VIEWED', req, sessionId: req.session?.id,
    metadata: { documentId: result.document.id, module: result.document.module, recordType: result.document.record_type, recordId: result.document.record_id, classification: result.document.classification, storage: result.storage, pdfValidated: true } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${safePdfFilename(result.document.original_name)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Length', artifact.buffer.length);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.end(artifact.buffer);
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function createDocumentGrant(req, res) {
  const result = await getAuthorisedDocument(req.user, req.params.id);
  if (result.status === 410) return retiredDocumentResponse(res);
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
  await ensureSecurityOperationsSchema();
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
    // Check the locked document and current authorization before consuming a
    // historical grant. Retired documents and their grants remain untouched.
    const result = await getAuthorisedDocument(req.user, grant.document_id, db);
    if (result.status !== 200) {
      await db.rollback();
      if (result.status === 410) return retiredDocumentResponse(res);
      return res.status(404).json({ message: 'Document not found' });
    }
    if (result.document.classification === 'RESTRICTED' && !isStepUpFresh(req.session)) {
      await db.rollback();
      return res.status(403).json({ message: 'Security verification is required to download this restricted document.', code: 'STEP_UP_REQUIRED', assurance_required: 3, verification_valid_minutes: stepUpTtlMinutes() });
    }
    let artifact;
    try { artifact=await prepareStoredPdf(result); }
    catch(error) {
      await db.rollback();
      return res.status(error.status || 422).json({code:error.code || 'PDF_DOCUMENT_INVALID',message:error.message});
    }
    await db.query('UPDATE document_download_grants SET used_at = NOW() WHERE id = ? AND used_at IS NULL', [grant.id]);
    await db.commit();
    return streamDocument(req, res, result, artifact);
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }
}

module.exports = {
  createDocumentGrant,
  documentObjectKey,
  getAuthorisedDocument,
  mayViewDocument,
  objectStorageDocumentsEnabled,
  readDocumentBodyInternal,
  removeDocumentInternal,
  registerDocument,
  safeDispositionName,
  safeStoredPath,
  scanStatusForFile,
  sendDocument,
  sendGrantedDocument,
  streamDocument,
  _test:{mayViewDocument,ORIGINAL_DOCUMENT_PERMISSIONS}
};
