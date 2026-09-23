'use strict';

const pool = require('../config/db');
const { FinanceError } = require('../services/financeDomain');

function parseJson(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function eventDescription(action, oldValue, newValue) {
  const label = String(action || 'Activity').replaceAll('_', ' ').toLowerCase();
  if (action === 'BANK_TRANSACTION_UPDATED') {
    const changes = [];
    if (oldValue?.category !== newValue?.category) changes.push(`category: ${oldValue?.category || 'Uncategorised'} to ${newValue?.category || 'Uncategorised'}`);
    if (oldValue?.ownership_scope !== newValue?.ownership_scope) changes.push(`ownership: ${oldValue?.ownership_scope || 'Unclassified'} to ${newValue?.ownership_scope || 'Unclassified'}`);
    if (oldValue?.reconciliation_status !== newValue?.reconciliation_status) changes.push(`reconciliation: ${oldValue?.reconciliation_status || 'Unknown'} to ${newValue?.reconciliation_status || 'Unknown'}`);
    return changes.length ? `Changed ${changes.join('; ')}.` : 'Updated transaction classification.';
  }
  if (action === 'FINANCE_RECEIPT_ATTACHED') return `Attached receipt ${newValue?.original_name || ''}.`.replace(' .', '.');
  if (action === 'FINANCE_RECEIPT_UNLINKED') return 'Unlinked a receipt; the protected document remains recoverable.';
  if (action === 'FINANCE_RECEIPT_RESTORED') return 'Restored a protected receipt to this transaction.';
  if (action === 'FINANCE_RECEIPT_REQUESTED') return 'Requested a receipt for this transaction.';
  if (action === 'FINANCE_RECEIPT_NOT_REQUIRED') return `Marked receipt not required${newValue?.reason ? `: ${newValue.reason}` : ''}.`;
  if (action === 'BANK_TRANSACTION_SPLITS_REPLACED') return `Saved ${Array.isArray(newValue) ? newValue.length : 0} split lines without changing the source transaction.`;
  if (action === 'REFUND_LINK_CREATED') return `Linked a refund amount of ${newValue?.linked_amount || '0'} ${newValue?.currency || ''} to its original expense.`;
  if (action === 'TRANSFER_LINK_CREATED') return 'Confirmed this transaction as one side of an internal transfer.';
  if (action === 'REIMBURSEMENT_CREATED') return `Created reimbursement ${newValue?.reimbursement_uid || ''}.`.replace(' .', '.');
  if (action === 'MANUAL_BANK_TRANSACTION_CREATED') return 'Created as a manual financial movement.';
  if (action === 'RECONCILED') return 'Reconciled against the linked finance record.';
  if (action === 'IGNORED') return `Marked ignored${newValue?.reason ? `: ${newValue.reason}` : ''}.`;
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}.`;
}

exports.transactionTimeline = async (req, res) => {
  try {
    const transactionId = Number(req.params.id || 0);
    if (!transactionId) throw new FinanceError('Transaction not found.', 404, 'BANK_TRANSACTION_NOT_FOUND');
    const [rows] = await pool.query(
      `SELECT al.id,al.actor_id,al.action,al.module,al.record_type,al.record_id,al.old_value,al.new_value,
              al.result,al.request_id,al.created_at,u.name AS actor_name
         FROM audit_logs al LEFT JOIN users u ON u.id=al.actor_id
        WHERE (al.record_type='bank_transaction' AND al.record_id=?)
           OR (al.record_type='bank_transaction_receipt' AND al.record_id=?)
        ORDER BY al.id ASC LIMIT 500`,
      [String(transactionId), String(transactionId)]
    );
    return res.json({
      transaction_id: transactionId,
      timeline: rows.map((row) => {
        const oldValue = parseJson(row.old_value), newValue = parseJson(row.new_value);
        return {
        id: row.id,
        at: row.created_at,
        actor_id: row.actor_id,
        actor_name: row.actor_name || null,
        action: row.action,
        description: eventDescription(row.action, oldValue, newValue),
        module: row.module,
        result: row.result,
        old_value: oldValue,
        new_value: newValue,
        request_id: row.request_id
      }}),
      integrity_note: 'Entries are read from the existing hash-linked audit chain. Sensitive values are redacted at audit-write time.'
    });
  } catch (error) {
    if (error instanceof FinanceError) return res.status(error.statusCode || 400).json({ message: error.message, code: error.code });
    console.error('Finance transaction audit timeline failed:', error);
    return res.status(500).json({ message: 'Failed to load transaction audit history.', code: 'FINANCE_AUDIT_TIMELINE_FAILED' });
  }
};

exports._test = { eventDescription };
