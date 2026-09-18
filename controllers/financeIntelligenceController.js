const crypto = require('node:crypto');
const pool = require('../config/db');
const money = require('../utils/money');
const { ensureFinanceSchema } = require('../services/financeSchema');
const { logAudit } = require('../services/auditService');
const { FinanceError, dateOnly } = require('../services/financeDomain');
const privacy = require('../services/financePrivacyService');

const VALID_SCOPES = new Set(['PERSONAL', 'BUSINESS', 'MIXED', 'UNCLASSIFIED']);
const DASHBOARD_SCOPES = new Set(['PERSONAL', 'BUSINESS', 'ALL']);

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function audit(req, values) {
  return { actorId: req.user?.id, ipAddress: req.ip, userAgent: req.get('user-agent'), ...values };
}

function fail(res, error, message) {
  if (error instanceof FinanceError) return res.status(error.statusCode || 400).json({ message: error.message, code: error.code, issues: error.issues });
  if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'A matching finance record already exists.', code: 'DUPLICATE_RECORD' });
  console.error(`${message}:`, error);
  return res.status(500).json({ message, code: 'FINANCE_INTELLIGENCE_ERROR' });
}

function normalizeScope(value, fallback = 'BUSINESS') {
  const scope = String(value || fallback).trim().toUpperCase();
  if (!VALID_SCOPES.has(scope)) throw new FinanceError('Select Personal, Business, Mixed or Unclassified.', 400, 'INVALID_OWNERSHIP_SCOPE');
  return scope;
}

function normalizeDashboardScope(value) {
  const scope = String(value || 'ALL').trim().toUpperCase();
  if (!DASHBOARD_SCOPES.has(scope)) throw new FinanceError('Dashboard scope must be Personal, Business or All.', 400, 'INVALID_DASHBOARD_SCOPE');
  return scope;
}

function rowHash(accountId, row) {
  const transactionDate = dateOnly(row.transaction_date);
  return crypto.createHash('sha256').update([
    accountId,
    transactionDate || '',
    String(row.description || '').trim().toLowerCase().replace(/\s+/g, ' '),
    String(row.reference || '').trim().toLowerCase(),
    money.fromCents(money.toCents(row.debit || 0)),
    money.fromCents(money.toCents(row.credit || 0)),
    row.running_balance === '' || row.running_balance === null || row.running_balance === undefined ? '' : money.fromCents(money.toCents(row.running_balance))
  ].join('|')).digest('hex');
}

exports.getOverview = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const scope = normalizeDashboardScope(req.query.scope);
    const accountClauses = ["ba.status = 'ACTIVE'", privacy.visibilitySql('ba')];
    const accountParams = [...privacy.visibilityParams(req)];
    if (scope !== 'ALL') { accountClauses.push('ba.ownership_scope = ?'); accountParams.push(scope); }
    const txClauses = [privacy.visibilitySql('ba')];
    const txParams = [...privacy.visibilityParams(req)];
    if (scope !== 'ALL') { txClauses.push('bt.ownership_scope = ?'); txParams.push(scope); }

    const [accountRows] = await pool.query(
      `SELECT ba.id, ba.nickname, ba.institution, ba.account_number_masked, ba.currency,
              ba.ownership_scope, ba.entity_name, ba.account_type, ba.financial_purpose,
              ba.connection_type, ba.connection_status, ba.current_ledger_balance,
              ba.available_balance, ba.history_start_date, ba.history_end_date, ba.last_synced_at,
              (SELECT COUNT(*) FROM bank_transactions bt WHERE bt.bank_account_id = ba.id) AS transaction_count,
              (SELECT COUNT(*) FROM bank_transactions bt WHERE bt.bank_account_id = ba.id AND bt.reconciliation_status = 'UNRECONCILED') AS unreconciled_count
         FROM bank_accounts ba
        WHERE ${accountClauses.join(' AND ')}
        ORDER BY ba.ownership_scope, ba.nickname`, accountParams
    );
    const [summaryRows] = await pool.query(
      `SELECT
          COALESCE(SUM(CASE WHEN bt.credit > 0 AND bt.is_internal_transfer = 0 AND bt.reconciliation_status <> 'IGNORED' THEN bt.credit ELSE 0 END),0) AS total_inflow,
          COALESCE(SUM(CASE WHEN bt.debit > 0 AND bt.is_internal_transfer = 0 AND bt.reconciliation_status <> 'IGNORED' THEN bt.debit ELSE 0 END),0) AS total_outflow,
          COUNT(*) AS transaction_count,
          SUM(CASE WHEN bt.classification_status = 'UNCLASSIFIED' THEN 1 ELSE 0 END) AS unclassified_count,
          SUM(CASE WHEN bt.reconciliation_status = 'UNRECONCILED' THEN 1 ELSE 0 END) AS unreconciled_count
         FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
        WHERE ${txClauses.join(' AND ')}`, txParams
    );
    const [categoryRows] = await pool.query(
      `SELECT COALESCE(NULLIF(bt.category,''), 'Unclassified') AS category, SUM(bt.debit) AS amount, COUNT(*) AS transaction_count
         FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
        WHERE bt.debit > 0 AND bt.is_internal_transfer = 0 AND bt.reconciliation_status <> 'IGNORED' AND ${txClauses.join(' AND ')}
        GROUP BY COALESCE(NULLIF(bt.category,''), 'Unclassified')
        ORDER BY amount DESC LIMIT 12`, txParams
    );
    const [monthRows] = await pool.query(
      `SELECT DATE_FORMAT(bt.transaction_date, '%Y-%m') AS month,
              SUM(CASE WHEN bt.credit > 0 AND bt.is_internal_transfer = 0 AND bt.reconciliation_status <> 'IGNORED' THEN bt.credit ELSE 0 END) AS inflow,
              SUM(CASE WHEN bt.debit > 0 AND bt.is_internal_transfer = 0 AND bt.reconciliation_status <> 'IGNORED' THEN bt.debit ELSE 0 END) AS outflow
         FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
        WHERE bt.transaction_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH) AND ${txClauses.join(' AND ')}
        GROUP BY DATE_FORMAT(bt.transaction_date, '%Y-%m') ORDER BY month`, txParams
    );
    const summary = summaryRows[0] || {};
    const inflow = money.toCents(summary.total_inflow || 0);
    const outflow = money.toCents(summary.total_outflow || 0);
    return res.json({
      scope,
      privacy: { personal_accounts_owner_only: true },
      summary: {
        total_inflow: money.fromCents(inflow), total_outflow: money.fromCents(outflow), net_cash_flow: money.fromCents(inflow - outflow),
        transaction_count: Number(summary.transaction_count || 0), unclassified_count: Number(summary.unclassified_count || 0),
        unreconciled_count: Number(summary.unreconciled_count || 0), account_count: accountRows.length
      },
      accounts: accountRows,
      spending_by_category: categoryRows,
      monthly_cash_flow: monthRows
    });
  } catch (error) { return fail(res, error, 'Failed to load Finance Intelligence overview'); }
};


exports.getTransactions = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const scope = String(req.query.scope || 'ALL').trim().toUpperCase();
    const allowedScopes = new Set(['ALL', 'PERSONAL', 'BUSINESS', 'MIXED', 'UNCLASSIFIED']);
    if (!allowedScopes.has(scope)) throw new FinanceError('Transaction scope must be All, Personal, Business, Mixed or Unclassified.', 400, 'INVALID_TRANSACTION_SCOPE');

    const limit = Math.min(250, Math.max(10, Number.parseInt(req.query.limit, 10) || 100));
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const offset = (page - 1) * limit;
    const q = String(req.query.q || '').trim().slice(0, 120);
    const accountId = Number(req.query.account_id || 0);
    const category = String(req.query.category || '').trim().slice(0, 120);
    const clauses = [privacy.visibilitySql('ba')];
    const params = [...privacy.visibilityParams(req)];

    if (scope !== 'ALL') { clauses.push('bt.ownership_scope=?'); params.push(scope); }
    if (accountId) { clauses.push('bt.bank_account_id=?'); params.push(accountId); }
    if (category) {
      if (category.toUpperCase() === 'UNCLASSIFIED') clauses.push("(bt.category IS NULL OR bt.category='')");
      else { clauses.push('bt.category=?'); params.push(category); }
    }
    if (q) {
      clauses.push('(bt.description LIKE ? OR bt.merchant_name LIKE ? OR bt.reference LIKE ? OR bt.category LIKE ? OR ba.nickname LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like, like, like);
    }
    const where = clauses.join(' AND ');

    const [[count]] = await pool.query(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(bt.credit),0) AS total_in,
              COALESCE(SUM(bt.debit),0) AS total_out,
              SUM(CASE WHEN bt.manual_override=1 THEN 1 ELSE 0 END) AS manual_overrides
         FROM bank_transactions bt
         JOIN bank_accounts ba ON ba.id=bt.bank_account_id
        WHERE ${where}`, params
    );
    const [rows] = await pool.query(
      `SELECT bt.id, bt.bank_account_id, bt.transaction_date, bt.posting_date, bt.description, bt.reference,
              bt.debit, bt.credit, bt.running_balance, bt.merchant_name, bt.category, bt.currency,
              bt.ownership_scope, bt.classification_status, bt.reconciliation_status, bt.is_internal_transfer, bt.ignored_reason,
              bt.source_type, bt.source_provider, bt.statement_import_uid, bt.statement_row_id, bt.review_source_status, bt.manual_override, bt.imported_at,
              ba.nickname AS account_name, ba.institution, ba.entity_name,
              sif.original_name AS statement_name, sif.source_format AS statement_format
         FROM bank_transactions bt
         JOIN bank_accounts ba ON ba.id=bt.bank_account_id
         LEFT JOIN statement_import_files sif ON sif.import_uid=bt.statement_import_uid AND sif.bank_account_id=bt.bank_account_id
        WHERE ${where}
        ORDER BY bt.transaction_date DESC, bt.id DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return res.json({
      scope,
      category: category || null,
      page,
      limit,
      total: Number(count.total || 0),
      summary: {
        money_in: count.total_in || '0.00',
        money_out: count.total_out || '0.00',
        manual_overrides: Number(count.manual_overrides || 0)
      },
      transactions: rows,
      separation: {
        business_label: 'Voxel Veda Company',
        personal_label: 'Personal',
        inherited_from_bank_account: true
      }
    });
  } catch (error) { return fail(res, error, 'Failed to load separated transaction ledger'); }
};


