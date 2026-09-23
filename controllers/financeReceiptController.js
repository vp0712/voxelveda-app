'use strict';

const fs = require('node:fs');
const pool = require('../config/db');
const money = require('../utils/money');
const { registerDocument } = require('../services/documentSecurityService');
const { logAudit } = require('../services/auditService');
const { FinanceError } = require('../services/financeDomain');
const { ensureFinanceSchema } = require('../services/financeSchema');
const privacy = require('../services/financePrivacyService');

const RECEIPT_STATUSES = new Set(['MISSING', 'REQUESTED', 'NOT_REQUIRED']);

function userId(req) { return Number(req.user?.id || req.user?.user_id || 0); }
function auditEntry(req, action, recordId, values, oldValue = null) {
  return {
    actorId: userId(req), action, module: 'finance', recordType: 'bank_transaction_receipt',
    recordId: String(recordId), oldValue, newValue: values || null, requestId: req.requestId || null,
    sessionId: req.session?.id || null, ipAddress: req.ip || null, userAgent: req.get('user-agent') || null
  };
}

function fail(res, error, message, code) {
  if (error instanceof FinanceError) return res.status(error.statusCode || 400).json({ message: error.message, code: error.code });
  console.error(message, error);
  return res.status(error.status || 500).json({ message, code });
}

async function removeTemp(file) {
  if (file?.path) await fs.promises.unlink(file.path).catch(() => {});
}

