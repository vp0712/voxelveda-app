'use strict';

const pool = require('../config/db');
const money = require('../utils/money');
const privacy = require('../services/financePrivacyService');
const { ensureFinanceSchema } = require('../services/financeSchema');
const { FinanceError } = require('../services/financeDomain');
const { logAudit } = require('../services/auditService');

const VALID_STATUS = new Set(['ACTIVE', 'INACTIVE', 'ARCHIVED']);

function audit(req, values) {
  return { actorId: req.user?.id, ipAddress: req.ip, userAgent: req.get('user-agent'), ...values };
}

function fail(res, error, message = 'Bank account lifecycle action failed.') {
  if (error instanceof FinanceError) {
    return res.status(error.statusCode || 400).json({ message: error.message, code: error.code, issues: error.issues });
  }
  console.error(message, error);
  return res.status(500).json({ message, code: 'BANK_ACCOUNT_LIFECYCLE_ERROR' });
}

function quoteIdentifier(value) {
  const input = String(value || '');
  if (!/^[A-Za-z0-9_]+$/.test(input)) throw new Error('Unsafe database identifier.');
  return `\`${input}\``;
}

async function getAccount(req, accountId) {
  await ensureFinanceSchema();
  const account = await privacy.assertAccountAccess(pool, accountId, req);
  if (!account) throw new FinanceError('Financial account not found.', 404, 'BANK_ACCOUNT_NOT_FOUND');
  return account;
}