function reportScope(value) {
  const scope = String(value || 'ALL').trim().toUpperCase();
  const allowed = new Set(['ALL', 'PERSONAL', 'BUSINESS', 'MIXED', 'UNCLASSIFIED']);
  if (!allowed.has(scope)) throw new FinanceError('Report scope must be All, Personal, Business, Mixed or Unclassified.', 400, 'INVALID_REPORT_SCOPE');
  return scope;
}

function reportDate(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = dateOnly(value);
  if (!parsed) throw new FinanceError(`${label} must be a valid date.`, 400, 'INVALID_REPORT_DATE');
  return parsed;
}

function spendingWhere(req, options = {}) {
  const scope = reportScope(req.query.scope);
  const from = reportDate(req.query.from, 'From date');
  const to = reportDate(req.query.to, 'To date');
  if (from && to && from > to) throw new FinanceError('From date cannot be after To date.', 400, 'INVALID_REPORT_RANGE');
  const accountId = Number(req.query.account_id || 0);
  const statementUid = String(options.statementUid || req.query.statement_uid || '').trim().slice(0, 80);
  const clauses = [privacy.visibilitySql('ba'), "bt.reconciliation_status <> 'IGNORED'"];
  const params = [...privacy.visibilityParams(req)];
  if (scope !== 'ALL') { clauses.push('bt.ownership_scope=?'); params.push(scope); }
  if (accountId) { clauses.push('bt.bank_account_id=?'); params.push(accountId); }
  if (from) { clauses.push('bt.transaction_date>=?'); params.push(from); }
  if (to) { clauses.push('bt.transaction_date<=?'); params.push(to); }
  if (statementUid) { clauses.push('bt.statement_import_uid=?'); params.push(statementUid); }
  return { scope, from, to, accountId, statementUid, where: clauses.join(' AND '), params };
}


async function visibleBankTransaction(id, req, db = pool, forUpdate = false) {
  const suffix = forUpdate ? ' FOR UPDATE' : '';
  const [[row]] = await db.query(
    `SELECT bt.*, ba.nickname AS account_name, ba.ownership_scope AS account_scope, ba.created_by AS account_created_by
       FROM bank_transactions bt
       JOIN bank_accounts ba ON ba.id=bt.bank_account_id
      WHERE bt.id=? AND ${privacy.visibilitySql('ba')}${suffix}`,
    [id, ...privacy.visibilityParams(req)]
  );
  if (!row) throw new FinanceError('Bank transaction not found.', 404, 'BANK_TRANSACTION_NOT_FOUND');
  return row;
}

exports.getTransactionDetail = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const row = await visibleBankTransaction(Number(req.params.id || 0), req);
    return res.json({ transaction: row });
  } catch (error) { return fail(res, error, 'Failed to load transaction detail'); }
};

exports.updateTransaction = async (req, res) => {
  let db;
  try {
    await ensureFinanceSchema();
    const id = Number(req.params.id || 0);
    db = await pool.getConnection();
    await db.beginTransaction();
    const row = await visibleBankTransaction(id, req, db, true);

    const category = String(req.body.category || '').trim().slice(0,120) || null;
    const requestedScope = String(req.body.ownership_scope || row.ownership_scope || '').trim().toUpperCase();
    const allowedScopes = new Set(['PERSONAL','BUSINESS','MIXED','UNCLASSIFIED']);
    if (!allowedScopes.has(requestedScope)) throw new FinanceError('Choose Personal, Business, Mixed or Needs owner.', 400, 'INVALID_TRANSACTION_SCOPE');

    const accountScope = String(row.account_scope || '').toUpperCase();
    const canOverrideScope = accountScope === 'MIXED' || accountScope === 'UNCLASSIFIED';
    const nextScope = canOverrideScope ? requestedScope : accountScope || requestedScope;

    const internalTransfer = req.body.is_internal_transfer === true ? 1 : 0;
    const ignored = req.body.ignored === true;
    const ignoredReason = ignored ? String(req.body.ignored_reason || '').trim().slice(0,500) : null;
    if (ignored && ignoredReason.length < 3) throw new FinanceError('Add a short reason before excluding a transaction from reports.', 400, 'IGNORE_REASON_REQUIRED');
    const reconciliationStatus = ignored ? 'IGNORED' : (row.reconciliation_status === 'IGNORED' ? 'UNRECONCILED' : row.reconciliation_status);
    const rememberRule = req.body.remember_rule === true;

    await db.query(
      `UPDATE bank_transactions
          SET category=?, classification_status=?, ownership_scope=?, is_internal_transfer=?,
              reconciliation_status=?, ignored_reason=?
        WHERE id=?`,
      [category, category ? 'CLASSIFIED' : 'UNCLASSIFIED', nextScope, internalTransfer, reconciliationStatus, ignoredReason, id]
    );

    if (rememberRule && category) {
      const pattern = String(row.merchant_name || row.description || '').trim().slice(0,255);
      if (pattern) {
        const [[existing]] = await db.query(
          'SELECT id FROM finance_category_rules WHERE created_by=? AND merchant_pattern=? ORDER BY id DESC LIMIT 1',
          [req.user.id, pattern]
        );
        if (existing) {
          await db.query(
            'UPDATE finance_category_rules SET category=?, ownership_scope=?, enabled=1, priority=250 WHERE id=?',
            [category, canOverrideScope ? nextScope : null, existing.id]
          );
        } else {
          await db.query(
            `INSERT INTO finance_category_rules (rule_uid, merchant_pattern, category, ownership_scope, priority, enabled, created_by)
             VALUES (?, ?, ?, ?, 250, 1, ?)`,
            [uid('RULE'), pattern, category, canOverrideScope ? nextScope : null, req.user.id]
          );
        }
      }
    }

    await logAudit(db, audit(req, {
      action: 'BANK_TRANSACTION_UPDATED',
      module: 'finance_intelligence',
      recordType: 'bank_transaction',
      recordId: id,
      oldValue: {
        category: row.category,
        ownership_scope: row.ownership_scope,
        is_internal_transfer: row.is_internal_transfer,
        reconciliation_status: row.reconciliation_status,
        ignored_reason: row.ignored_reason
      },
      newValue: {
        category,
        ownership_scope: nextScope,
        is_internal_transfer: internalTransfer,
        reconciliation_status: reconciliationStatus,
        ignored_reason: ignoredReason,
        remembered_rule: rememberRule
      }
    }));
    await db.commit();
    const updated = await visibleBankTransaction(id, req);
    return res.json({
      message: rememberRule && category ? 'Transaction updated and merchant rule saved for future imports.' : 'Transaction updated.',
      transaction: updated,
      scope_locked_to_account: !canOverrideScope
    });
  } catch (error) {
    if (db) await db.rollback();
    return fail(res, error, 'Failed to update transaction');
  } finally { if (db) db.release(); }
};

exports.bulkCategorizeTransactions = async (req, res) => {
  let db;
  try {
    await ensureFinanceSchema();
    const ids = [...new Set((Array.isArray(req.body.transaction_ids) ? req.body.transaction_ids : []).map(Number).filter(Number.isInteger))];
    if (!ids.length) throw new FinanceError('Select at least one transaction.', 400, 'TRANSACTIONS_REQUIRED');
    if (ids.length > 200) throw new FinanceError('Bulk category updates are limited to 200 transactions at a time.', 413, 'BULK_CATEGORY_LIMIT');
    const category = String(req.body.category || '').trim().slice(0,120);
    if (!category) throw new FinanceError('Choose a category.', 400, 'CATEGORY_REQUIRED');

    db = await pool.getConnection();
    await db.beginTransaction();
    let updated = 0;
    const visibleIds = [];
    for (const id of ids) {
      try {
        await visibleBankTransaction(id, req, db, true);
        visibleIds.push(id);
      } catch (error) {
        if (error instanceof FinanceError && error.code === 'BANK_TRANSACTION_NOT_FOUND') continue;
        throw error;
      }
    }
    for (const id of visibleIds) {
      const [result] = await db.query(
        "UPDATE bank_transactions SET category=?, classification_status='CLASSIFIED' WHERE id=?",
        [category, id]
      );
      updated += Number(result.affectedRows || 0);
    }
    await logAudit(db, audit(req, {
      action: 'BANK_TRANSACTIONS_BULK_CATEGORIZED',
      module: 'finance_intelligence',
      recordType: 'bank_transaction',
      recordId: visibleIds.join(',').slice(0,180),
      newValue: { category, requested: ids.length, updated }
    }));
    await db.commit();
    return res.json({ message: `${updated} transaction(s) categorised as ${category}.`, updated });
  } catch (error) {
    if (db) await db.rollback();
    return fail(res, error, 'Failed to categorise selected transactions');
  } finally { if (db) db.release(); }
};

