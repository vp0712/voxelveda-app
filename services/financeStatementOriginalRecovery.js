'use strict';

const crypto = require('node:crypto');
const { logAudit } = require('./auditService');

// Called inside the upload transaction after the original bytes have passed
// private storage and malware checks. A re-upload restores evidence only;
// posted transactions still require the separate source-verification action.
async function attachOriginalSource(db, { accountId, importUid, contentHash, document, detection, mapping = {}, actor, maxAttempts = 5 }) {
  if (!document?.id || document.content_sha256 !== contentHash) {
    throw Object.assign(new Error('The uploaded original does not match the statement fingerprint.'), { status: 409, code: 'STATEMENT_FILE_HASH_MISMATCH' });
  }
  const [[account]] = await db.query('SELECT id FROM bank_accounts WHERE id=? AND status="ACTIVE" FOR UPDATE', [accountId]);
  if (!account) throw Object.assign(new Error('The statement account is no longer active.'), { status: 409, code: 'BANK_ACCOUNT_NOT_ACTIVE' });
  const [[session]] = await db.query(`SELECT * FROM statement_import_sessions WHERE bank_account_id=? AND import_uid=? AND content_hash=?
    AND status NOT IN ('REMOVED','REVERSED','CANCELLED') FOR UPDATE`, [accountId,importUid,contentHash]);
  const [[file]] = await db.query(`SELECT * FROM statement_import_files WHERE bank_account_id=? AND import_uid=? AND content_hash=?
    AND parse_status<>'REMOVED' FOR UPDATE`, [accountId,importUid,contentHash]);
  if (!session && !file) throw Object.assign(new Error('The statement changed while its original was being restored. Reload and try again.'), { status: 409, code: 'STATEMENT_CHANGED' });
  const posted = file?.parse_status === 'IMPORTED' || session?.status === 'IMPORTED';
  if (file?.secure_document_id || session?.secure_document_id) return { attached: false, queued: false, status: posted ? 'IMPORTED' : session?.status };
  const values = [document.id,detection.detectedMime,detection.sizeBytes];
  if (file) await db.query('UPDATE statement_import_files SET secure_document_id=?,detected_mime=?,file_size_bytes=? WHERE id=?', [...values,file.id]);
  if (session) await db.query('UPDATE statement_import_sessions SET secure_document_id=?,detected_mime=?,file_size_bytes=? WHERE id=?', [...values,session.id]);
  const queued = Boolean(session && !posted);
  if (queued) {
    const key = crypto.createHash('sha256').update(`RESTORE|${accountId}|${contentHash}|${session.id}`).digest('hex');
    await db.query(`INSERT INTO finance_statement_import_jobs
      (job_uuid,import_session_id,idempotency_key,status,stage,progress_percent,max_attempts,mapping_json,correlation_id,requested_by)
      VALUES (?,?,?,'QUEUED','QUEUED',0,?,?,?,?)
      ON DUPLICATE KEY UPDATE status='QUEUED',stage='QUEUED',progress_percent=0,attempt=0,available_at=NOW(),
      locked_by=NULL,locked_at=NULL,error_code=NULL,error_summary=NULL,completed_at=NULL,mapping_json=VALUES(mapping_json),requested_by=VALUES(requested_by)`,
      [crypto.randomUUID(),session.id,key,maxAttempts,JSON.stringify(mapping),crypto.randomUUID(),actor.actorId]);
    await db.query("UPDATE statement_import_sessions SET status='QUEUED',current_stage='QUEUED',progress_percent=0,last_error_code=NULL,last_error_summary=NULL WHERE id=?", [session.id]);
  }
  await logAudit(db, { ...actor, action:'STATEMENT_ORIGINAL_RESTORED', module:'finance_intelligence', recordType:'statement_import_session', recordId:importUid,
    newValue:{secure_document_id:document.id,source_file_hash:contentHash,queued,posted_transactions_unchanged:posted} });
  return { attached:true, queued, status:posted?'IMPORTED':'QUEUED' };
}

module.exports = { attachOriginalSource };