function dateValue(value, name) {
  const result = String(value || '').trim();
  if (result && !/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new FinanceError(`${name} must use YYYY-MM-DD.`, 400, 'INVALID_RECEIPT_DATE');
  return result;
}

function receiptFilters(req) {
  const result = {
    q: String(req.query.q || '').trim().slice(0, 120),
    scope: String(req.query.scope || 'ALL').trim().toUpperCase(),
    accountId: req.query.account_id ? Number(req.query.account_id) : null,
    merchant: String(req.query.merchant || '').trim().slice(0, 120),
    category: String(req.query.category || '').trim().slice(0, 120),
    from: dateValue(req.query.from, 'From date'),
    to: dateValue(req.query.to, 'To date'),
    taxRelevant: ['1', 'true', 'yes'].includes(String(req.query.tax_relevant || '').toLowerCase()),
    status: String(req.query.receipt_status || 'ALL').trim().toUpperCase(),
    amountMin: String(req.query.amount_min || '').trim()
  };
  if (!['ALL', 'PERSONAL', 'BUSINESS', 'MIXED', 'UNCLASSIFIED'].includes(result.scope)) throw new FinanceError('Invalid receipt scope.', 400, 'INVALID_RECEIPT_SCOPE');
  if (!['ALL', 'ATTACHED', 'MISSING', 'REQUESTED', 'NOT_REQUIRED'].includes(result.status)) throw new FinanceError('Invalid receipt status.', 400, 'INVALID_RECEIPT_STATUS');
  if (result.accountId !== null && (!Number.isInteger(result.accountId) || result.accountId <= 0)) throw new FinanceError('Invalid receipt account.', 400, 'INVALID_RECEIPT_ACCOUNT');
  if (result.from && result.to && result.from > result.to) throw new FinanceError('From date cannot be after To date.', 400, 'INVALID_RECEIPT_DATE_RANGE');
  if (result.amountMin) {
    try { if (money.toCents(result.amountMin) < 0n) throw new Error('negative'); }
    catch { throw new FinanceError('Minimum amount must be a valid non-negative money value.', 400, 'INVALID_RECEIPT_AMOUNT'); }
  }
  return result;
}

function transactionWhere(req, filters, { documentAlias = null } = {}) {
  const clauses = [privacy.visibilitySql('ba', req), 'bt.archived_at IS NULL'];
  const params = [...privacy.visibilityParams(req)];
  if (filters.scope !== 'ALL') { clauses.push('bt.ownership_scope=?'); params.push(filters.scope); }
  if (filters.accountId) { clauses.push('ba.id=?'); params.push(filters.accountId); }
  if (filters.from) { clauses.push('bt.transaction_date>=?'); params.push(filters.from); }
  if (filters.to) { clauses.push('bt.transaction_date<=?'); params.push(filters.to); }
  if (filters.merchant) { clauses.push('(bt.merchant_name LIKE ? OR bt.description LIKE ?)'); const like = `%${filters.merchant}%`; params.push(like, like); }
  if (filters.category) { clauses.push('bt.category LIKE ?'); params.push(`%${filters.category}%`); }
  if (filters.amountMin) { clauses.push('bt.debit>=?'); params.push(money.fromCents(money.toCents(filters.amountMin))); }
  if (filters.q) {
    const fields = ['bt.description LIKE ?', 'bt.merchant_name LIKE ?', 'bt.category LIKE ?', 'ba.nickname LIKE ?'];
    if (documentAlias) fields.unshift(`${documentAlias}.original_name LIKE ?`);
    clauses.push(`(${fields.join(' OR ')})`);
    const like = `%${filters.q}%`; params.push(...fields.map(() => like));
  }
  if (filters.taxRelevant) clauses.push(`EXISTS (SELECT 1 FROM finance_system_categories fsc WHERE fsc.name=bt.category AND fsc.active=1 AND fsc.archived_at IS NULL AND fsc.gst_default IN ('GST_ON_EXPENSES','GST_ON_INCOME','GST_FREE','INPUT_TAXED'))`);
  return { clauses, params };
}

async function receiptRequirement(db, transactionId) {
  const [[row]] = await db.query('SELECT * FROM finance_receipt_requirements WHERE bank_transaction_id=? LIMIT 1', [transactionId]);
  return row || null;
}

async function markAttached(db, transactionId, actorId) {
  await db.query(
    `INSERT INTO finance_receipt_requirements
     (bank_transaction_id,status,policy_source,resolved_by,resolved_at,updated_by)
     VALUES (?,'ATTACHED','SECURE_DOCUMENT',?,NOW(),?)
     ON DUPLICATE KEY UPDATE status='ATTACHED',policy_source='SECURE_DOCUMENT',resolved_by=VALUES(resolved_by),resolved_at=NOW(),updated_by=VALUES(updated_by)`,
    [transactionId, actorId, actorId]
  );
}

exports.upload = async (req, res) => {
  let db;
  try {
    await ensureFinanceSchema();
    const transactionId = Number(req.params.id || 0);
    if (!transactionId) throw new FinanceError('Transaction not found.', 404, 'BANK_TRANSACTION_NOT_FOUND');
    if (!req.file) throw new FinanceError('Choose a receipt file.', 400, 'RECEIPT_REQUIRED');

    const [[tx]] = await pool.query(
      'SELECT id,ownership_scope,imported_by FROM bank_transactions WHERE id=? LIMIT 1',
      [transactionId]
    );
    if (!tx) throw new FinanceError('Transaction not found.', 404, 'BANK_TRANSACTION_NOT_FOUND');
    const ownerUserId = String(tx.ownership_scope || '').toUpperCase() === 'BUSINESS' ? null : userId(req);

    const document = await registerDocument({
      module: 'finance', recordType: 'bank_transaction', recordId: transactionId,
      ownerUserId, uploadedBy: userId(req), file: req.file, classification: 'CONFIDENTIAL'
    });

    db = await pool.getConnection();
    await db.beginTransaction();
    const before = await receiptRequirement(db, transactionId);
    await markAttached(db, transactionId, userId(req));
    await logAudit(db, auditEntry(req, 'FINANCE_RECEIPT_ATTACHED', transactionId, {
      document_id: document.id, original_name: req.file.originalname, scan_status: document.scan_status, receipt_status: 'ATTACHED'
    }, before ? { receipt_status: before.status } : null));
    await db.commit();
    return res.status(201).json({
      message: 'Receipt attached securely.',
      receipt: {
        id: document.id, original_name: req.file.originalname, scan_status: document.scan_status,
        classification: document.classification, download_url: document.download_url
      },
      receipt_status: 'ATTACHED'
    });
  } catch (error) {
    if (db) await db.rollback().catch(() => {});
    await removeTemp(req.file);
    return fail(res, error, 'Receipt upload failed.', 'FINANCE_RECEIPT_UPLOAD_FAILED');
  } finally { if (db) db.release(); }
};

exports.list = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const transactionId = Number(req.params.id || 0);
    const [rows] = await pool.query(
      `SELECT id,original_name,mime_type,size_bytes,classification,scan_status,uploaded_by,created_at
         FROM secure_documents
        WHERE module='finance' AND record_type='bank_transaction' AND record_id=? AND deleted_at IS NULL
        ORDER BY created_at DESC`,
      [String(transactionId)]
    );
    const requirement = await receiptRequirement(pool, transactionId);
    return res.json({
      receipts: rows.map((row) => ({ ...row, download_url: `/api/documents/${row.id}/download` })),
      receipt_status: rows.length ? 'ATTACHED' : (requirement?.status || 'UNASSESSED'),
      receipt_requirement: requirement
    });
  } catch (error) {
    return fail(res, error, 'Failed to load receipts.', 'FINANCE_RECEIPT_LIST_FAILED');
  }
};

