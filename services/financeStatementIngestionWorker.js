'use strict';

const os = require('node:os');
const pool = require('../config/db');
const { logAudit } = require('./auditService');
const { backgroundJobService } = require('./backgroundJobService');
const { decryptSensitive } = require('./financeEncryptionService');
const { readDocumentBodyInternal } = require('./documentSecurityService');
const { parseStatementBuffer, shutdownOcrWorker } = require('./financeStatementParser');
const { evaluateStatement } = require('./financeStatementValidation');
const statementReview = require('../controllers/statementImportController');

const WORKER_KEY = 'finance.statement-ingestion';
const workerIdentity = `finance-ingestion:${os.hostname()}:${process.pid}`.slice(0, 120);

function enabled() {
  return String(process.env.FINANCE_INGESTION_WORKER_ENABLED || 'true').toLowerCase() !== 'false';
}

function safeError(error) {
  return {
    code: String(error?.code || 'STATEMENT_PROCESSING_FAILED').replace(/[^A-Z0-9_.-]/gi, '_').slice(0, 100),
    summary: String(error?.message || 'Statement processing failed').replace(/(password|secret|token|authorization|cookie)\s*[=:]\s*[^\s;,]+/gi, '$1=[redacted]').slice(0, 1000)
  };
}

async function claimNextJob() {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const staleMinutes = Math.max(5, Math.min(120, Number(process.env.FINANCE_INGESTION_STALE_MINUTES || 15)));
    await db.query(
      `UPDATE finance_statement_import_jobs j
       JOIN statement_import_sessions s ON s.id=j.import_session_id
       SET j.status='RETRY',j.stage='STALE_JOB_RECOVERY',j.available_at=NOW(),j.locked_by=NULL,j.locked_at=NULL,
           j.error_code='STALE_JOB_RECOVERED',j.error_summary='The prior worker heartbeat expired; processing will resume safely.',
           s.status='QUEUED',s.current_stage='STALE_JOB_RECOVERY',s.last_error_code='STALE_JOB_RECOVERED'
       WHERE j.status='PROCESSING' AND j.heartbeat_at < DATE_SUB(NOW(),INTERVAL ? MINUTE)`,
      [staleMinutes]
    );
    const [[job]] = await db.query(
      `SELECT j.*,s.import_uid,s.bank_account_id,s.secure_document_id,s.original_name,s.detected_mime,s.content_hash,
              ba.currency AS account_currency,ba.account_type,ba.ownership_scope
       FROM finance_statement_import_jobs j
       JOIN statement_import_sessions s ON s.id=j.import_session_id
       JOIN bank_accounts ba ON ba.id=s.bank_account_id
       WHERE j.status IN ('QUEUED','RETRY') AND j.available_at<=NOW() AND s.status NOT IN ('IMPORTED','CANCELLED','REVERSED')
       ORDER BY j.available_at,j.id LIMIT 1 FOR UPDATE SKIP LOCKED`
    );
    if (!job) { await db.commit(); return null; }
    if (Number(job.attempt || 0) >= Number(job.max_attempts || 5)) {
      await db.query("UPDATE finance_statement_import_jobs SET status='DEAD_LETTER',stage='FAILED',completed_at=NOW(),error_code='MAX_ATTEMPTS_EXCEEDED',error_summary='Statement processing exhausted its retry limit.' WHERE id=?", [job.id]);
      await db.query("UPDATE statement_import_sessions SET status='FAILED',current_stage='FAILED',last_error_code='MAX_ATTEMPTS_EXCEEDED',last_error_summary='Statement processing exhausted its retry limit.' WHERE id=?", [job.import_session_id]);
      await db.commit();
      return null;
    }
    await db.query(
      `UPDATE finance_statement_import_jobs SET status='PROCESSING',stage='SECURITY_CHECKING',progress_percent=2,
       attempt=attempt+1,locked_by=?,locked_at=NOW(),heartbeat_at=NOW(),error_code=NULL,error_summary=NULL WHERE id=?`,
      [workerIdentity, job.id]
    );
    await db.query(
      `UPDATE statement_import_sessions SET status='SECURITY_CHECKING',current_stage='SECURITY_CHECKING',progress_percent=2,
       processing_started_at=COALESCE(processing_started_at,NOW()),last_error_code=NULL,last_error_summary=NULL WHERE id=?`,
      [job.import_session_id]
    );
    await db.commit();
    return { ...job, attempt: Number(job.attempt || 0) + 1 };
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }
}