exports.getStatementLibrary = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const scope = reportScope(req.query.scope);
    const accountId = Number(req.query.account_id || 0);
    const clauses = [privacy.visibilitySql('ba')];
    const params = [...privacy.visibilityParams(req)];
    if (scope !== 'ALL') { clauses.push('ba.ownership_scope=?'); params.push(scope); }
    if (accountId) { clauses.push('sif.bank_account_id=?'); params.push(accountId); }

    const [rows] = await pool.query(
      `SELECT sif.import_uid, sif.bank_account_id, sif.original_name, sif.source_format, sif.statement_start_date,
              sif.statement_end_date, sif.opening_balance, sif.closing_balance, sif.parse_status, sif.imported_rows,
              sif.duplicate_rows, sif.rejected_rows, sif.reviewed_at, ba.nickname AS account_name, ba.institution,
              ba.ownership_scope, ba.currency,
              COUNT(bt.id) AS linked_transactions,
              COALESCE(SUM(bt.credit),0) AS money_in,
              COALESCE(SUM(bt.debit),0) AS money_out,
              MIN(bt.transaction_date) AS first_transaction_date,
              MAX(bt.transaction_date) AS last_transaction_date,
              SUM(CASE WHEN COALESCE(NULLIF(bt.category,''),'Unclassified')='Unclassified' THEN 1 ELSE 0 END) AS unclassified_transactions
         FROM statement_import_files sif
         JOIN bank_accounts ba ON ba.id=sif.bank_account_id
         LEFT JOIN bank_transactions bt ON bt.statement_import_uid=sif.import_uid AND bt.bank_account_id=sif.bank_account_id
        WHERE ${clauses.join(' AND ')}
        GROUP BY sif.id, ba.id
        ORDER BY COALESCE(sif.reviewed_at, sif.uploaded_at) DESC, sif.id DESC
        LIMIT 200`, params
    );
    return res.json({
      scope,
      statements: rows.map((row) => ({
        ...row,
        linked_transactions: Number(row.linked_transactions || 0),
        legacy_linkage: Number(row.imported_rows || 0) > 0 && Number(row.linked_transactions || 0) === 0
      }))
    });
  } catch (error) { return fail(res, error, 'Failed to load statement library'); }
};

exports.getStatementReport = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const importUid = String(req.params.uid || '').trim();
    if (!importUid) throw new FinanceError('Statement identifier is required.', 400, 'STATEMENT_ID_REQUIRED');

    const [[statement]] = await pool.query(
      `SELECT sif.*, ba.nickname AS account_name, ba.institution, ba.ownership_scope, ba.currency, ba.entity_name
         FROM statement_import_files sif
         JOIN bank_accounts ba ON ba.id=sif.bank_account_id
        WHERE sif.import_uid=? AND ${privacy.visibilitySql('ba')}
        LIMIT 1`,
      [importUid, ...privacy.visibilityParams(req)]
    );
    if (!statement) throw new FinanceError('Statement was not found or is not available to this user.', 404, 'STATEMENT_NOT_FOUND');

    const filters = spendingWhere(req, { statementUid: importUid });
    const [summaryRows, categoryRows, merchantRows, monthlyRows, transactionRows] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS transaction_count,
                COALESCE(SUM(bt.credit),0) AS money_in,
                COALESCE(SUM(bt.debit),0) AS money_out,
                COALESCE(SUM(bt.credit-bt.debit),0) AS net_flow,
                COALESCE(SUM(CASE WHEN bt.category='Cash' THEN bt.debit ELSE 0 END),0) AS cash_spent,
                SUM(CASE WHEN bt.manual_override=1 THEN 1 ELSE 0 END) AS manual_overrides,
                SUM(CASE WHEN COALESCE(NULLIF(bt.category,''),'Unclassified')='Unclassified' THEN 1 ELSE 0 END) AS unclassified
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${filters.where}`, filters.params
      ),
      pool.query(
        `SELECT COALESCE(NULLIF(bt.category,''),'Unclassified') AS category,
                COUNT(*) AS transaction_count, COALESCE(SUM(bt.debit),0) AS spent,
                COALESCE(SUM(bt.credit),0) AS received
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${filters.where}
          GROUP BY COALESCE(NULLIF(bt.category,''),'Unclassified')
          ORDER BY spent DESC, transaction_count DESC`, filters.params
      ),
      pool.query(
        `SELECT COALESCE(NULLIF(bt.merchant_name,''), NULLIF(bt.description,''), 'Unknown') AS merchant,
                COUNT(*) AS transaction_count, COALESCE(SUM(bt.debit),0) AS spent,
                COALESCE(SUM(bt.credit),0) AS received
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${filters.where}
          GROUP BY COALESCE(NULLIF(bt.merchant_name,''), NULLIF(bt.description,''), 'Unknown')
          ORDER BY spent DESC, transaction_count DESC LIMIT 25`, filters.params
      ),
      pool.query(
        `SELECT DATE_FORMAT(bt.transaction_date,'%Y-%m') AS month,
                COALESCE(SUM(bt.debit),0) AS spent, COALESCE(SUM(bt.credit),0) AS received, COUNT(*) AS transaction_count
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${filters.where}
          GROUP BY DATE_FORMAT(bt.transaction_date,'%Y-%m') ORDER BY month`, filters.params
      ),
      pool.query(
        `SELECT bt.id, bt.transaction_date, bt.description, bt.merchant_name, bt.category, bt.debit, bt.credit,
                bt.running_balance, bt.currency, bt.reconciliation_status, bt.manual_override, bt.source_type,
                ba.nickname AS account_name
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${filters.where}
          ORDER BY bt.transaction_date ASC, bt.id ASC LIMIT 5000`, filters.params
      )
    ]);
    const summary = summaryRows[0][0] || {};
    return res.json({
      statement: {
        import_uid: statement.import_uid,
        original_name: statement.original_name,
        source_format: statement.source_format,
        account_name: statement.account_name,
        institution: statement.institution,
        ownership_scope: statement.ownership_scope,
        currency: statement.currency,
        statement_start_date: statement.statement_start_date,
        statement_end_date: statement.statement_end_date,
        opening_balance: statement.opening_balance,
        closing_balance: statement.closing_balance,
        imported_rows: Number(statement.imported_rows || 0),
        duplicate_rows: Number(statement.duplicate_rows || 0),
        rejected_rows: Number(statement.rejected_rows || 0),
        reviewed_at: statement.reviewed_at
      },
      filters: { from: filters.from, to: filters.to },
      summary: {
        transaction_count: Number(summary.transaction_count || 0),
        money_in: summary.money_in || '0.00',
        money_out: summary.money_out || '0.00',
        net_flow: summary.net_flow || '0.00',
        cash_spent: summary.cash_spent || '0.00',
        manual_overrides: Number(summary.manual_overrides || 0),
        unclassified: Number(summary.unclassified || 0)
      },
      categories: categoryRows[0],
      merchants: merchantRows[0],
      monthly: monthlyRows[0],
      transactions: transactionRows[0],
      legacy_linkage: Number(statement.imported_rows || 0) > 0 && Number(summary.transaction_count || 0) === 0
    });
  } catch (error) { return fail(res, error, 'Failed to build statement report'); }
};

exports.getSpendingReport = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const filters = spendingWhere(req);
    const [summaryRows, categoryRows, merchantRows, accountRows, monthlyRows, weekdayRows, transactionRows] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS transaction_count, COALESCE(SUM(bt.credit),0) AS money_in,
                COALESCE(SUM(bt.debit),0) AS money_out, COALESCE(SUM(bt.credit-bt.debit),0) AS net_flow,
                COALESCE(SUM(CASE WHEN bt.category='Cash' THEN bt.debit ELSE 0 END),0) AS cash_spent,
                SUM(CASE WHEN COALESCE(NULLIF(bt.category,''),'Unclassified')='Unclassified' THEN 1 ELSE 0 END) AS unclassified,
                SUM(CASE WHEN bt.manual_override=1 THEN 1 ELSE 0 END) AS manual_overrides
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id WHERE ${filters.where}`, filters.params
      ),
      pool.query(
        `SELECT COALESCE(NULLIF(bt.category,''),'Unclassified') AS category, COUNT(*) AS transaction_count,
                COALESCE(SUM(bt.debit),0) AS spent, COALESCE(SUM(bt.credit),0) AS received
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${filters.where} GROUP BY COALESCE(NULLIF(bt.category,''),'Unclassified')
          ORDER BY spent DESC, transaction_count DESC LIMIT 40`, filters.params
      ),
      pool.query(
        `SELECT COALESCE(NULLIF(bt.merchant_name,''),NULLIF(bt.description,''),'Unknown') AS merchant,
                COUNT(*) AS transaction_count, COALESCE(SUM(bt.debit),0) AS spent, COALESCE(SUM(bt.credit),0) AS received
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${filters.where} GROUP BY COALESCE(NULLIF(bt.merchant_name,''),NULLIF(bt.description,''),'Unknown')
          ORDER BY spent DESC, transaction_count DESC LIMIT 40`, filters.params
      ),
      pool.query(
        `SELECT ba.id AS bank_account_id, ba.nickname AS account_name, ba.ownership_scope, COUNT(*) AS transaction_count,
                COALESCE(SUM(bt.debit),0) AS spent, COALESCE(SUM(bt.credit),0) AS received
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${filters.where} GROUP BY ba.id ORDER BY spent DESC`, filters.params
      ),
      pool.query(
        `SELECT DATE_FORMAT(bt.transaction_date,'%Y-%m') AS month, COUNT(*) AS transaction_count,
                COALESCE(SUM(bt.debit),0) AS spent, COALESCE(SUM(bt.credit),0) AS received
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${filters.where} GROUP BY DATE_FORMAT(bt.transaction_date,'%Y-%m') ORDER BY month`, filters.params
      ),
      pool.query(
        `SELECT DAYNAME(bt.transaction_date) AS weekday, WEEKDAY(bt.transaction_date) AS weekday_index,
                COUNT(*) AS transaction_count, COALESCE(SUM(bt.debit),0) AS spent
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${filters.where} GROUP BY DAYNAME(bt.transaction_date), WEEKDAY(bt.transaction_date)
          ORDER BY weekday_index`, filters.params
      ),
      pool.query(
        `SELECT bt.id, bt.transaction_date, bt.description, bt.merchant_name, bt.category, bt.debit, bt.credit,
                bt.currency, bt.ownership_scope, bt.reconciliation_status, bt.source_type, bt.statement_import_uid,
                bt.manual_override, ba.nickname AS account_name, sif.original_name AS statement_name
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
           LEFT JOIN statement_import_files sif ON sif.import_uid=bt.statement_import_uid AND sif.bank_account_id=bt.bank_account_id
          WHERE ${filters.where}
          ORDER BY bt.transaction_date DESC, bt.id DESC LIMIT 5000`, filters.params
      )
    ]);
    const summary = summaryRows[0][0] || {};
    const totalSpent = Number(summary.money_out || 0);
    const categories = categoryRows[0].map((row) => ({
      ...row,
      percentage_of_spend: totalSpent > 0 ? Number(((Number(row.spent || 0) / totalSpent) * 100).toFixed(2)) : 0
    }));
    return res.json({
      filters: { scope: filters.scope, account_id: filters.accountId || null, statement_uid: filters.statementUid || null, from: filters.from, to: filters.to },
      summary: {
        transaction_count: Number(summary.transaction_count || 0),
        money_in: summary.money_in || '0.00',
        money_out: summary.money_out || '0.00',
        net_flow: summary.net_flow || '0.00',
        cash_spent: summary.cash_spent || '0.00',
        unclassified: Number(summary.unclassified || 0),
        manual_overrides: Number(summary.manual_overrides || 0)
      },
      categories,
      merchants: merchantRows[0],
      accounts: accountRows[0],
      monthly: monthlyRows[0],
      weekdays: weekdayRows[0],
      transactions: transactionRows[0],
      generated_at: new Date().toISOString()
    });
  } catch (error) { return fail(res, error, 'Failed to build spending report'); }
};