exports.setStatus = async (req, res) => {
  const db = await pool.getConnection();
  try {
    await ensureFinanceSchema();
    const transactionId = Number(req.params.id || 0);
    const status = String(req.body.status || '').trim().toUpperCase();
    if (!RECEIPT_STATUSES.has(status)) throw new FinanceError('Receipt status must be Missing, Requested or Not Required.', 400, 'INVALID_RECEIPT_STATUS');
    const reason = String(req.body.reason || '').trim().slice(0, 500) || null;
    await db.beginTransaction();
    const [[tx]] = await db.query('SELECT id,debit,is_internal_transfer FROM bank_transactions WHERE id=? FOR UPDATE', [transactionId]);
    if (!tx) throw new FinanceError('Transaction not found.', 404, 'BANK_TRANSACTION_NOT_FOUND');
    if (money.toCents(tx.debit || 0) <= 0n || Number(tx.is_internal_transfer)) throw new FinanceError('Receipt review applies only to non-transfer expense transactions.', 400, 'RECEIPT_STATUS_EXPENSE_REQUIRED');
    const [[documents]] = await db.query(
      `SELECT COUNT(*) AS count FROM secure_documents
        WHERE module='finance' AND record_type='bank_transaction' AND record_id=? AND deleted_at IS NULL`,
      [String(transactionId)]
    );
    if (Number(documents.count || 0) > 0) throw new FinanceError('This transaction already has an attached receipt.', 409, 'RECEIPT_ALREADY_ATTACHED');
    const before = await receiptRequirement(db, transactionId);
    await db.query(
      `INSERT INTO finance_receipt_requirements
       (bank_transaction_id,status,policy_source,reason,requested_by,requested_at,resolved_by,resolved_at,updated_by)
       VALUES (?,?,?, ?,?,?, ?,?,?)
       ON DUPLICATE KEY UPDATE status=VALUES(status),policy_source=VALUES(policy_source),reason=VALUES(reason),
         requested_by=VALUES(requested_by),requested_at=VALUES(requested_at),resolved_by=VALUES(resolved_by),
         resolved_at=VALUES(resolved_at),updated_by=VALUES(updated_by)`,
      [transactionId,status,'MANUAL_REVIEW',reason,status==='REQUESTED'?userId(req):null,status==='REQUESTED'?new Date():null,
        status==='NOT_REQUIRED'?userId(req):null,status==='NOT_REQUIRED'?new Date():null,userId(req)]
    );
    await logAudit(db, auditEntry(req, `FINANCE_RECEIPT_${status}`, transactionId,
      { receipt_status: status, reason }, before ? { receipt_status: before.status, reason: before.reason } : null));
    await db.commit();
    return res.json({
      message: status === 'NOT_REQUIRED' ? 'Receipt marked not required.' : status === 'REQUESTED' ? 'Receipt requested.' : 'Receipt marked missing.',
      receipt_status: status
    });
  } catch (error) {
    await db.rollback().catch(() => {});
    return fail(res, error, 'Failed to update receipt status.', 'FINANCE_RECEIPT_STATUS_FAILED');
  } finally { db.release(); }
};

