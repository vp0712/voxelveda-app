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
    const clauses = [privacy.visibilitySql('ba')];
    const params = [...privacy.visibilityParams(req)];

    if (scope !== 'ALL') { clauses.push('bt.ownership_scope=?'); params.push(scope); }
    if (accountId) { clauses.push('bt.bank_account_id=?'); params.push(accountId); }
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