exports.getBankingDashboard = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const scope = normalizeDashboardScope(req.query.scope);
    const from = reportDate(req.query.from, 'From date');
    const to = reportDate(req.query.to, 'To date');
    if (from && to && from > to) throw new FinanceError('From date cannot be after To date.', 400, 'INVALID_REPORT_RANGE');

    const accountClauses = ["ba.status='ACTIVE'", privacy.visibilitySql('ba')];
    const accountParams = [...privacy.visibilityParams(req)];
    const txClauses = [privacy.visibilitySql('ba'), "bt.reconciliation_status <> 'IGNORED'"];
    const txParams = [...privacy.visibilityParams(req)];
    if (scope !== 'ALL') {
      accountClauses.push('ba.ownership_scope=?');
      accountParams.push(scope);
      txClauses.push('bt.ownership_scope=?');
      txParams.push(scope);
    }
    if (from) { txClauses.push('bt.transaction_date>=?'); txParams.push(from); }
    if (to) { txClauses.push('bt.transaction_date<=?'); txParams.push(to); }
    const txWhere = txClauses.join(' AND ');

    const [accounts, balances, flow, categories, merchants, monthly, recent, detectedRecurring] = await Promise.all([
      pool.query(
        `SELECT ba.id,ba.nickname,ba.institution,ba.account_number_masked,ba.currency,ba.ownership_scope,
                ba.entity_name,ba.account_type,ba.financial_purpose,ba.connection_type,ba.connection_status,
                ba.current_ledger_balance,ba.available_balance,ba.last_synced_at,
                COUNT(bt.id) AS transaction_count
           FROM bank_accounts ba
           LEFT JOIN bank_transactions bt ON bt.bank_account_id=ba.id
          WHERE ${accountClauses.join(' AND ')}
          GROUP BY ba.id ORDER BY ba.ownership_scope,ba.nickname`,
        accountParams
      ).then(([rows]) => rows),
      pool.query(
        `SELECT ba.currency,COUNT(*) AS account_count,
                COALESCE(SUM(COALESCE(ba.available_balance,ba.current_ledger_balance,0)),0) AS balance
           FROM bank_accounts ba
          WHERE ${accountClauses.join(' AND ')}
          GROUP BY ba.currency ORDER BY ba.currency`,
        accountParams
      ).then(([rows]) => rows),
      pool.query(
        `SELECT bt.currency,COUNT(*) AS transaction_count,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.credit ELSE 0 END),0) AS money_in,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.debit ELSE 0 END),0) AS money_out,
                COALESCE(SUM(CASE WHEN bt.category='Cash' AND bt.is_internal_transfer=0 THEN bt.debit ELSE 0 END),0) AS cash_out,
                SUM(CASE WHEN bt.classification_status='UNCLASSIFIED' THEN 1 ELSE 0 END) AS unclassified
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${txWhere}
          GROUP BY bt.currency ORDER BY bt.currency`,
        txParams
      ).then(([rows]) => rows),
      pool.query(
        `SELECT bt.currency,COALESCE(NULLIF(bt.category,''),'Unclassified') AS category,
                COUNT(*) AS transaction_count,COALESCE(SUM(bt.debit),0) AS spent
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE bt.debit>0 AND bt.is_internal_transfer=0 AND ${txWhere}
          GROUP BY bt.currency,COALESCE(NULLIF(bt.category,''),'Unclassified')
          ORDER BY bt.currency,spent DESC`,
        txParams
      ).then(([rows]) => rows),
      pool.query(
        `SELECT bt.currency,COALESCE(NULLIF(bt.merchant_name,''),NULLIF(bt.description,''),'Unknown') AS merchant,
                COUNT(*) AS transaction_count,COALESCE(SUM(bt.debit),0) AS spent
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE bt.debit>0 AND bt.is_internal_transfer=0 AND ${txWhere}
          GROUP BY bt.currency,COALESCE(NULLIF(bt.merchant_name,''),NULLIF(bt.description,''),'Unknown')
          ORDER BY bt.currency,spent DESC LIMIT 120`,
        txParams
      ).then(([rows]) => rows),
      pool.query(
        `SELECT bt.currency,DATE_FORMAT(bt.transaction_date,'%Y-%m') AS month,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.credit ELSE 0 END),0) AS money_in,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.debit ELSE 0 END),0) AS money_out
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE bt.transaction_date>=DATE_SUB(CURDATE(),INTERVAL 12 MONTH)
            AND ${privacy.visibilitySql('ba')}
            ${scope !== 'ALL' ? 'AND bt.ownership_scope=?' : ''}
            AND bt.reconciliation_status<>'IGNORED'
          GROUP BY bt.currency,DATE_FORMAT(bt.transaction_date,'%Y-%m')
          ORDER BY bt.currency,month`,
        [...privacy.visibilityParams(req), ...(scope !== 'ALL' ? [scope] : [])]
      ).then(([rows]) => rows),
      pool.query(
        `SELECT bt.id,bt.bank_account_id,bt.transaction_date,bt.description,bt.merchant_name,bt.category,
                bt.debit,bt.credit,bt.running_balance,bt.currency,bt.ownership_scope,bt.reconciliation_status,
                bt.is_internal_transfer,bt.source_type,bt.statement_import_uid,ba.nickname AS account_name,
                ba.institution,sif.original_name AS statement_name
           FROM bank_transactions bt
           JOIN bank_accounts ba ON ba.id=bt.bank_account_id
           LEFT JOIN statement_import_files sif ON sif.import_uid=bt.statement_import_uid AND sif.bank_account_id=bt.bank_account_id
          WHERE ${txWhere}
          ORDER BY bt.transaction_date DESC,bt.id DESC LIMIT 40`,
        txParams
      ).then(([rows]) => rows),
      pool.query(
        `SELECT fi.recurring_frequency,fi.merchant_normalized,MAX(bt.transaction_date) AS last_seen,
                COUNT(*) AS matched_transactions,bt.currency,
                COALESCE(NULLIF(bt.merchant_name,''),NULLIF(bt.description,''),fi.merchant_normalized,'Recurring payment') AS merchant,
                AVG(CASE WHEN bt.debit>0 THEN bt.debit ELSE bt.credit END) AS typical_amount
           FROM finance_transaction_insights fi
           JOIN bank_transactions bt ON bt.id=fi.bank_transaction_id
           JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE fi.recurring_frequency IS NOT NULL AND fi.status<>'DISMISSED'
            AND ${privacy.visibilitySql('ba')}
            ${scope !== 'ALL' ? 'AND bt.ownership_scope=?' : ''}
          GROUP BY fi.recurring_frequency,fi.merchant_normalized,bt.currency,merchant
          ORDER BY last_seen DESC LIMIT 30`,
        [...privacy.visibilityParams(req), ...(scope !== 'ALL' ? [scope] : [])]
      ).then(([rows]) => rows)
    ]);

    const currentMonth = new Date().toISOString().slice(0, 7);
    const currencies = [...new Set([
      ...balances.map((row) => row.currency),
      ...flow.map((row) => row.currency),
      ...monthly.map((row) => row.currency)
    ].filter(Boolean))];
    const recurringFactor = (frequency) => {
      const value = String(frequency || '').toUpperCase();
      if (value.includes('WEEK')) return 52 / 12;
      if (value.includes('FORTNIGHT')) return 26 / 12;
      if (value.includes('QUARTER')) return 1 / 3;
      if (value.includes('YEAR') || value.includes('ANNUAL')) return 1 / 12;
      if (value.includes('DAY')) return 365 / 12;
      return 1;
    };
    const intelligence = currencies.map((currency) => {
      const completeMonths = monthly
        .filter((row) => row.currency === currency && row.month < currentMonth)
        .sort((a, b) => String(a.month).localeCompare(String(b.month)));
      const baseline = completeMonths.slice(-3);
      const latest = completeMonths.at(-1) || null;
      const previous = completeMonths.at(-2) || null;
      const avgIncome = baseline.length ? baseline.reduce((sum, row) => sum + Number(row.money_in || 0), 0) / baseline.length : 0;
      const avgSpend = baseline.length ? baseline.reduce((sum, row) => sum + Number(row.money_out || 0), 0) / baseline.length : 0;
      const balance = Number((balances.find((row) => row.currency === currency) || {}).balance || 0);
      const recurringMonthly = detectedRecurring
        .filter((row) => row.currency === currency)
        .reduce((sum, row) => sum + (Number(row.typical_amount || 0) * recurringFactor(row.recurring_frequency)), 0);
      const spendTrendPct = latest && previous && Number(previous.money_out || 0) > 0
        ? ((Number(latest.money_out || 0) - Number(previous.money_out || 0)) / Number(previous.money_out || 0)) * 100
        : null;
      const monthlyFreeCashFlow = avgIncome - avgSpend;
      const runwayMonths = avgSpend > 0 ? balance / avgSpend : null;
      const savingsRatePct = avgIncome > 0 ? (monthlyFreeCashFlow / avgIncome) * 100 : null;
      const subscriptionLoadPct = avgIncome > 0 ? (recurringMonthly / avgIncome) * 100 : null;
      const dailyAverageSpend = avgSpend > 0 ? avgSpend / 30.4375 : 0;
      const forecast30 = balance + monthlyFreeCashFlow;
      const forecast60 = balance + (monthlyFreeCashFlow * 2);
      const forecast90 = balance + (monthlyFreeCashFlow * 3);
      const safeToSpend7d = Math.max(0, balance - recurringMonthly - (dailyAverageSpend * 7));
      const monthSpendValues = baseline.map((row) => Number(row.money_out || 0));
      const spendMean = monthSpendValues.length ? monthSpendValues.reduce((sum, value) => sum + value, 0) / monthSpendValues.length : 0;
      const spendVariance = monthSpendValues.length ? monthSpendValues.reduce((sum, value) => sum + ((value - spendMean) ** 2), 0) / monthSpendValues.length : 0;
      const spendVolatilityPct = spendMean > 0 ? (Math.sqrt(spendVariance) / spendMean) * 100 : null;
      const currencyFlow = flow.find((row) => row.currency === currency) || {};
      const staleConnectedAccounts = accounts.filter((account) => {
        if (account.currency !== currency || account.connection_type !== 'OPEN_BANKING') return false;
        if (!account.last_synced_at) return true;
        const age = Date.now() - new Date(account.last_synced_at).getTime();
        return Number.isFinite(age) && age > (72 * 60 * 60 * 1000);
      }).length;
      const alerts = [];
      if (monthlyFreeCashFlow < 0) alerts.push({ severity: 'HIGH', code: 'NEGATIVE_FREE_CASH_FLOW', message: 'Average monthly spending is above average monthly income.' });
      if (runwayMonths !== null && runwayMonths < 2) alerts.push({ severity: 'HIGH', code: 'LOW_CASH_RUNWAY', message: 'Visible balance is below two average months of spending.' });
      if (spendTrendPct !== null && spendTrendPct >= 20) alerts.push({ severity: 'MEDIUM', code: 'SPEND_ACCELERATION', message: `Latest complete-month spending is ${spendTrendPct.toFixed(1)}% above the prior month.` });
      if (Number(currencyFlow.unclassified || 0) > 0) alerts.push({ severity: 'MEDIUM', code: 'UNCLASSIFIED_TRANSACTIONS', message: `${Number(currencyFlow.unclassified || 0)} transaction(s) still need categorisation.` });
      if (staleConnectedAccounts > 0) alerts.push({ severity: 'MEDIUM', code: 'STALE_BANK_FEED', message: `${staleConnectedAccounts} connected account(s) have not synced within 72 hours.` });
      if (subscriptionLoadPct !== null && subscriptionLoadPct >= 25) alerts.push({ severity: 'MEDIUM', code: 'HIGH_RECURRING_COMMITMENTS', message: `Estimated recurring commitments use ${subscriptionLoadPct.toFixed(1)}% of average monthly income.` });
      if (forecast30 < 0) alerts.push({ severity: 'HIGH', code: 'NEGATIVE_30_DAY_FORECAST', message: 'Current balance plus recent cash-flow trend projects below zero within roughly 30 days.' });
      if (spendVolatilityPct !== null && spendVolatilityPct >= 35) alerts.push({ severity: 'LOW', code: 'SPEND_VOLATILITY', message: `Monthly spending has varied by about ${spendVolatilityPct.toFixed(1)}% around its recent average.` });
      return {
        currency,
        evidence_months: baseline.length,
        confidence: baseline.length >= 3 ? 'HIGH' : baseline.length >= 2 ? 'MEDIUM' : 'LOW',
        average_monthly_income: Number(avgIncome.toFixed(2)),
        average_monthly_spend: Number(avgSpend.toFixed(2)),
        monthly_free_cash_flow: Number(monthlyFreeCashFlow.toFixed(2)),
        estimated_next_month_balance: Number(forecast30.toFixed(2)),
        forecast_30d: Number(forecast30.toFixed(2)),
        forecast_60d: Number(forecast60.toFixed(2)),
        forecast_90d: Number(forecast90.toFixed(2)),
        recurring_monthly_estimate: Number(recurringMonthly.toFixed(2)),
        subscription_load_percent: subscriptionLoadPct === null ? null : Number(subscriptionLoadPct.toFixed(1)),
        savings_rate_percent: savingsRatePct === null ? null : Number(savingsRatePct.toFixed(1)),
        daily_average_spend: Number(dailyAverageSpend.toFixed(2)),
        safe_to_spend_7d: Number(safeToSpend7d.toFixed(2)),
        spend_volatility_percent: spendVolatilityPct === null ? null : Number(spendVolatilityPct.toFixed(1)),
        cash_runway_months: runwayMonths === null ? null : Number(runwayMonths.toFixed(1)),
        spend_trend_percent: spendTrendPct === null ? null : Number(spendTrendPct.toFixed(1)),
        alerts
      };
    });

    return res.json({
      scope,
      period: { from: from || null, to: to || null },
      currency_rule: 'Currencies are never added together. Choose a currency to analyse balances and spending.',
      accounts,
      balances_by_currency: balances.map((row) => ({ currency: row.currency, account_count: Number(row.account_count || 0), balance: Number(row.balance || 0) })),
      flow_by_currency: flow.map((row) => ({
        currency: row.currency,
        transaction_count: Number(row.transaction_count || 0),
        money_in: Number(row.money_in || 0),
        money_out: Number(row.money_out || 0),
        net_flow: Number(row.money_in || 0) - Number(row.money_out || 0),
        cash_out: Number(row.cash_out || 0),
        unclassified: Number(row.unclassified || 0)
      })),
      categories: categories.map((row) => ({ ...row, spent: Number(row.spent || 0), transaction_count: Number(row.transaction_count || 0) })),
      merchants: merchants.map((row) => ({ ...row, spent: Number(row.spent || 0), transaction_count: Number(row.transaction_count || 0) })),
      monthly: monthly.map((row) => ({ ...row, money_in: Number(row.money_in || 0), money_out: Number(row.money_out || 0) })),
      recent_transactions: recent,
      detected_recurring: detectedRecurring.map((row) => ({ ...row, typical_amount: Number(row.typical_amount || 0), matched_transactions: Number(row.matched_transactions || 0) })),
      intelligence_by_currency: intelligence
    });
  } catch (error) { return fail(res, error, 'Failed to load premium banking dashboard'); }
};