exports.unlink = async (req, res) => {
  const db = await pool.getConnection();
  try {
    await ensureFinanceSchema();
    const transactionId = Number(req.params.id || 0);
    const documentId = String(req.params.documentId || '');
    await db.beginTransaction();
    const [result] = await db.query(
      `UPDATE secure_documents SET deleted_at=NOW(),deleted_by=?
        WHERE id=? AND module='finance' AND record_type='bank_transaction' AND record_id=? AND deleted_at IS NULL`,
      [userId(req), documentId, String(transactionId)]
    );
    if (!result.affectedRows) throw new FinanceError('Receipt not found.', 404, 'RECEIPT_NOT_FOUND');
    const [[remaining]] = await db.query(
      `SELECT COUNT(*) AS count FROM secure_documents
        WHERE module='finance' AND record_type='bank_transaction' AND record_id=? AND deleted_at IS NULL`,
      [String(transactionId)]
    );
    if (!Number(remaining.count || 0)) {
      await db.query(
        `INSERT INTO finance_receipt_requirements (bank_transaction_id,status,policy_source,updated_by)
         VALUES (?,'MISSING','DOCUMENT_UNLINKED',?)
         ON DUPLICATE KEY UPDATE status=IF(requested_at IS NULL,'MISSING','REQUESTED'),policy_source='DOCUMENT_UNLINKED',
           resolved_by=NULL,resolved_at=NULL,updated_by=VALUES(updated_by)`,
        [transactionId, userId(req)]
      );
    }
    await logAudit(db, auditEntry(req, 'FINANCE_RECEIPT_UNLINKED', transactionId,
      { document_id: documentId, receipt_status: Number(remaining.count || 0) ? 'ATTACHED' : 'MISSING' }));
    await db.commit();
    return res.json({ message: 'Receipt unlinked. The protected document remains soft-deleted for controlled recovery.' });
  } catch (error) {
    await db.rollback().catch(() => {});
    return fail(res, error, 'Failed to unlink receipt.', 'FINANCE_RECEIPT_UNLINK_FAILED');
  } finally { db.release(); }
};

exports.restore = async (req, res) => {
  const db = await pool.getConnection();
  try {
    await ensureFinanceSchema();
    const transactionId = Number(req.params.id || 0), documentId = String(req.params.documentId || '');
    await db.beginTransaction();
    const [result] = await db.query(
      `UPDATE secure_documents SET deleted_at=NULL,deleted_by=NULL
        WHERE id=? AND module='finance' AND record_type='bank_transaction' AND record_id=? AND deleted_at IS NOT NULL`,
      [documentId, String(transactionId)]
    );
    if (!result.affectedRows) throw new FinanceError('Recoverable receipt not found.', 404, 'RECEIPT_NOT_FOUND');
    await markAttached(db, transactionId, userId(req));
    await logAudit(db, auditEntry(req, 'FINANCE_RECEIPT_RESTORED', transactionId,
      { document_id: documentId, receipt_status: 'ATTACHED' }));
    await db.commit();
    return res.json({ message: 'Receipt restored to the transaction.', receipt_status: 'ATTACHED' });
  } catch (error) {
    await db.rollback().catch(() => {});
    return fail(res, error, 'Failed to restore receipt.', 'FINANCE_RECEIPT_RESTORE_FAILED');
  } finally { db.release(); }
};


