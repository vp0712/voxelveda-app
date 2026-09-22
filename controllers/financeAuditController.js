'use strict';

const pool = require('../config/db');
const { FinanceError } = require('../services/financeDomain');

function parseJson(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return value; }
}

exports.transactionTimeline = async (req, res) => {
  try {
    const transactionId = Number(req.params.id || 0);
    if (!transactionId) throw new FinanceError('Transaction not found.', 404, 'BANK_TRANSACTION_NOT_FOUND');
    const [rows] = await pool.query(
      `SELECT id,actor_id,action,module,record_type,record_id,old_value,new_value,result,request_id,created_at
         FROM audit_logs
        WHERE (record_type='bank_transaction' AND record_id=?)
           OR (record_type='bank_transaction_receipt' AND record_id=?)
        ORDER BY id ASC LIMIT 500`,
      [String(transactionId), String(transactionId)]
    );
    return res.json({
      transaction_id: transactionId,
      timeline: rows.map((row) => ({
        id: row.id,
        at: row.created_at,
        actor_id: row.actor_id,
        action: row.action,
        module: row.module,
        result: row.result,
        old_value: parseJson(row.old_value),
        new_value: parseJson(row.new_value),
        request_id: row.request_id
      })),
      integrity_note: 'Entries are read from the existing hash-linked audit chain. Sensitive values are redacted at audit-write time.'
    });
  } catch (error) {
    if (error instanceof FinanceError) return res.status(error.statusCode || 400).json({ message: error.message, code: error.code });
    console.error('Finance transaction audit timeline failed:', error);
    return res.status(500).json({ message: 'Failed to load transaction audit history.', code: 'FINANCE_AUDIT_TIMELINE_FAILED' });
  }
};