function isoUtcDay(date) {
  return date.toISOString().slice(0, 10);
}

function utcDate(value) {
  const text = dateOnly(value);
  if (!text) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addUtcDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function monthAnchor(year, month, day) {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, last)));
}

function bankingBudgetWindow(cycle, anchorValue, nowValue = new Date()) {
  const anchor = utcDate(anchorValue);
  if (!anchor) throw new FinanceError('Budget start date is invalid.', 400, 'INVALID_BUDGET_ANCHOR');
  const now = new Date(Date.UTC(nowValue.getUTCFullYear(), nowValue.getUTCMonth(), nowValue.getUTCDate()));
  if (cycle === 'MONTHLY') {
    const day = anchor.getUTCDate();
    let start = monthAnchor(now.getUTCFullYear(), now.getUTCMonth(), day);
    if (start > now) start = monthAnchor(now.getUTCFullYear(), now.getUTCMonth() - 1, day);
    const end = monthAnchor(start.getUTCFullYear(), start.getUTCMonth() + 1, day);
    return { start: isoUtcDay(start), end: isoUtcDay(end) };
  }
  const days = cycle === 'FORTNIGHTLY' ? 14 : 7;
  const diffDays = Math.floor((now.getTime() - anchor.getTime()) / 86400000);
  const periods = Math.floor(diffDays / days);
  const start = addUtcDays(anchor, periods * days);
  const end = addUtcDays(start, days);
  return { start: isoUtcDay(start), end: isoUtcDay(end) };
}

