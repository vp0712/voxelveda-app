'use strict';

const pool = require('../config/db');
const { ensureFinanceSchema } = require('../services/financeSchema');
const { FinanceError } = require('../services/financeDomain');
const { logAudit } = require('../services/auditService');

const SCOPES = new Set(['ALL', 'PERSONAL', 'BUSINESS', 'MIXED', 'UNCLASSIFIED']);
const WORKFLOWS = new Set(['ALL', 'NEEDS_ACTION', 'READY', 'PARTIAL', 'RECONCILED', 'IGNORED']);

function audit(req, values) { return { actorId: req.user?.id, ipAddress: req.ip, userAgent: req.get('user-agent'), ...values }; }
function fail(res, error, message) {
  if (error instanceof FinanceError) return res.status(error.statusCode || 400).json({ message: error.message, code: error.code, issues: error.issues });
  console.error(`${message}:`, error);
  return res.status(500).json({ message, code: 'RECONCILIATION_CENTER_ERROR' });
}
function workflowFor(row) {
  const reconciliation = String(row.reconciliation_status || 'UNRECONCILED').toUpperCase();
  if (reconciliation === 'RECONCILED') return 'RECONCILED';
  if (reconciliation === 'IGNORED') return 'IGNORED';
  if (reconciliation === 'PARTIAL') return 'PARTIAL';
  if (Number(row.is_internal_transfer || 0) === 1) return 'READY';
  if (String(row.classification_status || '').toUpperCase() === 'CLASSIFIED' && String(row.category || '').trim()) return 'READY';
  return 'NEEDS_ACTION';
}
function reasonFor(row, workflow) {
  if (workflow === 'RECONCILED') return 'Fully matched to posted finance records.';
  if (workflow === 'IGNORED') return row.ignored_reason || 'Excluded with an audit reason.';
  if (workflow === 'PARTIAL') return 'Part of this bank amount is matched. The remaining amount still needs attention.';
  if (Number(row.is_internal_transfer || 0) === 1) return 'Confirmed as money moving between your own accounts.';
  if (!String(row.category || '').trim()) return 'Choose what this transaction was for.';
  if (String(row.classification_status || '').toUpperCase() !== 'CLASSIFIED') return 'Review the category and confirm the transaction.';
  return 'Ready to match to a posted finance transaction.';
}
function amountFor(row) { return Number(row.credit || 0) - Number(row.debit || 0); }

exports.getCenter = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const scope = String(req.query.scope || 'ALL').toUpperCase();
    const workflow = String(req.query.workflow || 'ALL').toUpperCase();
    if (!SCOPES.has(scope)) throw new FinanceError('Invalid money scope.', 400, 'INVALID_SCOPE');
    if (!WORKFLOWS.has(workflow)) throw new FinanceError('Invalid reconciliation filter.', 400, 'INVALID_WORKFLOW');
    const clauses = ["ba.status = 'ACTIVE'"];
    const params = [];
    if (scope !== 'ALL') { clauses.push('bt.ownership_scope = ?'); params.push(scope); }
    const search = String(req.query.search || '').trim();
    if (search) {
      clauses.push('(bt.description LIKE ? OR bt.merchant_name LIKE ? OR bt.reference LIKE ? OR ba.nickname LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    const [rows] = await pool.query(
      `SELECT bt.id, bt.bank_account_id, bt.transaction_date, bt.posting_date, bt.description, bt.reference,
              bt.debit, bt.credit, bt.running_balance, bt.currency, bt.merchant_name, bt.category,
              bt.classification_status, bt.ownership_scope, bt.is_internal_transfer,
              bt.reconciliation_status, bt.ignored_reason, ba.nickname AS account_name,
              ba.institution, ba.account_type,
              COALESCE((SELECT SUM(rm.matched_amount) FROM reconciliation_matches rm WHERE rm.bank_transaction_id = bt.id), 0) AS matched_amount
       FROM bank_transactions bt
       JOIN bank_accounts ba ON ba.id = bt.bank_account_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY bt.transaction_date DESC, bt.id DESC LIMIT 500`, params
    );
    const enriched = rows.map((row) => {
      const workflow_status = workflowFor(row);
      const absolute_amount = Math.abs(amountFor(row));
      const matched_amount = Number(row.matched_amount || 0);
      return {
        ...row,
        transaction_date: row.transaction_date ? String(row.transaction_date).slice(0, 10) : null,
        posting_date: row.posting_date ? String(row.posting_date).slice(0, 10) : null,
        amount: amountFor(row), absolute_amount, matched_amount,
        remaining_amount: Math.max(0, absolute_amount - matched_amount),
        workflow_status,
        action_reason: reasonFor(row, workflow_status)
      };
    });
    const filtered = workflow === 'ALL' ? enriched : enriched.filter((row) => row.workflow_status === workflow);
    const summary = enriched.reduce((acc, row) => {
      acc.total += 1;
      acc[row.workflow_status.toLowerCase()] = (acc[row.workflow_status.toLowerCase()] || 0) + 1;
      if (row.amount < 0) acc.money_out += Math.abs(row.amount); else acc.money_in += row.amount;
      return acc;
    }, { total: 0, needs_action: 0, ready: 0, partial: 0, reconciled: 0, ignored: 0, money_in: 0, money_out: 0 });
    return res.json({ scope, workflow, summary, transactions: filtered });
  } catch (error) { return fail(res, error, 'Failed to load reconciliation center'); }
};