async function dependencyScan(accountId) {
  try {
    const [columns] = await pool.query(
      `SELECT TABLE_NAME AS table_name
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND COLUMN_NAME = 'bank_account_id'
          AND TABLE_NAME <> 'bank_accounts'
        GROUP BY TABLE_NAME
        ORDER BY TABLE_NAME`
    );
    const dependencies = [];
    for (const row of columns) {
      const table = String(row.table_name || '');
      if (!table) continue;
      const [[countRow]] = await pool.query(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(table)} WHERE bank_account_id=?`, [accountId]);
      const total = Number(countRow?.total || 0);
      if (total > 0) dependencies.push({ table, count: total });
    }
    return {
      verified: true,
      dependencies,
      total_dependencies: dependencies.reduce((sum, item) => sum + Number(item.count || 0), 0),
      safe_to_delete: dependencies.length === 0
    };
  } catch (error) {
    console.error('Bank account dependency scan unavailable.', error);
    return {
      verified: false,
      dependencies: [],
      total_dependencies: null,
      safe_to_delete: false,
      reason: 'The system could not prove that this account has no dependent financial records. Permanent deletion is blocked; archive it instead.'
    };
  }
}

async function setStatus(req, res, targetStatus, actionName, message) {
  try {
    const accountId = Number(req.params.id || 0);
    if (!accountId) throw new FinanceError('Financial account not found.', 404, 'BANK_ACCOUNT_NOT_FOUND');
    const account = await getAccount(req, accountId);
    const currentStatus = String(account.status || 'ACTIVE').toUpperCase();
    if (!VALID_STATUS.has(targetStatus)) throw new FinanceError('Unsupported account status.', 400, 'INVALID_BANK_ACCOUNT_STATUS');
    if (currentStatus === targetStatus) {
      return res.json({ message, bank_account_id: accountId, status: targetStatus, unchanged: true });
    }
    await pool.query('UPDATE bank_accounts SET status=? WHERE id=?', [targetStatus, accountId]);
    await logAudit(pool, audit(req, {
      action: actionName,
      module: 'finance_intelligence',
      recordType: 'bank_account',
      recordId: accountId,
      oldValue: { status: currentStatus },
      newValue: { status: targetStatus }
    }));
    return res.json({ message, bank_account_id: accountId, status: targetStatus });
  } catch (error) {
    return fail(res, error);
  }
}

exports.getLifecycle = async (req, res) => {
  try {
    const accountId = Number(req.params.id || 0);
    if (!accountId) throw new FinanceError('Financial account not found.', 404, 'BANK_ACCOUNT_NOT_FOUND');
    const account = await getAccount(req, accountId);
    const scan = await dependencyScan(accountId);
    return res.json({
      account: {
        id: account.id,
        nickname: account.nickname,
        institution: account.institution || null,
        ownership_scope: account.ownership_scope,
        status: String(account.status || 'ACTIVE').toUpperCase(),
        connection_type: account.connection_type || 'MANUAL'
      },
      lifecycle: {
        can_archive: String(account.status || '').toUpperCase() !== 'ARCHIVED',
        can_restore: String(account.status || '').toUpperCase() !== 'ACTIVE',
        can_exclude_from_analysis: String(account.status || '').toUpperCase() === 'ACTIVE',
        deletion_check: scan
      }
    });
  } catch (error) {
    return fail(res, error, 'Failed to inspect bank account lifecycle.');
  }
};

exports.archive = (req, res) => setStatus(
  req,
  res,
  'ARCHIVED',
  'ARCHIVED',
  'Account archived. Its historical records are preserved and it is removed from active Finance Intelligence analysis.'
);

exports.deactivate = (req, res) => setStatus(
  req,
  res,
  'INACTIVE',
  'DEACTIVATED',
  'Account set inactive and excluded from active Finance Intelligence analysis. Historical records are preserved.'
);

exports.restore = (req, res) => setStatus(
  req,
  res,
  'ACTIVE',
  'RESTORED',
  'Account restored to active use.'
);

exports.remove = async (req, res) => {
  try {
    const accountId = Number(req.params.id || 0);
    if (!accountId) throw new FinanceError('Financial account not found.', 404, 'BANK_ACCOUNT_NOT_FOUND');
    const account = await getAccount(req, accountId);
    const status = String(account.status || 'ACTIVE').toUpperCase();
    if (status === 'ACTIVE') {
      throw new FinanceError('Archive or set the account inactive before permanent deletion.', 409, 'BANK_ACCOUNT_DELETE_REQUIRES_INACTIVE');
    }
    const scan = await dependencyScan(accountId);
    if (!scan.verified) {
      throw new FinanceError(scan.reason, 409, 'BANK_ACCOUNT_DELETE_SAFETY_UNVERIFIED');
    }
    if (!scan.safe_to_delete) {
      const detail = scan.dependencies.slice(0, 6).map((item) => `${item.count} record(s) in ${item.table}`).join(', ');
      throw new FinanceError(
        `This account has financial history and cannot be permanently deleted. Archive it instead. Dependencies: ${detail}.`,
        409,
        'BANK_ACCOUNT_HAS_DEPENDENCIES',
        scan.dependencies
      );
    }
    await logAudit(pool, audit(req, {
      action: 'DELETED',
      module: 'finance_intelligence',
      recordType: 'bank_account',
      recordId: accountId,
      oldValue: {
        nickname: account.nickname,
        institution: account.institution,
        ownership_scope: account.ownership_scope,
        status
      },
      newValue: null,
      metadata: { dependency_scan_verified: true, dependency_count: 0 }
    }));
    await pool.query('DELETE FROM bank_accounts WHERE id=?', [accountId]);
    return res.json({ message: 'Empty bank account permanently deleted.', bank_account_id: accountId, deleted: true });
  } catch (error) {
    return fail(res, error);
  }
};

exports.getActiveOverview = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const requestedScope = String(req.query.scope || 'ALL').trim().toUpperCase();
    const scope = ['ALL', 'PERSONAL', 'BUSINESS'].includes(requestedScope) ? requestedScope : 'ALL';
    const clauses = ["ba.status='ACTIVE'", privacy.visibilitySql('ba')];
    const params = [...privacy.visibilityParams(req)];
    if (scope !== 'ALL') {
      clauses.push('bt.ownership_scope=?');
      params.push(scope);
    }
    const where = clauses.join(' AND ');
    const [summaryRows] = await pool.query(
      `SELECT
          COALESCE(SUM(CASE WHEN bt.credit > 0 AND bt.is_internal_transfer = 0 AND bt.reconciliation_status <> 'IGNORED' THEN bt.credit ELSE 0 END),0) AS total_inflow,
          COALESCE(SUM(CASE WHEN bt.debit > 0 AND bt.is_internal_transfer = 0 AND bt.reconciliation_status <> 'IGNORED' THEN bt.debit ELSE 0 END),0) AS total_outflow,
          COUNT(*) AS transaction_count,
          SUM(CASE WHEN bt.classification_status='UNCLASSIFIED' THEN 1 ELSE 0 END) AS unclassified_count,
          SUM(CASE WHEN bt.reconciliation_status='UNRECONCILED' THEN 1 ELSE 0 END) AS unreconciled_count
         FROM bank_transactions bt
         JOIN bank_accounts ba ON ba.id=bt.bank_account_id
        WHERE ${where}`,
      params
    );
    const accountClauses = ["ba.status='ACTIVE'", privacy.visibilitySql('ba')];
    const accountParams = [...privacy.visibilityParams(req)];
    if (scope !== 'ALL') {
      accountClauses.push('ba.ownership_scope=?');
      accountParams.push(scope);
    }
    const [[accountCount]] = await pool.query(`SELECT COUNT(*) AS total FROM bank_accounts ba WHERE ${accountClauses.join(' AND ')}`, accountParams);
    const [categoryRows] = await pool.query(
      `SELECT COALESCE(NULLIF(bt.category,''),'Unclassified') AS category, SUM(bt.debit) AS amount, COUNT(*) AS transaction_count
         FROM bank_transactions bt
         JOIN bank_accounts ba ON ba.id=bt.bank_account_id
        WHERE bt.debit>0 AND bt.is_internal_transfer=0 AND bt.reconciliation_status<>'IGNORED' AND ${where}
        GROUP BY COALESCE(NULLIF(bt.category,''),'Unclassified')
        ORDER BY amount DESC LIMIT 12`,
      params
    );
    const summary = summaryRows[0] || {};
    const inflow = money.toCents(summary.total_inflow || 0);
    const outflow = money.toCents(summary.total_outflow || 0);
    return res.json({
      scope,
      summary: {
        total_inflow: money.fromCents(inflow),
        total_outflow: money.fromCents(outflow),
        net_cash_flow: money.fromCents(inflow - outflow),
        transaction_count: Number(summary.transaction_count || 0),
        unclassified_count: Number(summary.unclassified_count || 0),
        unreconciled_count: Number(summary.unreconciled_count || 0),
        account_count: Number(accountCount?.total || 0)
      },
      spending_by_category: categoryRows
    });
  } catch (error) {
    return fail(res, error, 'Failed to load active account overview.');
  }
};

exports._test = { dependencyScan, quoteIdentifier };