exports.getBankingBudgets = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const userId = Number(req.user?.id || req.user?.user_id || 0);
    if (!userId) throw new FinanceError('User identity unavailable.', 401, 'USER_REQUIRED');
    const [budgets] = await pool.query(
      `SELECT id,budget_uid,ownership_scope,category,currency,cycle,cycle_anchor_date,limit_amount,active,updated_at
         FROM finance_bank_budgets
        WHERE created_by=? AND active=1
        ORDER BY FIELD(ownership_scope,'BUSINESS','PERSONAL','MIXED','UNCLASSIFIED','ALL'),category`,
      [userId]
    );
    const items = [];
    for (const budget of budgets) {
      const window = bankingBudgetWindow(String(budget.cycle), budget.cycle_anchor_date);
      const clauses = [
        privacy.visibilitySql('ba'),
        "bt.reconciliation_status <> 'IGNORED'",
        'bt.is_internal_transfer=0',
        'bt.currency=?',
        "COALESCE(NULLIF(bt.category,''),'Unclassified')=?",
        'bt.transaction_date>=?',
        'bt.transaction_date<?'
      ];
      const params = [...privacy.visibilityParams(req), budget.currency, budget.category, window.start, window.end];
      if (budget.ownership_scope !== 'ALL') {
        clauses.push('bt.ownership_scope=?');
        params.push(budget.ownership_scope);
      }
      const [[spend]] = await pool.query(
        `SELECT COALESCE(SUM(bt.debit),0) AS spent,COUNT(*) AS transaction_count
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${clauses.join(' AND ')}`,
        params
      );
      const limit = Number(budget.limit_amount || 0);
      const spent = Number(spend.spent || 0);
      items.push({
        ...budget,
        limit_amount: limit,
        spent_amount: spent,
        remaining_amount: Math.round((limit - spent) * 100) / 100,
        used_percent: limit > 0 ? Math.round((spent / limit) * 1000) / 10 : 0,
        transaction_count: Number(spend.transaction_count || 0),
        period_start: window.start,
        period_end_exclusive: window.end
      });
    }
    return res.json({ budgets: items });
  } catch (error) { return fail(res, error, 'Failed to load banking budgets'); }
};

exports.saveBankingBudget = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const userId = Number(req.user?.id || req.user?.user_id || 0);
    if (!userId) throw new FinanceError('User identity unavailable.', 401, 'USER_REQUIRED');
    const scope = String(req.body.ownership_scope || 'PERSONAL').trim().toUpperCase();
    if (!['ALL','PERSONAL','BUSINESS','MIXED','UNCLASSIFIED'].includes(scope)) throw new FinanceError('Choose a valid budget scope.', 400, 'INVALID_BUDGET_SCOPE');
    const category = String(req.body.category || '').trim().slice(0,120);
    if (!category) throw new FinanceError('Budget category is required.', 400, 'BUDGET_CATEGORY_REQUIRED');
    const currency = String(req.body.currency || 'AUD').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new FinanceError('Budget currency must use a three-letter code.', 400, 'INVALID_BUDGET_CURRENCY');
    const cycle = String(req.body.cycle || 'MONTHLY').trim().toUpperCase();
    if (!['WEEKLY','FORTNIGHTLY','MONTHLY'].includes(cycle)) throw new FinanceError('Choose weekly, fortnightly or monthly.', 400, 'INVALID_BUDGET_CYCLE');
    const anchor = dateOnly(req.body.cycle_anchor_date) || new Date().toISOString().slice(0,10);
    const limit = money.fromCents(money.toCents(req.body.limit_amount || 0));
    if (money.toCents(limit) <= 0n) throw new FinanceError('Budget limit must be greater than zero.', 400, 'INVALID_BUDGET_LIMIT');

    const [[existing]] = await pool.query(
      `SELECT id,budget_uid,limit_amount,cycle_anchor_date FROM finance_bank_budgets
        WHERE created_by=? AND ownership_scope=? AND category=? AND currency=? AND cycle=? LIMIT 1`,
      [userId,scope,category,currency,cycle]
    );
    const budgetUid = existing?.budget_uid || uid('BUD');
    if (existing) {
      await pool.query(
        `UPDATE finance_bank_budgets
            SET limit_amount=?,cycle_anchor_date=?,active=1,updated_at=NOW()
          WHERE id=?`,
        [limit,anchor,existing.id]
      );
    } else {
      await pool.query(
        `INSERT INTO finance_bank_budgets
         (budget_uid,created_by,ownership_scope,category,currency,cycle,cycle_anchor_date,limit_amount,active)
         VALUES (?,?,?,?,?,?,?,?,1)`,
        [budgetUid,userId,scope,category,currency,cycle,anchor,limit]
      );
    }
    await logAudit(pool, audit(req, {
      action: existing ? 'BANKING_BUDGET_UPDATED' : 'BANKING_BUDGET_CREATED',
      module: 'finance_intelligence',
      recordType: 'finance_bank_budget',
      recordId: budgetUid,
      oldValue: existing || null,
      newValue: { ownership_scope: scope, category, currency, cycle, cycle_anchor_date: anchor, limit_amount: limit }
    }));
    return res.json({ message: existing ? 'Banking budget updated.' : 'Banking budget created.', budget_uid: budgetUid });
  } catch (error) { return fail(res, error, 'Failed to save banking budget'); }
};

exports.deleteBankingBudget = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const userId = Number(req.user?.id || req.user?.user_id || 0);
    const budgetUid = String(req.params.uid || '').trim();
    const [[existing]] = await pool.query(
      'SELECT * FROM finance_bank_budgets WHERE budget_uid=? AND created_by=? LIMIT 1',
      [budgetUid,userId]
    );
    if (!existing) throw new FinanceError('Banking budget not found.', 404, 'BANKING_BUDGET_NOT_FOUND');
    await pool.query('UPDATE finance_bank_budgets SET active=0,updated_at=NOW() WHERE id=?', [existing.id]);
    await logAudit(pool, audit(req, {
      action: 'BANKING_BUDGET_ARCHIVED',
      module: 'finance_intelligence',
      recordType: 'finance_bank_budget',
      recordId: budgetUid,
      oldValue: existing,
      newValue: { active: 0 }
    }));
    return res.json({ message: 'Budget removed from active tracking.' });
  } catch (error) { return fail(res, error, 'Failed to remove banking budget'); }
};

exports.getAccounts = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const [rows] = await pool.query(
      `SELECT ba.*,
              MIN(bt.transaction_date) AS imported_history_start,
              MAX(bt.transaction_date) AS imported_history_end,
              COUNT(bt.id) AS transaction_count,
              SUM(CASE WHEN bt.reconciliation_status = 'UNRECONCILED' THEN 1 ELSE 0 END) AS unreconciled_count
         FROM bank_accounts ba
         LEFT JOIN bank_transactions bt ON bt.bank_account_id = ba.id
        WHERE ${privacy.visibilitySql('ba')}
        GROUP BY ba.id ORDER BY ba.status = 'ACTIVE' DESC, ba.ownership_scope, ba.nickname`, privacy.visibilityParams(req)
    );
    return res.json({ bank_accounts: rows, privacy: { personal_accounts_owner_only: true } });
  } catch (error) { return fail(res, error, 'Failed to load finance accounts'); }
};

exports.saveAccount = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const nickname = String(req.body.nickname || '').trim();
    if (!nickname) throw new FinanceError('Account nickname is required.', 400, 'BANK_NICKNAME_REQUIRED');
    const currency = String(req.body.currency || 'AUD').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new FinanceError('Enter a valid three-letter currency code.', 400, 'INVALID_CURRENCY');
    const ownershipScope = normalizeScope(req.body.ownership_scope);
    const opening = money.fromCents(money.toCents(req.body.opening_balance || 0));
    const id = Number(req.body.id || 0);
    if (id) {
      const existing = await privacy.assertAccountAccess(pool, id, req);
      await pool.query(
        `UPDATE bank_accounts SET nickname=?, institution=?, bsb_masked=?, account_number_masked=?, currency=?,
         ownership_scope=?, entity_name=?, account_type=?, financial_purpose=?, status=? WHERE id=?`,
        [nickname, req.body.institution || null, req.body.bsb_masked || null, req.body.account_number_masked || null,
          currency, ownershipScope, req.body.entity_name || null, req.body.account_type || null, req.body.financial_purpose || null, req.body.status || 'ACTIVE', id]
      );
      await pool.query('UPDATE bank_transactions SET ownership_scope=? WHERE bank_account_id=?', [ownershipScope, id]);
      await logAudit(pool, audit(req, { action: 'EDITED', module: 'finance_intelligence', recordType: 'bank_account', recordId: id, oldValue: existing, newValue: { ...req.body, ownership_scope: ownershipScope } }));
      return res.json({ message: 'Financial account updated.', bank_account_id: id });
    }
    const [insert] = await pool.query(
      `INSERT INTO bank_accounts
       (nickname, institution, bsb_masked, account_number_masked, currency, opening_balance, current_ledger_balance,
        reconciled_balance, ownership_scope, entity_name, account_type, financial_purpose, connection_type, connection_status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', 'MANUAL', ?)`,
      [nickname, req.body.institution || null, req.body.bsb_masked || null, req.body.account_number_masked || null,
        currency, opening, opening, opening, ownershipScope, req.body.entity_name || null, req.body.account_type || null, req.body.financial_purpose || null, req.user.id]
    );
    await logAudit(pool, audit(req, { action: 'CREATED', module: 'finance_intelligence', recordType: 'bank_account', recordId: insert.insertId, newValue: { nickname, currency, ownership_scope: ownershipScope } }));
    return res.status(201).json({ message: ownershipScope === 'BUSINESS' ? 'Voxel Veda financial account created.' : 'Private financial account created. Only you can access it.', bank_account_id: insert.insertId });
  } catch (error) { return fail(res, error, 'Failed to save financial account'); }
};

