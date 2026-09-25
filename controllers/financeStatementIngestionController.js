'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const pool = require('../config/db');
const { ensureFinanceSchema } = require('../services/financeSchema');
const { logAudit } = require('../services/auditService');
const { detectStatementFile } = require('../services/financeStatementDetection');
const { encryptSensitive } = require('../services/financeEncryptionService');
const {
  objectStorageDocumentsEnabled,
  registerDocument,
  removeDocumentInternal
} = require('../services/documentSecurityService');
const {
  financeStatementQueueHealth,
  triggerFinanceStatementIngestion
} = require('../services/financeStatementIngestionWorker');

function uid(prefix) { return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`; }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function actor(req) { return { actorId: req.user?.id, ipAddress: req.ip, userAgent: req.get('user-agent'), requestId: req.id || req.get('x-request-id') || null, sessionId: req.session?.id || null }; }

async function removeTemporary(file) { if (file?.path) await fs.promises.unlink(file.path).catch(() => {}); }

function fail(res, error, message) {
  const status = Number(error?.status || error?.statusCode || 500);
  if (status < 500 || error?.code) return res.status(status < 400 ? 500 : status).json({ message: error.message || message, code: error.code || 'STATEMENT_INGESTION_ERROR', details: error.details || undefined });
  console.error(`${message}:`, error);
  return res.status(500).json({ message, code: 'STATEMENT_INGESTION_ERROR' });
}

function parseMapping(value) {
  if (!value) return {};
  let parsed;
  try { parsed = typeof value === 'string' ? JSON.parse(value) : value; }
  catch { throw Object.assign(new Error('Statement mapping is not valid JSON.'), { code: 'STATEMENT_MAPPING_INVALID', status: 400 }); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Object.assign(new Error('Statement mapping must be a JSON object.'), { code: 'STATEMENT_MAPPING_INVALID', status: 400 });
  const allowed = {};
  if (parsed.header_row !== undefined) allowed.header_row = Math.max(1, Math.min(100, Number(parsed.header_row) || 1));
  if (parsed.date_format) allowed.date_format = String(parsed.date_format).toUpperCase().slice(0, 10);
  if (parsed.signed_amount_rule) allowed.signed_amount_rule = String(parsed.signed_amount_rule).toUpperCase().slice(0, 30);
  if (parsed.columns && typeof parsed.columns === 'object' && !Array.isArray(parsed.columns)) {
    allowed.columns = Object.fromEntries(Object.entries(parsed.columns).slice(0, 30).map(([key, column]) => [String(key).slice(0, 60), typeof column === 'number' ? column : String(column).slice(0, 120)]));
  }
  return allowed;
}

exports.legacyDisabled = (_req, res) => res.status(410).json({
  message: 'Client-supplied statement rows are no longer accepted. Upload the original file through the secure statement-import endpoint.',
  code: 'LEGACY_STATEMENT_PREVIEW_DISABLED',
  replacement: 'POST /api/finance/intelligence/accounts/:id/statement-imports'
});

exports.upload = async (req, res) => {
  let document;
  let db;
  try {
    await ensureFinanceSchema();
    if (!req.file?.path) throw Object.assign(new Error('Choose one statement file to upload.'), { code: 'STATEMENT_FILE_REQUIRED', status: 400 });
    if (process.env.NODE_ENV === 'production' && String(process.env.FINANCE_STATEMENT_DURABLE_STORAGE_REQUIRED || 'true').toLowerCase() !== 'false' && !objectStorageDocumentsEnabled()) {
      throw Object.assign(new Error('Private durable statement storage is not available. The file was not accepted.'), { code: 'FINANCE_DURABLE_STORAGE_REQUIRED', status: 503 });
    }
    const accountId = Number(req.params.id || 0);
    const [[account]] = await pool.query('SELECT * FROM bank_accounts WHERE id=? AND status="ACTIVE" LIMIT 1', [accountId]);
    if (!account) throw Object.assign(new Error('Active financial account not found.'), { code: 'BANK_ACCOUNT_NOT_FOUND', status: 404 });
    const body = await fs.promises.readFile(req.file.path);
    const detection = detectStatementFile(body, req.file.originalname, req.file.mimetype);
    const contentHash = sha256(body);
    const [[existing]] = await pool.query(
      `SELECT import_uid,status FROM statement_import_sessions WHERE bank_account_id=? AND content_hash=?
       UNION ALL SELECT import_uid,parse_status AS status FROM statement_import_files WHERE bank_account_id=? AND content_hash=? LIMIT 1`,
      [accountId, contentHash, accountId, contentHash]
    );
    if (existing) throw Object.assign(new Error(`This exact statement already exists as ${existing.import_uid}.`), { code: 'DUPLICATE_STATEMENT_FILE', status: 409, details: { import_uid: existing.import_uid, status: existing.status } });

    const importUid = uid('STMT');
    const correlationId = crypto.randomUUID();
    const mapping = parseMapping(req.body?.mapping);
    document = await registerDocument({
      module: 'finance', recordType: 'statement_import', recordId: importUid,
      ownerUserId: String(account.ownership_scope || '').toUpperCase() === 'BUSINESS' ? null : req.user.id,
      uploadedBy: req.user.id, file: req.file, classification: 'RESTRICTED'
    });
    if (document.content_sha256 !== contentHash) throw Object.assign(new Error('Server file-integrity verification failed.'), { code: 'STATEMENT_FILE_HASH_MISMATCH', status: 409 });

    db = await pool.getConnection();
    await db.beginTransaction();
    const [sessionInsert] = await db.query(
      `INSERT INTO statement_import_sessions
       (import_uid,bank_account_id,source_format,original_name,content_hash,status,created_by,secure_document_id,
        detected_mime,file_size_bytes,current_stage,progress_percent,correlation_id)
       VALUES (?,?,?,?,?,'QUEUED',?,?,?,?,'QUEUED',0,?)`,
      [importUid, accountId, detection.format, String(req.file.originalname || 'statement').slice(0, 255), contentHash,
        req.user.id, document.id, detection.detectedMime, detection.sizeBytes, correlationId]
    );
    const jobUuid = crypto.randomUUID();
    await db.query(
      `INSERT INTO finance_statement_import_jobs
       (job_uuid,import_session_id,idempotency_key,status,stage,progress_percent,max_attempts,mapping_json,correlation_id,requested_by)
       VALUES (?,? ,?,'QUEUED','QUEUED',0,?,?,?,?)`,
      [jobUuid, sessionInsert.insertId, sha256(`${accountId}|${contentHash}`), Math.max(1, Math.min(10, Number(process.env.FINANCE_INGESTION_MAX_ATTEMPTS || 5))), JSON.stringify(mapping), correlationId, req.user.id]
    );
    await logAudit(db, { ...actor(req), action: 'STATEMENT_FILE_UPLOADED', module: 'finance_intelligence', recordType: 'statement_import_session', recordId: importUid,
      newValue: { bank_account_id: accountId, source_format: detection.format, detected_mime: detection.detectedMime, size_bytes: detection.sizeBytes, secure_document_id: document.id, job_uuid: jobUuid, scan_status: document.scan_status } });
    await db.commit();
    setImmediate(() => triggerFinanceStatementIngestion(req.user.id).catch((error) => console.error('Finance ingestion trigger failed:', error.code || error.message)));
    return res.status(202).json({
      message: 'Statement stored privately and queued for secure server-side extraction.',
      import_uid: importUid,
      job: { job_uuid: jobUuid, status: 'QUEUED', stage: 'QUEUED', progress_percent: 0, correlation_id: correlationId },
      file: { document_id: document.id, format: detection.format, detected_mime: detection.detectedMime, size_bytes: detection.sizeBytes, scan_status: document.scan_status },
      status_url: `/api/finance/intelligence/statement-imports/${encodeURIComponent(importUid)}/status`
    });
  } catch (error) {
    if (db) await db.rollback().catch(() => {});
    if (document?.id) await removeDocumentInternal(document.id).catch(() => {});
    await removeTemporary(req.file);
    return fail(res, error, 'Statement upload failed');
  } finally { if (db) db.release(); }
};

exports.status = async (req, res) => {
  try {
    const [[row]] = await pool.query(
      `SELECT s.*,ba.nickname AS account_name,ba.ownership_scope,ba.currency AS account_currency,
              j.job_uuid,j.status AS job_status,j.stage AS job_stage,j.progress_percent AS job_progress,j.attempt,j.max_attempts,
              j.error_code AS job_error_code,j.error_summary AS job_error_summary,j.correlation_id AS job_correlation_id,
              j.heartbeat_at,j.completed_at AS job_completed_at
       FROM statement_import_sessions s JOIN bank_accounts ba ON ba.id=s.bank_account_id
       LEFT JOIN finance_statement_import_jobs j ON j.import_session_id=s.id WHERE s.import_uid=? LIMIT 1`,
      [req.params.uid]
    );
    if (!row) return res.status(404).json({ message: 'Statement import was not found.', code: 'STATEMENT_IMPORT_NOT_FOUND' });
    return res.json({ import: row, stalled: row.job_status === 'PROCESSING' && row.heartbeat_at && Date.now() - new Date(row.heartbeat_at).getTime() > 15 * 60 * 1000 });
  } catch (error) { return fail(res, error, 'Failed to load statement import status'); }
};

async function resume(req, res, options) {
  try {
    const [[session]] = await pool.query('SELECT * FROM statement_import_sessions WHERE import_uid=? LIMIT 1', [req.params.uid]);
    if (!session) return res.status(404).json({ message: 'Statement import was not found.', code: 'STATEMENT_IMPORT_NOT_FOUND' });
    if (['IMPORTED', 'CANCELLED', 'REVERSED'].includes(session.status)) return res.status(409).json({ message: `This import is ${session.status} and cannot be resumed.`, code: 'STATEMENT_IMPORT_LOCKED' });
    const fields = ["status='QUEUED'", "stage='QUEUED'", 'progress_percent=0', 'available_at=NOW()', 'locked_by=NULL', 'locked_at=NULL', 'error_code=NULL', 'error_summary=NULL'];
    const params = [];
    if (options.password !== undefined) { fields.push('encrypted_password=?'); params.push(options.password ? encryptSensitive(options.password) : null); }
    if (options.mapping !== undefined) { fields.push('mapping_json=?'); params.push(JSON.stringify(options.mapping)); }
    params.push(session.id);
    await pool.query(`UPDATE finance_statement_import_jobs SET ${fields.join(',')} WHERE import_session_id=?`, params);
    await pool.query("UPDATE statement_import_sessions SET status='QUEUED',current_stage='QUEUED',progress_percent=0,last_error_code=NULL,last_error_summary=NULL WHERE id=?", [session.id]);
    setImmediate(() => triggerFinanceStatementIngestion(req.user.id).catch((error) => console.error('Finance ingestion resume trigger failed:', error.code || error.message)));
    return res.status(202).json({ message: 'Statement processing was safely re-queued.', import_uid: session.import_uid, status: 'QUEUED' });
  } catch (error) { return fail(res, error, 'Failed to resume statement processing'); }
}

exports.password = async (req, res) => {
  const password = String(req.body?.password || '');
  if (!password || password.length > 256) return res.status(400).json({ message: 'Enter the PDF password (maximum 256 characters).', code: 'PDF_PASSWORD_REQUIRED' });
  return resume(req, res, { password });
};

exports.mapping = async (req, res) => resume(req, res, { mapping: parseMapping(req.body?.mapping || req.body) });
exports.retry = async (req, res) => resume(req, res, {});

exports.cancel = async (req, res) => {
  try {
    const [result] = await pool.query("UPDATE statement_import_sessions SET status='CANCELLED',current_stage='CANCELLED',progress_percent=100 WHERE import_uid=? AND status NOT IN ('IMPORTED','REVERSED','CANCELLED')", [req.params.uid]);
    if (!result.affectedRows) return res.status(409).json({ message: 'This import cannot be cancelled in its current state.', code: 'STATEMENT_IMPORT_CANCEL_NOT_ALLOWED' });
    await pool.query("UPDATE finance_statement_import_jobs j JOIN statement_import_sessions s ON s.id=j.import_session_id SET j.status='CANCELLED',j.stage='CANCELLED',j.progress_percent=100,j.completed_at=NOW(),j.encrypted_password=NULL WHERE s.import_uid=?", [req.params.uid]);
    await logAudit(pool, { ...actor(req), action: 'STATEMENT_IMPORT_CANCELLED', module: 'finance_intelligence', recordType: 'statement_import_session', recordId: req.params.uid });
    return res.json({ message: 'Statement import cancelled. The private source file and audit record were retained.' });
  } catch (error) { return fail(res, error, 'Failed to cancel statement import'); }
};

exports.metrics = async (_req, res) => {
  try {
    const queue = await financeStatementQueueHealth();
    const [[metrics]] = await pool.query(
      `SELECT COUNT(*) AS imports_started,
       SUM(status='IMPORTED') AS imports_completed,SUM(status IN ('FAILED','CANCELLED')) AS imports_failed,
       AVG(CASE WHEN processing_completed_at IS NOT NULL THEN TIMESTAMPDIFF(MICROSECOND,processing_started_at,processing_completed_at)/1000000 END) AS average_extraction_seconds,
       SUM(ocr_required=1) AS imports_using_ocr,SUM(rejected_rows) AS rows_requiring_review,SUM(duplicate_rows) AS duplicate_rows
       FROM statement_import_sessions`
    );
    const [[ocr]] = await pool.query("SELECT COUNT(*) AS ocr_pages_processed FROM statement_import_pages WHERE extraction_method='OCR'");
    return res.json({ metrics: { ...metrics, ...ocr, ...queue } });
  } catch (error) { return fail(res, error, 'Failed to load statement ingestion metrics'); }
};

exports.listMappings = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT template_uid,institution,source_format,template_name,mapping_json,parser_version,active,updated_at FROM finance_statement_mapping_templates WHERE owner_user_id=? AND active=1 ORDER BY institution,template_name', [req.user.id]);
    return res.json({ mapping_templates: rows });
  } catch (error) { return fail(res, error, 'Failed to load statement mapping templates'); }
};

exports.saveMapping = async (req, res) => {
  try {
    const mapping = parseMapping(req.body?.mapping);
    const institution = String(req.body?.institution || '').trim().slice(0, 180);
    const sourceFormat = String(req.body?.source_format || '').trim().toUpperCase().slice(0, 20);
    const name = String(req.body?.template_name || '').trim().slice(0, 180);
    if (!institution || !sourceFormat || !name) return res.status(400).json({ message: 'Institution, source format and template name are required.', code: 'MAPPING_TEMPLATE_FIELDS_REQUIRED' });
    const templateUid = crypto.randomUUID();
    await pool.query('INSERT INTO finance_statement_mapping_templates(template_uid,owner_user_id,institution,source_format,template_name,mapping_json,parser_version) VALUES (?,?,?,?,?,?,?)', [templateUid, req.user.id, institution, sourceFormat, name, JSON.stringify(mapping), 'finance-ingestion-v1']);
    return res.status(201).json({ message: 'Mapping template saved.', template_uid: templateUid });
  } catch (error) { return fail(res, error, 'Failed to save statement mapping template'); }
};

module.exports.parseMapping = parseMapping;
