'use strict';

const fs = require('node:fs');
const pool = require('../config/db');
const { registerDocument } = require('../services/documentSecurityService');
const { logAudit } = require('../services/auditService');
const { FinanceError } = require('../services/financeDomain');

function auditEntry(req, action, recordId, values) {
  return {
    actorId: req.user?.id || null, action, module: 'finance', recordType: 'bank_transaction_receipt',
    recordId: String(recordId), newValue: values || null, requestId: req.requestId || null,
    sessionId: req.session?.id || null, ipAddress: req.ip || null, userAgent: req.get('user-agent') || null
  };
}

async function removeTemp(file) {
  if (file?.path) await fs.promises.unlink(file.path).catch(() => {});
}

exports.upload = async (req, res) => {
  let db;
  try {
    const transactionId = Number(req.params.id || 0);
    if (!transactionId) throw new FinanceError('Transaction not found.', 404, 'BANK_TRANSACTION_NOT_FOUND');
    if (!req.file) throw new FinanceError('Choose a receipt file.', 400, 'RECEIPT_REQUIRED');

    const [[tx]] = await pool.query(
      'SELECT id,ownership_scope,imported_by FROM bank_transactions WHERE id=? LIMIT 1',
      [transactionId]
    );
    if (!tx) throw new FinanceError('Transaction not found.', 404, 'BANK_TRANSACTION_NOT_FOUND');
    const ownerUserId = String(tx.ownership_scope || '').toUpperCase() === 'BUSINESS' ? null : Number(req.user.id);

    const document = await registerDocument({
      module: 'finance', recordType: 'bank_transaction', recordId: transactionId,
      ownerUserId, uploadedBy: req.user.id, file: req.file, classification: 'CONFIDENTIAL'
    });

    db = await pool.getConnection();
    await db.beginTransaction();
    await logAudit(db, auditEntry(req, 'FINANCE_RECEIPT_ATTACHED', transactionId, {
      document_id: document.id, original_name: req.file.originalname, scan_status: document.scan_status
    }));
    await db.commit();
    return res.status(201).json({
      message: 'Receipt attached securely.',
      receipt: {
        id: document.id, original_name: req.file.originalname, scan_status: document.scan_status,
        classification: document.classification, download_url: document.download_url
      }
    });
  } catch (error) {
    if (db) await db.rollback().catch(() => {});
    await removeTemp(req.file);
    if (error instanceof FinanceError) return res.status(error.statusCode || 400).json({ message: error.message, code: error.code });
    console.error('Finance receipt upload failed:', error);
    return res.status(error.status || 500).json({ message: 'Receipt upload failed.', code: error.code || 'FINANCE_RECEIPT_UPLOAD_FAILED' });
  } finally { if (db) db.release(); }
};

exports.list = async (req, res) => {
  try {
    const transactionId = Number(req.params.id || 0);
    const [rows] = await pool.query(
      `SELECT id,original_name,mime_type,size_bytes,classification,scan_status,uploaded_by,created_at
         FROM secure_documents
        WHERE module='finance' AND record_type='bank_transaction' AND record_id=? AND deleted_at IS NULL
        ORDER BY created_at DESC`,
      [String(transactionId)]
    );
    return res.json({
      receipts: rows.map((row) => ({
        ...row, download_url: `/api/documents/${row.id}/download`
      }))
    });
  } catch (error) {
    console.error('Finance receipt list failed:', error);
    return res.status(500).json({ message: 'Failed to load receipts.', code: 'FINANCE_RECEIPT_LIST_FAILED' });
  }
};

exports.unlink = async (req, res) => {
  const db = await pool.getConnection();
  try {
    const transactionId = Number(req.params.id || 0);
    const documentId = String(req.params.documentId || '');
    await db.beginTransaction();
    const [result] = await db.query(
      `UPDATE secure_documents SET deleted_at=NOW(),deleted_by=?
        WHERE id=? AND module='finance' AND record_type='bank_transaction' AND record_id=? AND deleted_at IS NULL`,
      [req.user.id, documentId, String(transactionId)]
    );
    if (!result.affectedRows) throw new FinanceError('Receipt not found.', 404, 'RECEIPT_NOT_FOUND');
    await logAudit(db, auditEntry(req, 'FINANCE_RECEIPT_UNLINKED', transactionId, { document_id: documentId }));
    await db.commit();
    return res.json({ message: 'Receipt unlinked. The protected document remains soft-deleted for controlled recovery.' });
  } catch (error) {
    await db.rollback().catch(() => {});
    if (error instanceof FinanceError) return res.status(error.statusCode || 400).json({ message: error.message, code: error.code });
    console.error('Finance receipt unlink failed:', error);
    return res.status(500).json({ message: 'Failed to unlink receipt.', code: 'FINANCE_RECEIPT_UNLINK_FAILED' });
  } finally { db.release(); }
};