exports.importStatementRows = async (req, res) => {
  let db;
  try {
    await ensureFinanceSchema();
    const accountId = Number(req.params.id || 0);
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    const sourceFormat = String(req.body.source_format || 'CSV').toUpperCase();
    if (!['CSV', 'PDF', 'OFX', 'QFX', 'QIF', 'XLSX'].includes(sourceFormat)) throw new FinanceError('Unsupported statement format.', 400, 'UNSUPPORTED_STATEMENT_FORMAT');
    if (sourceFormat !== 'CSV' && !rows.length) throw new FinanceError(`${sourceFormat} extraction adapter is not configured yet. Upload CSV now or configure a statement parser provider.`, 501, 'STATEMENT_PARSER_NOT_CONFIGURED');
    if (!rows.length) throw new FinanceError('No statement rows were supplied.', 400, 'IMPORT_ROWS_REQUIRED');
    if (rows.length > 10000) throw new FinanceError('Statement import is limited to 10,000 rows per batch.', 413, 'IMPORT_TOO_LARGE');

    db = await pool.getConnection();
    await db.beginTransaction();
    const account = await privacy.assertAccountAccess(db, accountId, req, { forUpdate: true });
    if (String(account.status || '').toUpperCase() !== 'ACTIVE') throw new FinanceError('Active financial account not found.', 404, 'BANK_ACCOUNT_NOT_FOUND');
    const importUid = uid('STMT');
    const batchUid = uid('BANK');
    const fileHash = String(req.body.content_hash || '').trim().toLowerCase() || crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    if (!/^[a-f0-9]{64}$/.test(fileHash)) throw new FinanceError('Invalid statement content hash.', 400, 'INVALID_CONTENT_HASH');
    const [[duplicateFile]] = await db.query('SELECT import_uid FROM statement_import_files WHERE bank_account_id=? AND content_hash=? LIMIT 1', [accountId, fileHash]);
    if (duplicateFile) throw new FinanceError(`This statement was already imported as ${duplicateFile.import_uid}.`, 409, 'DUPLICATE_STATEMENT_FILE');

    let imported = 0; let duplicates = 0; const rejected = []; let minDate = null; let maxDate = null;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] || {};
      try {
        const transactionDate = dateOnly(row.transaction_date);
        if (!transactionDate) throw new Error('Invalid date');
        const debit = money.fromCents(money.toCents(row.debit || 0));
        const credit = money.fromCents(money.toCents(row.credit || 0));
        if ((money.toCents(debit) > 0n) === (money.toCents(credit) > 0n)) throw new Error('Enter either debit or credit');
        const hash = rowHash(accountId, { ...row, transaction_date: transactionDate, debit, credit });
        const [insert] = await db.query(
          `INSERT IGNORE INTO bank_transactions
           (bank_account_id, import_batch_uid, row_hash, transaction_date, posting_date, description, reference,
            debit, credit, running_balance, source_type, source_provider, merchant_name, currency, ownership_scope,
            category, classification_status, imported_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'STATEMENT_IMPORT', ?, ?, ?, ?, ?, ?, ?)`,
          [accountId, batchUid, hash, transactionDate, dateOnly(row.posting_date) || null,
            String(row.description || '').trim() || null, String(row.reference || '').trim() || null, debit, credit,
            row.running_balance === '' || row.running_balance === null || row.running_balance === undefined ? null : money.fromCents(money.toCents(row.running_balance)),
            sourceFormat, String(row.merchant_name || '').trim() || null, String(row.currency || account.currency || 'AUD').toUpperCase(),
            account.ownership_scope, String(row.category || '').trim() || null, row.category ? 'CLASSIFIED' : 'UNCLASSIFIED', req.user.id]
        );
        if (insert.affectedRows) { imported += 1; if (!minDate || transactionDate < minDate) minDate = transactionDate; if (!maxDate || transactionDate > maxDate) maxDate = transactionDate; }
        else duplicates += 1;
      } catch (error) { rejected.push({ row: index + 1, message: String(error.message || 'Rejected').slice(0, 180) }); }
    }
    await db.query(`INSERT INTO bank_import_batches (batch_uid, bank_account_id, original_name, imported_rows, duplicate_rows, rejected_rows, imported_by) VALUES (?, ?, ?, ?, ?, ?, ?)`, [batchUid, accountId, req.body.original_name || null, imported, duplicates, rejected.length, req.user.id]);
    await db.query(
      `INSERT INTO statement_import_files
       (import_uid, bank_account_id, source_format, original_name, content_hash, statement_start_date, statement_end_date,
        opening_balance, closing_balance, parse_status, imported_rows, duplicate_rows, rejected_rows, uploaded_by, reviewed_at, reviewed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'IMPORTED', ?, ?, ?, ?, NOW(), ?)`,
      [importUid, accountId, sourceFormat, req.body.original_name || `statement.${sourceFormat.toLowerCase()}`, fileHash,
        dateOnly(req.body.statement_start_date) || minDate, dateOnly(req.body.statement_end_date) || maxDate,
        req.body.opening_balance ?? null, req.body.closing_balance ?? null, imported, duplicates, rejected.length, req.user.id, req.user.id]
    );
    if (minDate || maxDate) {
      await db.query(`UPDATE bank_accounts SET history_start_date = CASE WHEN history_start_date IS NULL OR ? < history_start_date THEN ? ELSE history_start_date END, history_end_date = CASE WHEN history_end_date IS NULL OR ? > history_end_date THEN ? ELSE history_end_date END WHERE id=?`, [minDate, minDate, maxDate, maxDate, accountId]);
    }
    await logAudit(db, audit(req, { action: 'STATEMENT_IMPORTED', module: 'finance_intelligence', recordType: 'statement_import', recordId: importUid, newValue: { bank_account_id: accountId, source_format: sourceFormat, imported, duplicates, rejected: rejected.length } }));
    await db.commit();
    return res.json({ message: `Statement import complete: ${imported} imported, ${duplicates} duplicates, ${rejected.length} rejected.`, import_uid: importUid, batch_uid: batchUid, imported, duplicates, rejected, coverage: { start: minDate, end: maxDate } });
  } catch (error) {
    if (db) await db.rollback();
    return fail(res, error, 'Failed to import statement');
  } finally { if (db) db.release(); }
};

exports.getHistoryCoverage = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const [rows] = await pool.query(
      `SELECT ba.id, ba.nickname, ba.ownership_scope, ba.connection_type, ba.connection_status,
              ba.history_start_date, ba.history_end_date,
              MIN(bt.transaction_date) AS transaction_start, MAX(bt.transaction_date) AS transaction_end,
              SUM(CASE WHEN bt.source_type='OPEN_BANKING' THEN 1 ELSE 0 END) AS open_banking_rows,
              SUM(CASE WHEN bt.source_type='STATEMENT_IMPORT' THEN 1 ELSE 0 END) AS statement_rows
         FROM bank_accounts ba LEFT JOIN bank_transactions bt ON bt.bank_account_id=ba.id
        WHERE ba.status='ACTIVE' AND ${privacy.visibilitySql('ba')}
        GROUP BY ba.id ORDER BY ba.ownership_scope, ba.nickname`, privacy.visibilityParams(req)
    );
    return res.json({ accounts: rows });
  } catch (error) { return fail(res, error, 'Failed to load history coverage'); }
};

exports.getConnectionStatus = async (req, res) => {
  try {
    const provider = String(process.env.BANK_DATA_PROVIDER || '').trim();
    const configured = Boolean(provider && process.env.BANK_DATA_CLIENT_ID && process.env.BANK_DATA_CLIENT_SECRET && process.env.BANK_DATA_REDIRECT_URI);
    const [connections] = await pool.query(`SELECT id, connection_uid, provider, institution, consent_status, consent_expires_at, last_sync_started_at, last_sync_completed_at, last_sync_status, last_sync_error_code, created_at FROM bank_connections ORDER BY created_at DESC`);
    return res.json({ configured, provider: configured ? provider : null, connections, message: configured ? 'Bank data provider configuration is present.' : 'Bank connection requires an Australian Open Banking/CDR provider configuration.' });
  } catch (error) { return fail(res, error, 'Failed to load bank connection status'); }
};