exports.classify = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const id = Number(req.params.id || 0);
    const category = String(req.body.category || '').trim().slice(0, 120);
    const scope = String(req.body.ownership_scope || '').trim().toUpperCase();
    const internalTransfer = Boolean(req.body.is_internal_transfer);
    if (!id) throw new FinanceError('Transaction is required.', 400, 'TRANSACTION_REQUIRED');
    if (!['PERSONAL', 'BUSINESS', 'MIXED', 'UNCLASSIFIED'].includes(scope)) throw new FinanceError('Choose Personal, Voxel Veda, Mixed or Not sure.', 400, 'INVALID_SCOPE');
    if (!internalTransfer && !category) throw new FinanceError('Choose a category, or confirm this is an own-account transfer.', 400, 'CATEGORY_REQUIRED');
    const [[row]] = await pool.query('SELECT * FROM bank_transactions WHERE id=?', [id]);
    if (!row) throw new FinanceError('Bank transaction not found.', 404, 'BANK_TRANSACTION_NOT_FOUND');
    if (['RECONCILED', 'IGNORED'].includes(String(row.reconciliation_status || '').toUpperCase())) throw new FinanceError('This transaction is locked by its reconciliation status.', 409, 'BANK_TRANSACTION_LOCKED');
    const nextCategory = internalTransfer ? 'Internal Transfer' : category;
    await pool.query(`UPDATE bank_transactions SET category=?, classification_status='CLASSIFIED', ownership_scope=?, is_internal_transfer=? WHERE id=?`, [nextCategory, scope, internalTransfer ? 1 : 0, id]);
    await logAudit(pool, audit(req, {
      action: 'RECONCILIATION_CLASSIFIED', module: 'finance_intelligence', recordType: 'bank_transaction', recordId: id,
      oldValue: { category: row.category, classification_status: row.classification_status, ownership_scope: row.ownership_scope, is_internal_transfer: row.is_internal_transfer },
      newValue: { category: nextCategory, classification_status: 'CLASSIFIED', ownership_scope: scope, is_internal_transfer: internalTransfer ? 1 : 0 }
    }));
    return res.json({ message: internalTransfer ? 'Transfer confirmed and ready.' : 'Transaction classified and ready for reconciliation.' });
  } catch (error) { return fail(res, error, 'Failed to classify bank transaction'); }
};

exports.getCandidates = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const id = Number(req.params.id || 0);
    const [[bank]] = await pool.query('SELECT * FROM bank_transactions WHERE id=?', [id]);
    if (!bank) throw new FinanceError('Bank transaction not found.', 404, 'BANK_TRANSACTION_NOT_FOUND');
    if (bank.reconciliation_status === 'RECONCILED') throw new FinanceError('This transaction is already reconciled.', 409, 'ALREADY_RECONCILED');
    const bankAmount = Math.abs(Number(bank.credit || 0) - Number(bank.debit || 0));
    const [[matched]] = await pool.query('SELECT COALESCE(SUM(matched_amount),0) AS total FROM reconciliation_matches WHERE bank_transaction_id=?', [id]);
    const remaining = Math.max(0, bankAmount - Number(matched.total || 0));
    const [rows] = await pool.query(
      `SELECT ft.id, ft.transaction_uid, ft.effective_date, ft.description, ft.party_name, ft.gross_amount,
              ft.category, ft.status, ft.reconciliation_status,
              ABS(ft.gross_amount - ?) AS amount_difference,
              ABS(DATEDIFF(ft.effective_date, ?)) AS date_difference
       FROM finance_transactions ft
       WHERE ft.status='POSTED'
         AND ft.reconciliation_status <> 'RECONCILED'
         AND ft.effective_date BETWEEN DATE_SUB(?, INTERVAL 21 DAY) AND DATE_ADD(?, INTERVAL 21 DAY)
       ORDER BY amount_difference ASC, date_difference ASC, ft.id DESC
       LIMIT 25`, [remaining || bankAmount, bank.transaction_date, bank.transaction_date, bank.transaction_date]
    );
    return res.json({
      bank_transaction: { id: bank.id, transaction_date: String(bank.transaction_date).slice(0, 10), description: bank.description, amount: bankAmount, matched_amount: Number(matched.total || 0), remaining_amount: remaining },
      candidates: rows.map((row) => ({ ...row, effective_date: String(row.effective_date).slice(0, 10) }))
    });
  } catch (error) { return fail(res, error, 'Failed to find reconciliation matches'); }
};