async function progress(job, event) {
  const stages = { SECURITY_CHECKING: 5, CLASSIFYING: 12, EXTRACTING: 28, OCR_REQUIRED: 42, PARSING: 58, NORMALISING: 72, VALIDATING: 84, PERSISTING: 92 };
  const stage = String(event?.stage || 'PROCESSING').slice(0, 40);
  let percentage = stages[stage] || Number(event?.progress || 10);
  if (event?.page && event?.totalPages) percentage = Math.min(80, Math.max(percentage, 20 + Math.round((Number(event.page) / Number(event.totalPages)) * 55)));
  await pool.query('UPDATE finance_statement_import_jobs SET stage=?,progress_percent=?,heartbeat_at=NOW() WHERE id=? AND status="PROCESSING"', [stage, percentage, job.id]);
  await pool.query('UPDATE statement_import_sessions SET status=?,current_stage=?,progress_percent=? WHERE id=?', [stage === 'OCR_REQUIRED' ? 'OCR_REQUIRED' : stage === 'PARSING' ? 'PARSING' : 'EXTRACTING', stage, percentage, job.import_session_id]);
}

async function persistResult(job, parsed, validation) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[session]] = await db.query('SELECT * FROM statement_import_sessions WHERE id=? FOR UPDATE', [job.import_session_id]);
    if (!session) throw Object.assign(new Error('Statement import session was not found.'), { code: 'STATEMENT_SESSION_NOT_FOUND' });
    if (['IMPORTED', 'CANCELLED', 'REVERSED'].includes(session.status)) { await db.commit(); return { skipped: true, reason: session.status }; }
    const [[account]] = await db.query('SELECT * FROM bank_accounts WHERE id=? AND status="ACTIVE" FOR UPDATE', [session.bank_account_id]);
    if (!account) throw Object.assign(new Error('The selected financial account is no longer active.'), { code: 'BANK_ACCOUNT_NOT_ACTIVE' });

    await db.query('DELETE FROM statement_duplicate_candidates WHERE import_session_id=?', [session.id]);
    await db.query('DELETE FROM statement_validation_results WHERE import_session_id=?', [session.id]);
    await db.query('DELETE FROM statement_import_pages WHERE import_session_id=?', [session.id]);
    await db.query('DELETE FROM statement_import_rows WHERE import_session_id=?', [session.id]);

    const sourceRows = (parsed.rows || []).map((row) => ({ ...row, source_file_id: session.secure_document_id, parser_name: parsed.parserName, parser_version: parsed.parserVersion }));
    const prepared = await statementReview._ingestion.normalizeAndDedupe(db, account, sourceRows);
    await statementReview._ingestion.insertReviewRows(db, session.id, prepared.normalized);

    for (const page of parsed.pages || []) {
      await db.query(
        `INSERT INTO statement_import_pages
         (import_session_id,secure_document_id,page_number,extraction_method,text_content,word_count,confidence,width_pixels,height_pixels)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [session.id, session.secure_document_id, page.page_number, page.extraction_method, page.text_content || null, Number(page.word_count || 0), page.confidence ?? null, page.width_pixels || null, page.height_pixels || null]
      );
    }
    for (const item of validation.validations || []) {
      await db.query(
        `INSERT INTO statement_validation_results
         (import_session_id,validation_key,status,expected_value,actual_value,difference_value,detail)
         VALUES (?,?,?,?,?,?,?)`,
        [session.id, item.check, item.status, item.expected, item.actual, item.difference, item.detail]
      );
    }

    const [duplicateRows] = await db.query("SELECT id,row_hash,duplicate_status FROM statement_import_rows WHERE import_session_id=? AND validation_status='DUPLICATE'", [session.id]);
    for (const row of duplicateRows) {
      const [[existing]] = await db.query('SELECT id FROM bank_transactions WHERE bank_account_id=? AND row_hash=? LIMIT 1', [account.id, row.row_hash]);
      await db.query(
        `INSERT IGNORE INTO statement_duplicate_candidates
         (import_session_id,statement_row_id,existing_bank_transaction_id,match_class,match_score,explanation)
         VALUES (?,?,?,?,?,?)`,
        [session.id, row.id, existing?.id || null, row.duplicate_status === 'EXACT_DUPLICATE' ? 'EXACT_DUPLICATE' : 'PROBABLE_DUPLICATE', row.duplicate_status === 'EXACT_DUPLICATE' ? 1 : 0.95, existing ? 'Account, normalised date, amount, description/reference and row fingerprint match an existing posted transaction.' : 'The same normalised transaction appears more than once in this uploaded file.']
      );
    }

    const classification = parsed.classification || {};
    const counts = prepared.counts;
    const dates = prepared.normalized.map((row) => row.transaction_date).filter(Boolean).sort();
    const needsReview = !validation.validForAutomaticReview || counts.warning > 0 || counts.rejected > 0 || counts.duplicate > 0;
    const finalStatus = parsed.needsMapping ? 'NEEDS_MAPPING' : 'PENDING_REVIEW';
    const finalStage = parsed.needsMapping ? 'NEEDS_MAPPING' : needsReview ? 'NEEDS_REVIEW' : 'VALID';
    await db.query(
      `UPDATE statement_import_sessions SET
       source_format=?,detected_mime=?,file_size_bytes=?,document_type=?,institution=?,masked_account_identifier=?,statement_currency=?,
       statement_start_date=?,statement_end_date=?,opening_balance=?,closing_balance=?,page_count=?,selectable_text=?,ocr_required=?,
       multiple_accounts=?,multiple_currencies=?,appears_incomplete=?,status=?,current_stage=?,progress_percent=100,total_rows=?,valid_rows=?,
       warning_rows=?,duplicate_rows=?,rejected_rows=?,parser_version=?,parser_confidence=?,reconciliation_status=?,reconciliation_difference=?,
       extraction_diagnostics_json=?,processing_completed_at=NOW(),last_error_code=NULL,last_error_summary=NULL WHERE id=?`,
      [parsed.format, parsed.detectedMime, parsed.sizeBytes, classification.document_type, classification.institution, classification.masked_account_identifier, classification.statement_currency || account.currency,
        classification.statement_start_date || dates[0] || null, classification.statement_end_date || dates[dates.length - 1] || null,
        classification.opening_balance, classification.closing_balance, classification.page_count || parsed.pages?.length || 1, classification.selectable_text ? 1 : 0, classification.ocr_required ? 1 : 0,
        classification.multiple_accounts ? 1 : 0, classification.multiple_currencies ? 1 : 0, classification.appears_incomplete ? 1 : 0,
        finalStatus, finalStage, prepared.normalized.length, counts.valid, counts.warning, counts.duplicate, counts.rejected,
        parsed.parserVersion, parsed.parserConfidence, validation.reconciliationStatus, validation.totals.reconciliation_difference,
        JSON.stringify({ parser_name: parsed.parserName, warnings: parsed.warnings || [], headers: parsed.headers || [], totals: validation.totals }), session.id]
    );
    await db.query("UPDATE finance_statement_import_jobs SET status='COMPLETED',stage=?,progress_percent=100,completed_at=NOW(),heartbeat_at=NOW(),encrypted_password=NULL,error_code=NULL,error_summary=NULL WHERE id=?", [finalStage, job.id]);
    await logAudit(db, {
      actorId: job.requested_by,
      requestId: job.correlation_id,
      action: 'STATEMENT_INGESTION_COMPLETED', module: 'finance_intelligence', recordType: 'statement_import_session', recordId: session.import_uid,
      newValue: { source_format: parsed.format, parser_name: parsed.parserName, parser_version: parsed.parserVersion, total_rows: prepared.normalized.length, ...counts, reconciliation_status: validation.reconciliationStatus, ocr_required: Boolean(classification.ocr_required) }
    });
    await db.commit();
    return { processed: prepared.normalized.length, status: finalStatus, stage: finalStage, counts };
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }
}

async function failJob(job, error) {
  const safe = safeError(error);
  const passwordFailure = ['PDF_PASSWORD_REQUIRED', 'PDF_PASSWORD_INVALID'].includes(safe.code);
  const mappingFailure = safe.code === 'STATEMENT_MAPPING_REQUIRED';
  const retryable = !passwordFailure && !mappingFailure && ['OBJECT_STORAGE_REQUEST_FAILED', 'STORED_DOCUMENT_SECURITY_PENDING', 'ER_LOCK_DEADLOCK', 'ETIMEDOUT'].includes(safe.code) && job.attempt < Number(job.max_attempts || 5);
  const status = passwordFailure ? 'NEEDS_PASSWORD' : mappingFailure ? 'NEEDS_MAPPING' : retryable ? 'RETRY' : job.attempt >= Number(job.max_attempts || 5) ? 'DEAD_LETTER' : 'FAILED';
  const delay = Math.min(3600, 30 * (2 ** Math.max(0, job.attempt - 1)));
  await pool.query(
    `UPDATE finance_statement_import_jobs SET status=?,stage=?,progress_percent=CASE WHEN ?='RETRY' THEN progress_percent ELSE 100 END,
     available_at=CASE WHEN ?='RETRY' THEN DATE_ADD(NOW(),INTERVAL ? SECOND) ELSE available_at END,
     completed_at=CASE WHEN ? IN ('FAILED','DEAD_LETTER') THEN NOW() ELSE completed_at END,
     encrypted_password=CASE WHEN ?='PDF_PASSWORD_INVALID' THEN NULL ELSE encrypted_password END,
     error_code=?,error_summary=?,heartbeat_at=NOW(),locked_by=NULL,locked_at=NULL WHERE id=?`,
    [status, status, status, status, delay, status, safe.code, safe.code, safe.summary, job.id]
  );
  await pool.query('UPDATE statement_import_sessions SET status=?,current_stage=?,progress_percent=?,last_error_code=?,last_error_summary=? WHERE id=?', [status, status, status === 'RETRY' ? 70 : 100, safe.code, safe.summary, job.import_session_id]);
  await pool.query(
    `INSERT INTO processing_errors (correlation_id,scope_type,scope_id,stage,error_code,error_summary,retry_safe,created_at)
     VALUES (?,?,?,?,?,?,?,NOW())`,
    [job.correlation_id, 'STATEMENT_IMPORT', job.import_uid, status, safe.code, safe.summary, retryable ? 1 : 0]
  ).catch((insertError) => { if (insertError.code !== 'ER_NO_SUCH_TABLE') throw insertError; });
  return { failed: 1, status, errorCode: safe.code };
}

async function processClaimedJob(job) {
  try {
    await progress(job, { stage: 'SECURITY_CHECKING' });
    const stored = await readDocumentBodyInternal(job.secure_document_id);
    if (stored.contentSha256 !== job.content_hash) throw Object.assign(new Error('Stored file hash does not match the import session.'), { code: 'STATEMENT_FILE_HASH_MISMATCH' });
    const mapping = job.mapping_json ? (typeof job.mapping_json === 'string' ? JSON.parse(job.mapping_json) : job.mapping_json) : {};
    const password = job.encrypted_password ? decryptSensitive(job.encrypted_password) : null;
    const parsed = await parseStatementBuffer(stored.body, { originalName: job.original_name, mimeType: job.detected_mime || stored.document.mime_type }, { mapping, password, currency: job.account_currency }, (event) => { progress(job, event).catch(() => {}); });
    await progress(job, { stage: 'VALIDATING' });
    const validation = evaluateStatement({ rows: parsed.rows, classification: parsed.classification, account: job });
    await progress(job, { stage: 'PERSISTING' });
    return await persistResult(job, parsed, validation);
  } catch (error) { return failJob(job, error); }
}

async function processFinanceStatementQueueCycle() {
  const batch = Math.max(1, Math.min(4, Number(process.env.FINANCE_INGESTION_BATCH_SIZE || 1)));
  const outcomes = [];
  for (let index = 0; index < batch; index += 1) {
    const job = await claimNextJob();
    if (!job) break;
    outcomes.push(await processClaimedJob(job));
  }
  return { processed: outcomes.reduce((sum, outcome) => sum + Number(outcome.processed || 0), 0), failed: outcomes.reduce((sum, outcome) => sum + Number(outcome.failed || 0), 0), outcomes };
}

const scheduler = backgroundJobService.createScheduler({
  jobKey: WORKER_KEY,
  description: 'Secure Finance statement classification, extraction, OCR, validation and review staging',
  intervalMs: () => Math.max(2000, Number(process.env.FINANCE_INGESTION_POLL_MS || 5000)),
  initialDelayMs: () => Math.max(1000, Number(process.env.FINANCE_INGESTION_INITIAL_DELAY_MS || 3000)),
  leaseMs: Math.max(120000, Number(process.env.FINANCE_INGESTION_LEASE_MS || 900000)),
  maxAttempts: 5,
  enabled,
  handler: processFinanceStatementQueueCycle
});

function startFinanceStatementIngestionWorker() { return scheduler.start(); }
function stopFinanceStatementIngestionWorker() { scheduler.stop(); return shutdownOcrWorker(); }
function triggerFinanceStatementIngestion(requestedBy) {
  // A newly accepted upload must be able to recover the scheduler after a
  // prior infrastructure dead letter; row/job idempotency still prevents
  // duplicate parsing or posting.
  return scheduler.run({ trigger: 'MANUAL', requestedBy, force: true, resetAttempts: true });
}

async function financeStatementQueueHealth() {
  const [[metrics]] = await pool.query(
    `SELECT COUNT(*) AS total_jobs,
      SUM(status='QUEUED') AS queued_jobs,SUM(status='PROCESSING') AS active_jobs,
      SUM(status IN ('FAILED','DEAD_LETTER')) AS failed_jobs,
      MIN(CASE WHEN status IN ('QUEUED','RETRY') THEN created_at END) AS oldest_queued_at,
      MAX(CASE WHEN status='PROCESSING' THEN heartbeat_at END) AS latest_worker_heartbeat
     FROM finance_statement_import_jobs`
  );
  return { enabled: enabled(), worker_key: WORKER_KEY, ...metrics };
}

module.exports = {
  WORKER_KEY,
  claimNextJob,
  financeStatementQueueHealth,
  processClaimedJob,
  processFinanceStatementQueueCycle,
  startFinanceStatementIngestionWorker,
  stopFinanceStatementIngestionWorker,
  triggerFinanceStatementIngestion
};