exports.startConnection = async (req, res) => {
  try {
    const provider = String(process.env.BANK_DATA_PROVIDER || '').trim();
    const configured = Boolean(provider && process.env.BANK_DATA_CLIENT_ID && process.env.BANK_DATA_CLIENT_SECRET && process.env.BANK_DATA_REDIRECT_URI);
    if (!configured) throw new FinanceError('Live bank connection is not enabled yet. Configure an Australian Open Banking/CDR provider first; bank usernames, passwords, PINs and OTPs must never be collected by this app.', 503, 'BANK_PROVIDER_NOT_CONFIGURED');
    throw new FinanceError('Provider credentials are configured, but the provider-specific consent adapter has not been verified in production yet.', 501, 'BANK_PROVIDER_ADAPTER_NOT_VERIFIED');
  } catch (error) { return fail(res, error, 'Failed to start bank connection'); }
};

exports.getDataQuality = async (req, res) => {
  try {
    const [[counts]] = await pool.query(
      `SELECT
        SUM(CASE WHEN bt.classification_status='UNCLASSIFIED' THEN 1 ELSE 0 END) AS unclassified,
        SUM(CASE WHEN bt.reconciliation_status='UNRECONCILED' THEN 1 ELSE 0 END) AS unreconciled,
        SUM(CASE WHEN bt.ownership_scope='UNCLASSIFIED' THEN 1 ELSE 0 END) AS ownership_missing
       FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
       WHERE ${privacy.visibilitySql('ba')}`, privacy.visibilityParams(req)
    );
    const [[accounts]] = await pool.query(
      `SELECT SUM(CASE WHEN connection_type='OPEN_BANKING' AND (connection_status IS NULL OR connection_status <> 'CONNECTED') THEN 1 ELSE 0 END) AS disconnected,
              SUM(CASE WHEN history_start_date IS NULL OR history_end_date IS NULL THEN 1 ELSE 0 END) AS coverage_unknown
       FROM bank_accounts ba WHERE status='ACTIVE' AND ${privacy.visibilitySql('ba')}`, privacy.visibilityParams(req)
    );
    return res.json({ issues: {
      unclassified_transactions: Number(counts?.unclassified || 0), unreconciled_transactions: Number(counts?.unreconciled || 0),
      ownership_missing: Number(counts?.ownership_missing || 0), disconnected_accounts: Number(accounts?.disconnected || 0),
      unknown_history_coverage: Number(accounts?.coverage_unknown || 0)
    } });
  } catch (error) { return fail(res, error, 'Failed to load finance data quality'); }
};


exports.getPortfolioHistoryReport = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const filters = spendingWhere(req);
    const accountClauses = [privacy.visibilitySql('ba'), "ba.status='ACTIVE'"];
    const accountParams = [...privacy.visibilityParams(req)];
    if (filters.scope !== 'ALL') { accountClauses.push('ba.ownership_scope=?'); accountParams.push(filters.scope); }
    if (filters.accountId) { accountClauses.push('ba.id=?'); accountParams.push(filters.accountId); }

    const [currencySummaryRows, categoryRows, monthlyRows, accountRows, statementRows, transactionRows] = await Promise.all([
      pool.query(
        `SELECT bt.currency,
                COUNT(*) AS transaction_count,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.credit ELSE 0 END),0) AS money_in,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.debit ELSE 0 END),0) AS money_out,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.credit-bt.debit ELSE 0 END),0) AS net_flow,
                COALESCE(SUM(CASE WHEN bt.category='Cash' AND bt.is_internal_transfer=0 THEN bt.debit ELSE 0 END),0) AS cash_out,
                COALESCE(SUM(CASE WHEN bt.category='Cash' AND bt.is_internal_transfer=0 THEN bt.credit ELSE 0 END),0) AS cash_in,
                SUM(CASE WHEN COALESCE(NULLIF(bt.category,''),'Unclassified')='Unclassified' THEN 1 ELSE 0 END) AS unclassified
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${filters.where}
          GROUP BY bt.currency ORDER BY bt.currency`, filters.params
      ),
      pool.query(
        `SELECT bt.currency,COALESCE(NULLIF(bt.category,''),'Unclassified') AS category,
                COUNT(*) AS transaction_count,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.debit ELSE 0 END),0) AS spent,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.credit ELSE 0 END),0) AS received
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${filters.where}
          GROUP BY bt.currency,COALESCE(NULLIF(bt.category,''),'Unclassified')
          ORDER BY bt.currency,spent DESC`, filters.params
      ),
      pool.query(
        `SELECT bt.currency,DATE_FORMAT(bt.transaction_date,'%Y-%m') AS month,
                COUNT(*) AS transaction_count,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.debit ELSE 0 END),0) AS spent,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.credit ELSE 0 END),0) AS received
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${filters.where}
          GROUP BY bt.currency,DATE_FORMAT(bt.transaction_date,'%Y-%m')
          ORDER BY bt.currency,month`, filters.params
      ),
      pool.query(
        `SELECT ba.id,ba.nickname,ba.institution,ba.account_number_masked,ba.currency,ba.ownership_scope,
                ba.account_type,ba.financial_purpose,ba.available_balance,ba.current_ledger_balance,
                ba.history_start_date,ba.history_end_date,
                COUNT(DISTINCT bt.id) AS transaction_count,
                COUNT(DISTINCT sif.import_uid) AS statement_count,
                MIN(bt.transaction_date) AS transaction_start,
                MAX(bt.transaction_date) AS transaction_end
           FROM bank_accounts ba
           LEFT JOIN bank_transactions bt ON bt.bank_account_id=ba.id
           LEFT JOIN statement_import_files sif ON sif.bank_account_id=ba.id AND sif.parse_status='IMPORTED'
          WHERE ${accountClauses.join(' AND ')}
          GROUP BY ba.id
          ORDER BY ba.currency,ba.ownership_scope,ba.nickname`, accountParams
      ),
      pool.query(
        `SELECT sif.import_uid,sif.bank_account_id,sif.original_name,sif.source_format,sif.statement_start_date,sif.statement_end_date,
                sif.opening_balance,sif.closing_balance,sif.imported_rows,sif.duplicate_rows,sif.rejected_rows,sif.reviewed_at,
                ba.nickname AS account_name,ba.institution,ba.currency,ba.ownership_scope
           FROM statement_import_files sif JOIN bank_accounts ba ON ba.id=sif.bank_account_id
          WHERE sif.parse_status='IMPORTED' AND ${accountClauses.join(' AND ')}
          ORDER BY COALESCE(sif.statement_end_date,sif.reviewed_at) DESC,sif.id DESC`, accountParams
      ),
      pool.query(
        `SELECT bt.id,bt.transaction_date,bt.description,bt.merchant_name,bt.category,bt.debit,bt.credit,bt.currency,
                bt.ownership_scope,bt.is_internal_transfer,bt.reconciliation_status,bt.source_type,bt.statement_import_uid,
                ba.nickname AS account_name,ba.institution,sif.original_name AS statement_name
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
           LEFT JOIN statement_import_files sif ON sif.import_uid=bt.statement_import_uid AND sif.bank_account_id=bt.bank_account_id
          WHERE ${filters.where}
          ORDER BY bt.transaction_date DESC,bt.id DESC LIMIT 10000`, filters.params
      )
    ]);

    const liquidPosition = {};
    for (const account of accountRows[0]) {
      const cur = account.currency || 'AUD';
      const raw = Number(account.available_balance == null ? account.current_ledger_balance : account.available_balance || 0);
      const liability = /credit\s*card|loan|overdraft/i.test(String(account.account_type || ''));
      liquidPosition[cur] = Number(((liquidPosition[cur] || 0) + (liability ? -Math.abs(raw) : raw)).toFixed(2));
    }

    const categoriesByCurrency = {};
    for (const row of categoryRows[0]) {
      const cur = row.currency || 'AUD';
      (categoriesByCurrency[cur] ||= []).push({
        category: row.category,
        transaction_count: Number(row.transaction_count || 0),
        spent: Number(row.spent || 0),
        received: Number(row.received || 0)
      });
    }
    const monthlyByCurrency = {};
    for (const row of monthlyRows[0]) {
      const cur = row.currency || 'AUD';
      (monthlyByCurrency[cur] ||= []).push({
        month: row.month,
        transaction_count: Number(row.transaction_count || 0),
        spent: Number(row.spent || 0),
        received: Number(row.received || 0)
      });
    }

    return res.json({
      filters: { scope: filters.scope, account_id: filters.accountId || null, from: filters.from, to: filters.to },
      currency_rule: 'Currencies are reported separately and are never added together without an explicit FX conversion source.',
      net_position_note: 'Bank net position uses visible bank-account balances and treats credit-card, loan and overdraft accounts as liabilities. It does not include external property, investments or liabilities not stored as bank accounts.',
      bank_net_position_by_currency: liquidPosition,
      summary_by_currency: currencySummaryRows[0].map((row) => ({
        currency: row.currency || 'AUD',
        transaction_count: Number(row.transaction_count || 0),
        money_in: Number(row.money_in || 0),
        money_out: Number(row.money_out || 0),
        net_flow: Number(row.net_flow || 0),
        cash_out: Number(row.cash_out || 0),
        cash_in: Number(row.cash_in || 0),
        unclassified: Number(row.unclassified || 0)
      })),
      categories_by_currency: categoriesByCurrency,
      monthly_by_currency: monthlyByCurrency,
      accounts: accountRows[0].map((row) => ({
        ...row,
        transaction_count: Number(row.transaction_count || 0),
        statement_count: Number(row.statement_count || 0)
      })),
      statements: statementRows[0],
      transactions: transactionRows[0],
      generated_at: new Date().toISOString()
    });
  } catch (error) { return fail(res, error, 'Failed to build multi-bank portfolio history report'); }
};
