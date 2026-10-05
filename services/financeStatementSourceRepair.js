'use strict';

const crypto = require('node:crypto');
const pool = require('../config/db');
const money = require('../utils/money');
const { logAudit } = require('./auditService');
const { readDocumentBodyInternal } = require('./documentSecurityService');
const { parseStatementBuffer, PARSER_VERSION } = require('./financeStatementParser');
const { evaluateStatement } = require('./financeStatementValidation');
const { normalizeRow, statementRowHash, semanticTransactionKey, insertReviewRows, countRows } = require('../controllers/statementImportController')._ingestion;

function originalRow(row) {
  if (row.original_transaction_date === null || row.original_transaction_date === undefined) return row;
  return {
    ...row,
    transaction_date: row.original_transaction_date,
    description: row.original_description,
    reference: row.original_reference,
    debit: row.original_debit,
    credit: row.original_credit,
    running_balance: row.original_running_balance
  };
}
function fingerprint(accountId, row) { return statementRowHash(accountId, { ...row, source_occurrence: 1 }); }
function sourceSnippet(row) {
  const value = row.original_payload_json;
  let payload = value;
  try { if (typeof value === 'string') payload = JSON.parse(value); } catch { payload = null; }
  return String(payload?.source_snippet || payload?.raw?.source_snippet || '');
}
function isProvenArtifact(row, sourceKeys, accountId) {
  if (row.archived_at || row.reconciliation_status === 'IGNORED' || Number(row.manual_override || 0)) return false;
  const original = originalRow(row);
  if (fingerprint(accountId, row) !== fingerprint(accountId, original) || sourceKeys.has(fingerprint(accountId, original))) return false;
  return /\bbalance\s+as\s+(?:of|at)\b|^(?:\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}\s+)?(?:page\s+)?(?:sub)?totals?\s*(?:[:$€£₹\d]|withdrawals?\b|deposits?\b|debits?\b|credits?\b)|^(?:opening|closing)\s+balance\b/i.test(sourceSnippet(row) || String(original.description || ''));
}