exports.center = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const filters = receiptFilters(req);
    const [[settings]] = await pool.query('SELECT receipt_required_above FROM finance_settings WHERE id=1 LIMIT 1');
    const configuredThreshold = settings?.receipt_required_above === null || settings?.receipt_required_above === undefined
      ? null : money.fromCents(money.toCents(settings.receipt_required_above));
    let receipts = [], missing = [], exceptions = [], recoverable = [];

    if (['ALL', 'ATTACHED'].includes(filters.status)) {
      const visible = transactionWhere(req, filters, { documentAlias: 'sd' });
      [receipts] = await pool.query(
        `SELECT sd.id,sd.original_name,sd.mime_type,sd.size_bytes,sd.classification,sd.scan_status,sd.uploaded_by,sd.created_at,
                bt.id AS bank_transaction_id,bt.transaction_date,bt.description,bt.merchant_name,bt.category,bt.debit,bt.credit,bt.currency,
                bt.ownership_scope,ba.id AS bank_account_id,ba.nickname AS account_name,ba.institution
           FROM secure_documents sd
           JOIN bank_transactions bt ON CAST(sd.record_id AS UNSIGNED)=bt.id
           JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE sd.module='finance' AND sd.record_type='bank_transaction' AND sd.deleted_at IS NULL
            AND ${visible.clauses.join(' AND ')}
          ORDER BY sd.created_at DESC LIMIT 250`, visible.params);
    }

    if (['ALL', 'MISSING', 'REQUESTED'].includes(filters.status)) {
      const visible = transactionWhere(req, filters);
      const clauses = [...visible.clauses, "bt.reconciliation_status<>'IGNORED'", 'bt.debit>0', 'bt.is_internal_transfer=0',
        `NOT EXISTS (SELECT 1 FROM secure_documents active_doc WHERE active_doc.module='finance'
          AND active_doc.record_type='bank_transaction' AND CAST(active_doc.record_id AS UNSIGNED)=bt.id AND active_doc.deleted_at IS NULL)`];
      const params = [...visible.params];
      const automatic = configuredThreshold === null ? '0=1' : `(rr.id IS NULL AND bt.ownership_scope='BUSINESS' AND bt.debit>=?)`;
      if (filters.status === 'REQUESTED') clauses.push("rr.status='REQUESTED'");
      else if (filters.status === 'MISSING') clauses.push(`(rr.status='MISSING' OR ${automatic})`);
      else clauses.push(`(rr.status IN ('MISSING','REQUESTED') OR ${automatic})`);
      if (configuredThreshold !== null && filters.status !== 'REQUESTED') params.push(configuredThreshold);
      [missing] = await pool.query(
        `SELECT bt.id AS bank_transaction_id,bt.transaction_date,bt.description,bt.merchant_name,bt.category,bt.debit,bt.currency,
                bt.ownership_scope,ba.id AS bank_account_id,ba.nickname AS account_name,ba.institution,
                COALESCE(rr.status,'MISSING') AS receipt_status,COALESCE(rr.policy_source,'AMOUNT_THRESHOLD') AS policy_source,
                rr.reason,rr.requested_at
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
           LEFT JOIN finance_receipt_requirements rr ON rr.bank_transaction_id=bt.id
          WHERE ${clauses.join(' AND ')}
          ORDER BY FIELD(COALESCE(rr.status,'MISSING'),'REQUESTED','MISSING'),bt.transaction_date DESC,bt.id DESC LIMIT 250`, params);
    }

    if (['ALL', 'NOT_REQUIRED'].includes(filters.status)) {
      const visible = transactionWhere(req, filters);
      [exceptions] = await pool.query(
        `SELECT bt.id AS bank_transaction_id,bt.transaction_date,bt.description,bt.merchant_name,bt.category,bt.debit,bt.currency,
                bt.ownership_scope,ba.nickname AS account_name,rr.reason,rr.resolved_at
           FROM finance_receipt_requirements rr JOIN bank_transactions bt ON bt.id=rr.bank_transaction_id
           JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE rr.status='NOT_REQUIRED' AND ${visible.clauses.join(' AND ')}
          ORDER BY rr.updated_at DESC LIMIT 250`, visible.params);
    }

    if (filters.status === 'ALL') {
      const visible = transactionWhere(req, filters, { documentAlias: 'sd' });
      [recoverable] = await pool.query(
        `SELECT sd.id,sd.original_name,sd.deleted_at,sd.deleted_by,bt.id AS bank_transaction_id,bt.transaction_date,
                bt.description,bt.merchant_name,ba.nickname AS account_name
           FROM secure_documents sd JOIN bank_transactions bt ON CAST(sd.record_id AS UNSIGNED)=bt.id
           JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE sd.module='finance' AND sd.record_type='bank_transaction' AND sd.deleted_at IS NOT NULL
            AND ${visible.clauses.join(' AND ')}
          ORDER BY sd.deleted_at DESC LIMIT 100`, visible.params);
    }
    return res.json({
      receipts: receipts.map((row) => ({ ...row, download_url: `/api/documents/${row.id}/download` })),
      missing_receipts: missing,
      not_required: exceptions,
      recoverable_receipts: recoverable,
      counts: {
        attached: receipts.length,
        missing: missing.filter((row) => row.receipt_status === 'MISSING').length,
        requested: missing.filter((row) => row.receipt_status === 'REQUESTED').length,
        not_required: exceptions.length,
        recoverable: recoverable.length
      },
      policy: {
        automatic_threshold: configuredThreshold,
        automatic_scope: 'BUSINESS',
        note: configuredThreshold === null
          ? 'No automatic amount threshold is configured; only explicitly requested or missing receipts enter the queue.'
          : `Company expenses at or above ${configuredThreshold} enter the missing-receipt queue until reviewed.`
      },
      filters,
      privacy: 'Results include only transactions visible through Finance account permissions.'
    });
  } catch (error) {
    return fail(res, error, 'Failed to load Finance receipts.', 'FINANCE_RECEIPT_CENTRE_FAILED');
  }
};