function planSourceRepair(account, parsed, statementRows = [], accountRows = [], reviewRows = []) {
  const validation = evaluateStatement({ rows: parsed.rows, classification: parsed.classification, account });
  const occurrences = new Map();
  const source = parsed.rows.map((raw, index) => {
    const key = fingerprint(account.id, raw), occurrence = (occurrences.get(key) || 0) + 1;
    occurrences.set(key, occurrence);
    return normalizeRow(account.id, account.currency, { ...raw, source_occurrence: semanticTransactionKey(account.id, raw) ? 1 : occurrence, parser_name: parsed.parserName, parser_version: parsed.parserVersion }, index + 1);
  }).filter(row => ['VALID','WARNING'].includes(row.validation_status));
  const sourceKeys = new Set(source.map(row => fingerprint(account.id, row)));
  const artifacts = statementRows.filter(row => isProvenArtifact(row, sourceKeys, account.id));
  const artifactIds = new Set(artifacts.map(row => Number(row.id)));
  const counts = new Map();
  for (const row of accountRows) {
    if (artifactIds.has(Number(row.id))) continue;
    const key = fingerprint(account.id, originalRow(row));
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const missing = [];
  for (const row of source) {
    const key = fingerprint(account.id, row), count = counts.get(key) || 0;
    if (count) counts.set(key, count - 1); else missing.push(row);
  }
  const unexpected = statementRows.filter(row => !artifactIds.has(Number(row.id)) && !sourceKeys.has(fingerprint(account.id, originalRow(row))));
  const noFailures = !validation.validations.some(item => item.status === 'FAIL');
  const sourceConsistent = noFailures && !parsed.classification.multiple_accounts && !parsed.classification.multiple_currencies
    && !parsed.classification.appears_incomplete && validation.validations.some(item => item.check === 'CURRENCY_CONSISTENCY' && item.status === 'PASS');
  const printedTotalsVerified = ['PRINTED_TOTAL_DEBITS','PRINTED_TOTAL_CREDITS'].every(key => validation.validations.some(item => item.check === key && item.status === 'PASS'));
  // Additional rows require two independent printed totals and no unexplained
  // ledger differences. Archived/user-corrected rows are never overwritten.
  const existingSemantic = new Set(accountRows.map(row => semanticTransactionKey(account.id, originalRow(row))).filter(Boolean));
  const deliberatelyExcluded = new Set(reviewRows.filter(row => !row.final_posted_transaction_id && !Number(row.selected)
    && row.validation_status !== 'DUPLICATE').map(row => fingerprint(account.id,row)));
  const safeMissing = sourceConsistent && printedTotalsVerified && !unexpected.length
    ? missing.filter(row => { const key = semanticTransactionKey(account.id,row); return !deliberatelyExcluded.has(fingerprint(account.id,row)) && (!key || !existingSemantic.has(key)); }) : [];
  return { validation, source, artifacts: sourceConsistent ? artifacts : [], missing: safeMissing, unverifiedMissing: missing.length - safeMissing.length, unexpected: unexpected.length };
}

async function readSource(file) {
  if (!file.secure_document_id) throw Object.assign(new Error('This legacy import has no retained original file. Re-upload the original document for source verification.'), { statusCode: 422, code: 'STATEMENT_ORIGINAL_UNAVAILABLE' });
  const stored = await readDocumentBodyInternal(file.secure_document_id);
  if (stored.contentSha256 !== file.content_hash) throw Object.assign(new Error('The retained original does not match the statement fingerprint.'), { statusCode: 422, code: 'STATEMENT_FILE_HASH_MISMATCH' });
  return parseStatementBuffer(stored.body, { originalName: file.original_name, mimeType: stored.document.mime_type }, { currency: file.currency });
}
async function ledgerRows(db, accountId) {
  const [rows] = await db.query(`SELECT bt.*,od.original_transaction_date,od.original_description,od.original_reference,
    od.original_debit,od.original_credit,od.original_running_balance,od.original_payload_json
    FROM bank_transactions bt LEFT JOIN bank_transaction_original_data od ON od.bank_transaction_id=bt.id
    WHERE bt.bank_account_id=? ORDER BY bt.id`, [accountId]);
  return rows;
}

async function verifyStoredStatement(file, { apply = false, actorId = null } = {}) {
  const parsed = await readSource(file);
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[account]] = await db.query('SELECT * FROM bank_accounts WHERE id=? AND status="ACTIVE" FOR UPDATE', [file.bank_account_id]);
    if (!account) throw Object.assign(new Error('The source account is not active.'), { statusCode: 409, code: 'BANK_ACCOUNT_NOT_ACTIVE' });
    const [[currentFile]] = await db.query('SELECT * FROM statement_import_files WHERE import_uid=? AND parse_status="IMPORTED" FOR UPDATE', [file.import_uid]);
    if (!currentFile || currentFile.content_hash !== file.content_hash) throw Object.assign(new Error('Statement history changed during verification. Reload and try again.'), { statusCode: 409, code: 'STATEMENT_CHANGED' });
    const [[session]] = await db.query('SELECT * FROM statement_import_sessions WHERE import_uid=? FOR UPDATE', [file.import_uid]);
    const allLedger = await ledgerRows(db, account.id);
    const ownLedger = allLedger.filter(row => row.statement_import_uid === file.import_uid);
    const [reviewRows] = session ? await db.query('SELECT * FROM statement_import_rows WHERE import_session_id=? ORDER BY row_no', [session.id]) : [[]];
    const plan = planSourceRepair(account, parsed, ownLedger, allLedger, reviewRows);
    const repairable = Boolean(session && (plan.artifacts.length || plan.missing.length));
    let added = 0, archived = 0;
    if (apply && repairable && session) {
      const actor = actorId || file.reviewed_by || file.uploaded_by || session.created_by;
      for (const row of plan.artifacts) {
        await db.query(`UPDATE bank_transactions SET archived_at=NOW(),archived_by=?,archive_reason=?,
          pre_archive_reconciliation_status=reconciliation_status,pre_archive_ignored_reason=ignored_reason,
          reconciliation_status='IGNORED',ignored_reason='Source evidence repair: header or subtotal is not a transaction'
          WHERE id=? AND archived_at IS NULL`, [actor, 'Verified against the original statement: header/balance/total artifact', row.id]);
        await db.query("UPDATE statement_import_rows SET validation_status='REJECTED',selected=0,validation_message='Verified source header or total; excluded from active calculations' WHERE final_posted_transaction_id=?", [row.id]);
        if (row.import_batch_uid) await db.query('UPDATE bank_import_batches SET imported_rows=GREATEST(0,imported_rows-1) WHERE batch_uid=?', [row.import_batch_uid]);
        await logAudit(db, { actorId: actor, action: 'STATEMENT_SOURCE_ARTIFACT_ARCHIVED', module: 'finance_intelligence', recordType: 'bank_transaction', recordId: row.id, oldValue: { debit: row.debit, credit: row.credit, reconciliation_status: row.reconciliation_status }, newValue: { archived: true, reversible: true, parser_version: PARSER_VERSION, source_file_hash: parsed.fileHash } });
        archived += 1;
      }
      let rowNo = Math.max(0, ...reviewRows.map(row => Number(row.row_no || 0)));
      const batch = ownLedger.find(item => item.import_batch_uid)?.import_batch_uid || `REPAIR-${crypto.randomBytes(8).toString('hex')}`;
      if (plan.missing.length) {
        await db.query('INSERT IGNORE INTO bank_import_batches (batch_uid,bank_account_id,original_name,imported_rows,imported_by) VALUES (?,?,?,0,?)', [batch,account.id,file.original_name,actor]);
      }
      for (const sourceRow of plan.missing) {
        const row = { ...sourceRow, source_file_id: file.secure_document_id };
        let reviewRow = reviewRows.find(item => !item.final_posted_transaction_id && fingerprint(account.id, item) === fingerprint(account.id, row));
        if (!reviewRow) {
          row.row_no = ++rowNo;
          await insertReviewRows(db, session.id, [row]);
          [[reviewRow]] = await db.query('SELECT * FROM statement_import_rows WHERE import_session_id=? AND row_no=?', [session.id, row.row_no]);
          reviewRows.push(reviewRow);
        }
        const [insert] = await db.query(`INSERT IGNORE INTO bank_transactions
          (bank_account_id,import_batch_uid,row_hash,transaction_date,posting_date,description,reference,debit,credit,running_balance,
           source_type,source_provider,merchant_name,currency,ownership_scope,category,classification_status,statement_import_uid,statement_row_id,review_source_status,imported_by)
          VALUES (?,?,?,?,?,?,?,?,?,?,'STATEMENT_IMPORT',?,?,?,?,?,?,?,?,?,?)`,
          [account.id,batch,row.row_hash,row.transaction_date,row.posting_date,row.description,row.reference,row.debit,row.credit,row.running_balance,
            file.source_format,row.merchant_name,row.currency,account.ownership_scope,row.category,row.category?'CLASSIFIED':'UNCLASSIFIED',file.import_uid,reviewRow.id,row.validation_status,actor]);
        if (!insert.affectedRows) continue;
        await db.query(`INSERT INTO bank_transaction_original_data
          (bank_transaction_id,bank_account_id,source_type,source_statement_uid,source_statement_row_id,original_transaction_date,
           original_posting_date,original_description,original_merchant_string,original_reference,original_bank_category,
           original_debit,original_credit,original_running_balance,original_currency,original_payload_json,captured_by)
          VALUES (?,?,'STATEMENT_IMPORT',?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [insert.insertId,account.id,file.import_uid,reviewRow.id,row.transaction_date,row.posting_date,row.description,row.merchant_name,row.reference,row.category,row.debit,row.credit,row.running_balance,row.currency,row.original_extracted_json||row.raw_payload_json,actor]);
        await db.query("UPDATE statement_import_rows SET row_hash=?,validation_status=?,selected=1,review_status='POSTED',duplicate_status=NULL,final_posted_transaction_id=?,validation_message='Source transaction recovered after both printed totals were verified' WHERE id=?", [row.row_hash,row.validation_status,insert.insertId,reviewRow.id]);
        reviewRow.final_posted_transaction_id = insert.insertId;
        await logAudit(db, { actorId: actor, action: 'STATEMENT_SOURCE_TRANSACTION_RECOVERED', module: 'finance_intelligence', recordType: 'bank_transaction', recordId: insert.insertId, newValue: { debit: row.debit, credit: row.credit, parser_version: PARSER_VERSION, source_file_hash: parsed.fileHash, source_row_id: reviewRow.id } });
        added += 1;
      }
      const [freshRows] = await db.query('SELECT * FROM statement_import_rows WHERE import_session_id=?', [session.id]);
      const counts = countRows(freshRows);
      if (added) await db.query('UPDATE bank_import_batches SET imported_rows=imported_rows+? WHERE batch_uid=?', [added,batch]);
      await db.query('UPDATE statement_import_sessions SET total_rows=?,valid_rows=?,warning_rows=?,duplicate_rows=?,rejected_rows=? WHERE id=?', [freshRows.length,counts.valid,counts.warning,counts.duplicate,counts.rejected,session.id]);
      await db.query('UPDATE statement_import_files SET imported_rows=GREATEST(0,imported_rows+?),rejected_rows=?,duplicate_rows=?,parser_version=?,reconciliation_status=? WHERE import_uid=?', [added-archived,counts.rejected,counts.duplicate,PARSER_VERSION,plan.validation.reconciliationStatus,file.import_uid]);
      await db.query('UPDATE statement_import_sessions SET parser_version=?,extraction_diagnostics_json=?,reconciliation_status=? WHERE id=?', [PARSER_VERSION,JSON.stringify({parser_name:parsed.parserName,classification:parsed.classification,totals:plan.validation.totals,source_repair:{added,archived}}),plan.validation.reconciliationStatus,session.id]);
      const reportedBalance = parsed.classification.closing_balance ?? parsed.classification.reported_balance_as_of;
      if (reportedBalance !== null && reportedBalance !== undefined && (!account.history_end_date || String(parsed.classification.statement_end_date || '') >= String(account.history_end_date).slice(0,10))) {
        await db.query('UPDATE bank_accounts SET current_ledger_balance=?,available_balance=CASE WHEN connection_type="MANUAL" OR connection_status="MANUAL" THEN ? ELSE available_balance END WHERE id=?', [money.fromCents(money.toCents(reportedBalance)),reportedBalance,account.id]);
      }
    }
    await db.commit();
    return { source_rows: parsed.rows.length, artifact_count: plan.artifacts.length, missing_count: plan.missing.length, unverified_missing_count: plan.unverifiedMissing, unexplained_rows: plan.unexpected, repairable, applied: apply && repairable, added, archived, validations: plan.validation.validations, totals: plan.validation.totals,
      message: !session ? 'The original was verified, but its review history is missing; corrections need manual review.' : apply && repairable ? `${archived} source header/total row(s) excluded; ${added} verified transaction(s) recovered. Original evidence and reversible audit history are retained.` : repairable ? 'The original confirms specific corrections to the posted history.' : plan.unverifiedMissing || plan.unexpected ? 'Differences need manual review; the source does not justify automatic corrections.' : 'Posted source transactions match the original statement.' };
  } catch (error) { await db.rollback().catch(() => {}); throw error; }
  finally { db.release(); }
}

async function repairKnownStatementSourceArtifacts() {
  const [files] = await pool.query(`SELECT sif.*,ba.currency FROM statement_import_files sif JOIN bank_accounts ba ON ba.id=sif.bank_account_id
    WHERE sif.parse_status='IMPORTED' AND sif.secure_document_id IS NOT NULL AND sif.source_format='PDF'
      AND sif.parser_version='finance-ingestion-v2-bank-aware' AND ba.status='ACTIVE'
    ORDER BY sif.id LIMIT 50`);
  let added = 0, archived = 0;
  for (const file of files) {
    try { const result = await verifyStoredStatement(file, { apply: true }); added += result.added; archived += result.archived; }
    catch (error) { console.warn('STATEMENT_SOURCE_REPAIR_SKIPPED', { code: error.code || 'SOURCE_VERIFICATION_UNAVAILABLE' }); }
  }
  console.log('STATEMENT_SOURCE_REPAIR_COMPLETE', { checked: files.length, recovered: added, archived });
  return { checked: files.length, added, archived };
}

module.exports = { planSourceRepair, verifyStoredStatement, repairKnownStatementSourceArtifacts };
