const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { hasPermission } = require('../services/authorizationService');
const { companyProfile } = require('../config/companyProfile');
const { ensureFinanceSchema } = require('../services/financeSchema');
const { logAudit } = require('../services/auditService');
const money = require('../utils/money');
const {
  FinanceError,
  FINANCIAL_YEAR_STATUSES,
  dateOnly,
  financialYearForDate,
  basQuarterForDate,
  validateTransaction,
  validateJournal,
  blockingIssues
} = require('../services/financeDomain');

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function requestAudit(req, values = {}) {
  return {
    actorId: req.user?.id,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
    ...values
  };
}

function sendError(res, error, fallback) {
  if (error instanceof FinanceError) {
    return res.status(error.statusCode).json({ message: error.message, code: error.code, issues: error.issues });
  }
  console.error(`${fallback}:`, error);
  return res.status(500).json({ message: fallback, error: error.message });
}

function dateOnlyText(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

function normalizeDateFields(row, fields) {
  if (!row) return row;
  fields.forEach((field) => {
    if (row[field] !== null && row[field] !== undefined) row[field] = dateOnlyText(row[field]);
  });
  return row;
}

async function settingsRow(db = pool) {
  const [[row]] = await db.query(`SELECT * FROM finance_settings WHERE id = 1`);
  return row;
}

async function yearForEffectiveDate(value, db = pool) {
  const effectiveDate = dateOnly(value);
  if (!effectiveDate) throw new FinanceError('A valid effective date is required.', 400, 'DATE_REQUIRED');
  const [[year]] = await db.query(
    `SELECT * FROM financial_years WHERE ? BETWEEN start_date AND end_date LIMIT 1`,
    [effectiveDate]
  );
  if (!year) throw new FinanceError('No configured financial year contains this date.', 409, 'FINANCIAL_YEAR_NOT_CONFIGURED');
  return year;
}

async function assertPeriodOpen(value, db = pool) {
  const effectiveDate = dateOnly(value);
  const [[period]] = await db.query(
    `SELECT ap.*, fy.status AS financial_year_status
     FROM accounting_periods ap
     JOIN financial_years fy ON fy.id = ap.financial_year_id
     WHERE ? BETWEEN ap.start_date AND ap.end_date LIMIT 1`,
    [effectiveDate]
  );
  if (!period) throw new FinanceError('Accounting period is not configured.', 409, 'PERIOD_NOT_CONFIGURED');
  if (period.status === 'LOCKED' || ['LOCKED', 'ARCHIVED'].includes(period.financial_year_status)) {
    throw new FinanceError('This accounting period is locked. Contact Finance Admin for a controlled adjustment.', 423, 'PERIOD_LOCKED');
  }
  return period;
}

async function taxCodeRow(code, db = pool) {
  const [[row]] = await db.query(`SELECT * FROM tax_codes WHERE code = ? AND active = 1 LIMIT 1`, [String(code || '').toUpperCase()]);
  return row;
}

async function upsertIssue(db, issue) {
  const fingerprint = crypto.createHash('sha256')
    .update([issue.financial_year_id || '', issue.module, issue.record_type || '', issue.record_id || '', issue.issue_type].join('|'))
    .digest('hex');
  await db.query(
    `INSERT INTO finance_issues
     (fingerprint, financial_year_id, severity, issue_type, module, record_type, record_id, title, message, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')
     ON DUPLICATE KEY UPDATE severity = VALUES(severity), title = VALUES(title), message = VALUES(message),
       status = IF(status = 'RESOLVED', 'OPEN', status), updated_at = CURRENT_TIMESTAMP`,
    [fingerprint, issue.financial_year_id || null, issue.severity, issue.issue_type, issue.module,
      issue.record_type || null, issue.record_id ? String(issue.record_id) : null, issue.title, issue.message]
  );
}

async function runChecks(financialYearId, actorId = null) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[year]] = await connection.query(`SELECT * FROM financial_years WHERE id = ? FOR UPDATE`, [financialYearId]);
    if (!year) throw new FinanceError('Financial year not found.', 404, 'FINANCIAL_YEAR_NOT_FOUND');

    await connection.query(
      `UPDATE finance_issues SET status = 'RESOLVED', resolved_at = NOW(), resolved_by = ?
       WHERE financial_year_id = ? AND status IN ('OPEN', 'IN_PROGRESS') AND issue_type LIKE 'AUTO_%'`,
      [actorId, year.id]
    );

    const [[settings]] = await connection.query(`SELECT * FROM finance_settings WHERE id = 1`);
    if (settings.gst_registered === null) {
      await upsertIssue(connection, {
        financial_year_id: year.id,
        severity: 'BLOCKING_ERROR', issue_type: 'AUTO_FINANCE_SETUP', module: 'finance', record_type: 'settings', record_id: 1,
        title: 'GST registration setting required', message: 'Confirm the company GST registration status in Finance Setup before finalising financial records.'
      });
    }

    const [unmappedAccounts] = await connection.query(
      `SELECT id, account_code, account_name FROM chart_of_accounts WHERE active = 1 AND mapping_status = 'REVIEW_REQUIRED'`
    );
    for (const account of unmappedAccounts) {
      await upsertIssue(connection, {
        financial_year_id: year.id,
        severity: 'WARNING', issue_type: 'AUTO_ACCOUNT_MAPPING', module: 'finance', record_type: 'account', record_id: account.id,
        title: `Review account ${account.account_code}`, message: `${account.account_name} requires accountant mapping confirmation.`
      });
    }

    const [legacyExpenses] = await connection.query(
      `SELECT e.id, e.supplier_name, e.category, e.invoice_no, e.total_amount,
         (SELECT COUNT(*) FROM expense_files ef WHERE ef.expense_id = e.id AND ef.deleted = 0) AS document_count
       FROM expenses e WHERE e.deleted = 0 AND e.expense_date BETWEEN ? AND ?`,
      [year.start_date, year.end_date]
    );
    for (const expense of legacyExpenses) {
      if (!String(expense.supplier_name || '').trim()) {
        await upsertIssue(connection, {
          financial_year_id: year.id, severity: 'BLOCKING_ERROR', issue_type: 'AUTO_EXPENSE_SUPPLIER', module: 'expenses',
          record_type: 'expense', record_id: expense.id, title: 'Expense supplier missing', message: `Expense ${expense.id} must have a supplier before year-end review.`
        });
      }
      if (!String(expense.category || '').trim()) {
        await upsertIssue(connection, {
          financial_year_id: year.id, severity: 'BLOCKING_ERROR', issue_type: 'AUTO_EXPENSE_CATEGORY', module: 'expenses',
          record_type: 'expense', record_id: expense.id, title: 'Expense category missing', message: `Expense ${expense.id} must be categorised and mapped to an account.`
        });
      }
      if (!Number(expense.document_count || 0)) {
        await upsertIssue(connection, {
          financial_year_id: year.id, severity: 'WARNING', issue_type: 'AUTO_EXPENSE_DOCUMENT', module: 'expenses',
          record_type: 'expense', record_id: expense.id, title: 'Expense evidence missing', message: `Expense ${expense.id} has no receipt or supplier document attached.`
        });
      }
    }

    const [duplicateExpenses] = await connection.query(
      `SELECT MIN(id) AS record_id, supplier_name, expense_date, total_amount, COUNT(*) AS duplicate_count
       FROM expenses WHERE deleted = 0 AND expense_date BETWEEN ? AND ?
       GROUP BY LOWER(TRIM(supplier_name)), expense_date, total_amount HAVING COUNT(*) > 1`,
      [year.start_date, year.end_date]
    );
    for (const row of duplicateExpenses) {
      await upsertIssue(connection, {
        financial_year_id: year.id, severity: 'WARNING', issue_type: 'AUTO_POSSIBLE_DUPLICATE_EXPENSE', module: 'expenses',
        record_type: 'expense', record_id: row.record_id, title: 'Possible duplicate expense',
        message: `${row.duplicate_count} expenses share supplier, date and total $${money.fromCents(money.toCents(row.total_amount))}. Review before posting.`
      });
    }

    const [duplicateInvoices] = await connection.query(
      `SELECT MIN(id) AS record_id, invoice_no, COUNT(*) AS duplicate_count FROM invoices
       WHERE (deleted = 0 OR deleted IS NULL) AND invoice_no IS NOT NULL AND TRIM(invoice_no) <> ''
       AND DATE(created_at) BETWEEN ? AND ? GROUP BY invoice_no HAVING COUNT(*) > 1`,
      [year.start_date, year.end_date]
    );
    for (const row of duplicateInvoices) {
      await upsertIssue(connection, {
        financial_year_id: year.id, severity: 'BLOCKING_ERROR', issue_type: 'AUTO_DUPLICATE_INVOICE_NUMBER', module: 'invoices',
        record_type: 'invoice', record_id: row.record_id, title: 'Duplicate invoice number',
        message: `Invoice number ${row.invoice_no} appears ${row.duplicate_count} times. Resolve before financial close.`
      });
    }

    const [unbalanced] = await connection.query(
      `SELECT id, journal_uid, total_debit, total_credit FROM journal_entries
       WHERE financial_year_id = ? AND status = 'POSTED' AND total_debit <> total_credit`, [year.id]
    );
    for (const row of unbalanced) {
      await upsertIssue(connection, {
        financial_year_id: year.id, severity: 'BLOCKING_ERROR', issue_type: 'AUTO_UNBALANCED_JOURNAL', module: 'journals',
        record_type: 'journal', record_id: row.id, title: 'Financial integrity error',
        message: `Journal ${row.journal_uid} is unbalanced and requires Finance Admin review.`
      });
    }

    const [[counts]] = await connection.query(
      `SELECT
        SUM(status IN ('OPEN', 'IN_PROGRESS') AND severity = 'BLOCKING_ERROR') AS blocking_count,
        SUM(status IN ('OPEN', 'IN_PROGRESS') AND severity = 'WARNING') AS warning_count,
        SUM(status IN ('OPEN', 'IN_PROGRESS') AND severity = 'INFO') AS info_count
       FROM finance_issues WHERE financial_year_id = ?`, [year.id]
    );
    const blocking = Number(counts.blocking_count || 0);
    const warnings = Number(counts.warning_count || 0);
    const infos = Number(counts.info_count || 0);
    const readiness = Math.max(0, Math.min(100, 100 - (blocking * 10) - (warnings * 2) - infos));
    await connection.query(
      `UPDATE financial_years SET readiness_score = ?, blocking_issue_count = ?, warning_issue_count = ? WHERE id = ?`,
      [readiness, blocking, warnings, year.id]
    );
    await connection.commit();
    return { financial_year_id: year.id, readiness_score: readiness, blocking, warnings, info: infos, status: blocking ? 'FAIL' : warnings ? 'WARNING' : 'PASS' };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

exports.getOverview = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const requested = Number(req.query.financial_year_id || 0);
    const current = financialYearForDate(new Date().toISOString().slice(0, 10));
    const [[year]] = await pool.query(
      requested ? `SELECT * FROM financial_years WHERE id = ?` : `SELECT * FROM financial_years WHERE label = ?`,
      [requested || current.label]
    );
    if (!year) throw new FinanceError('Financial year not found.', 404, 'FINANCIAL_YEAR_NOT_FOUND');

    const [[invoice]] = await pool.query(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total,
       COALESCE(SUM(CASE WHEN LOWER(status) NOT IN ('paid', 'void', 'deleted') THEN total ELSE 0 END), 0) AS outstanding
       FROM invoices WHERE (deleted = 0 OR deleted IS NULL) AND DATE(created_at) BETWEEN ? AND ?`, [year.start_date, year.end_date]
    );
    const [[expense]] = await pool.query(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS total, COALESCE(SUM(gst_amount), 0) AS gst
       FROM expenses WHERE deleted = 0 AND expense_date BETWEEN ? AND ?`, [year.start_date, year.end_date]
    );
    const [[payments]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS collected FROM invoice_payments WHERE payment_date BETWEEN ? AND ?`, [year.start_date, year.end_date]
    );
    const [[finance]] = await pool.query(
      `SELECT COUNT(*) AS count,
       SUM(status = 'POSTED') AS posted_count,
       SUM(reconciliation_status = 'UNRECONCILED' AND status = 'POSTED') AS unreconciled_count
       FROM finance_transactions WHERE financial_year_id = ?`, [year.id]
    );
    const [[payables]] = await pool.query(
      `SELECT COALESCE(SUM(total_amount - paid_amount), 0) AS outstanding, SUM(status = 'OVERDUE') AS overdue_count
       FROM supplier_bills WHERE issue_date BETWEEN ? AND ? AND status NOT IN ('PAID', 'VOID')`, [year.start_date, year.end_date]
    );
    const [issueCounts] = await pool.query(
      `SELECT severity, COUNT(*) AS count FROM finance_issues
       WHERE financial_year_id = ? AND status IN ('OPEN', 'IN_PROGRESS') GROUP BY severity`, [year.id]
    );
    res.json({
      financial_year: normalizeDateFields(year, ['start_date', 'end_date']),
      cards: {
        recorded_revenue: money.fromCents(money.toCents(payments.collected)),
        recorded_expenses: money.fromCents(money.toCents(expense.total)),
        gross_result: money.subtract(payments.collected, expense.total),
        gst_paid: money.fromCents(money.toCents(expense.gst)),
        outstanding_invoices: money.fromCents(money.toCents(invoice.outstanding)),
        outstanding_supplier_bills: money.fromCents(money.toCents(payables.outstanding)),
        unreconciled_transactions: Number(finance.unreconciled_count || 0),
        finance_transactions: Number(finance.count || 0),
        posted_transactions: Number(finance.posted_count || 0)
      },
      source_counts: { invoices: Number(invoice.count || 0), expenses: Number(expense.count || 0) },
      issues: Object.fromEntries(issueCounts.map((row) => [row.severity, Number(row.count || 0)])),
      notes: ['Recorded operational values are shown separately from posted-ledger reports until legacy records are reviewed and mapped.']
    });
  } catch (error) {
    return sendError(res, error, 'Failed to load finance overview');
  }
};

exports.getFinancialYears = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const [rows] = await pool.query(`SELECT * FROM financial_years ORDER BY start_date DESC`);
    res.json({ financial_years: rows.map((row) => normalizeDateFields(row, ['start_date', 'end_date'])) });
  } catch (error) {
    return sendError(res, error, 'Failed to load financial years');
  }
};

exports.runYearEndCheck = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const result = await runChecks(Number(req.params.id), req.user.id);
    await logAudit(pool, requestAudit(req, { action: 'YEAR_END_CHECK', module: 'finance', recordType: 'financial_year', recordId: req.params.id, newValue: result }));
    res.json({ message: 'Financial-year readiness check completed.', result });
  } catch (error) {
    return sendError(res, error, 'Failed to run financial-year check');
  }
};

exports.updateFinancialYearStatus = async (req, res) => {
  let connection;
  try {
    await ensureFinanceSchema();
    const id = Number(req.params.id);
    const status = String(req.body.status || '').toUpperCase();
    const reason = String(req.body.reason || '').trim();
    const confirmation = String(req.body.confirmation || '').trim();
    if (!FINANCIAL_YEAR_STATUSES.has(status)) throw new FinanceError('Invalid financial-year status.');

    // Run readiness checks before locking the year row. The check writes issue
    // records and must not wait behind this request's own FOR UPDATE lock.
    if (status === 'LOCKED') {
      const result = await runChecks(id, req.user.id);
      if (result.blocking > 0) throw new FinanceError('Financial year cannot be locked while blocking issues remain.', 409, 'FINANCIAL_YEAR_NOT_READY');
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[year]] = await connection.query(`SELECT * FROM financial_years WHERE id = ? FOR UPDATE`, [id]);
    if (!year) throw new FinanceError('Financial year not found.', 404);
    if (status === 'LOCKED') {
      if (confirmation !== `LOCK ${year.label}`) throw new FinanceError(`Type LOCK ${year.label} to confirm.`, 400, 'CONFIRMATION_REQUIRED');
      if (!reason) throw new FinanceError('A lock reason is required.');
    }
    if (year.status === 'LOCKED' && status !== 'LOCKED' && !reason) throw new FinanceError('An unlock reason is required.');
    await connection.query(
      `UPDATE financial_years SET status = ?, locked_at = ?, locked_by = ?, lock_reason = ? WHERE id = ?`,
      [status, status === 'LOCKED' ? new Date() : null, status === 'LOCKED' ? req.user.id : null, reason || year.lock_reason, id]
    );
    await logAudit(connection, requestAudit(req, { action: status === 'LOCKED' ? 'LOCKED' : 'STATUS_CHANGED', module: 'finance', recordType: 'financial_year', recordId: id, oldValue: year, newValue: { status, reason } }));
    await connection.commit();
    res.json({ message: `Financial year status changed to ${status}.` });
  } catch (error) {
    if (connection) await connection.rollback();
    return sendError(res, error, 'Failed to update financial year');
  } finally {
    if (connection) connection.release();
  }
};

exports.getIssues = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const clauses = ['1 = 1'];
    const params = [];
    for (const [queryKey, column] of [['financial_year_id', 'financial_year_id'], ['severity', 'severity'], ['status', 'status'], ['module', 'module']]) {
      if (req.query[queryKey]) { clauses.push(`${column} = ?`); params.push(req.query[queryKey]); }
    }
    const [rows] = await pool.query(
      `SELECT * FROM finance_issues WHERE ${clauses.join(' AND ')} ORDER BY FIELD(severity, 'BLOCKING_ERROR', 'WARNING', 'INFO'), created_at DESC LIMIT 500`,
      params
    );
    res.json({ issues: rows });
  } catch (error) {
    return sendError(res, error, 'Failed to load finance issues');
  }
};

exports.updateIssue = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const status = String(req.body.status || '').toUpperCase();
    const reason = String(req.body.reason || '').trim();
    if (!['OPEN', 'IN_PROGRESS', 'RESOLVED', 'IGNORED'].includes(status)) throw new FinanceError('Invalid issue status.');
    const [[issue]] = await pool.query(`SELECT * FROM finance_issues WHERE id = ?`, [req.params.id]);
    if (!issue) throw new FinanceError('Issue not found.', 404);
    if (status === 'IGNORED' && issue.severity === 'BLOCKING_ERROR') throw new FinanceError('Blocking finance issues cannot be ignored.', 409, 'BLOCKING_ISSUE');
    if (['RESOLVED', 'IGNORED'].includes(status) && !reason) throw new FinanceError('A resolution reason is required.');
    await pool.query(
      `UPDATE finance_issues SET status = ?, resolution_note = ?, ignored_reason = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`,
      [status, status === 'RESOLVED' ? reason : null, status === 'IGNORED' ? reason : null,
        ['RESOLVED', 'IGNORED'].includes(status) ? req.user.id : null, ['RESOLVED', 'IGNORED'].includes(status) ? new Date() : null, req.params.id]
    );
    await logAudit(pool, requestAudit(req, { action: 'ISSUE_STATUS_CHANGED', module: 'finance', recordType: 'finance_issue', recordId: req.params.id, oldValue: issue, newValue: { status, reason } }));
    res.json({ message: 'Finance issue updated.' });
  } catch (error) {
    return sendError(res, error, 'Failed to update finance issue');
  }
};

exports.getSetup = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const settings = await settingsRow();
    const [taxCodes] = await pool.query(`SELECT * FROM tax_codes ORDER BY code`);
    const [accounts] = await pool.query(`SELECT * FROM chart_of_accounts ORDER BY account_code`);
    res.json({ settings, tax_codes: taxCodes, accounts });
  } catch (error) {
    return sendError(res, error, 'Failed to load Finance Setup');
  }
};

exports.updateSetup = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const current = await settingsRow();
    const gstRegistered = req.body.gst_registered === null || req.body.gst_registered === '' ? null : (req.body.gst_registered ? 1 : 0);
    const currency = String(req.body.default_currency || 'AUD').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new FinanceError('Currency must be a three-letter code.');
    await pool.query(
      `UPDATE finance_settings SET default_currency = ?, gst_registered = ?, default_gst_rate = ?, amounts_include_gst = ?,
       receipt_required_above = ?, approval_manager_limit = ?, approval_finance_limit = ?, accountant_email = ?, entity_type = ?,
       setup_status = ?, updated_by = ? WHERE id = 1`,
      [currency, gstRegistered, money.fromCents(money.toCents(req.body.default_gst_rate || 10)), req.body.amounts_include_gst ? 1 : 0,
        req.body.receipt_required_above === '' ? null : money.fromCents(money.toCents(req.body.receipt_required_above || 0)),
        money.fromCents(money.toCents(req.body.approval_manager_limit ?? current.approval_manager_limit ?? 500)),
        money.fromCents(money.toCents(req.body.approval_finance_limit ?? current.approval_finance_limit ?? 5000)),
        String(req.body.accountant_email || '').trim() || null, String(req.body.entity_type || '').trim() || null,
        gstRegistered === null ? 'INCOMPLETE' : 'READY_FOR_REVIEW', req.user.id]
    );
    await logAudit(pool, requestAudit(req, { action: 'EDITED', module: 'finance', recordType: 'finance_settings', recordId: 1, newValue: req.body }));
    res.json({ message: 'Finance settings saved for review.' });
  } catch (error) {
    return sendError(res, error, 'Failed to update Finance Setup');
  }
};

exports.getTransaction = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const [[row]] = await pool.query(
      `SELECT ft.*, fy.label AS financial_year, tc.code AS tax_code,
       da.account_code AS debit_account_code, da.account_name AS debit_account_name,
       ca.account_code AS credit_account_code, ca.account_name AS credit_account_name
       FROM finance_transactions ft
       JOIN financial_years fy ON fy.id = ft.financial_year_id
       LEFT JOIN tax_codes tc ON tc.id = ft.tax_code_id
       LEFT JOIN chart_of_accounts da ON da.id = ft.debit_account_id
       LEFT JOIN chart_of_accounts ca ON ca.id = ft.credit_account_id
       WHERE ft.id = ?`,
      [req.params.id]
    );
    if (!row) throw new FinanceError('Finance transaction not found.', 404, 'TRANSACTION_NOT_FOUND');
    res.json({ transaction: normalizeDateFields(row, ['effective_date']) });
  } catch (error) {
    return sendError(res, error, 'Failed to load finance transaction');
  }
};

exports.getTransactions = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(10, Number(req.query.limit || 25)));
    const offset = (page - 1) * limit;
    const clauses = ['1 = 1'];
    const params = [];
    if (req.query.financial_year_id) { clauses.push('ft.financial_year_id = ?'); params.push(req.query.financial_year_id); }
    if (req.query.status) { clauses.push('ft.status = ?'); params.push(String(req.query.status).toUpperCase()); }
    if (req.query.type) { clauses.push('ft.transaction_type = ?'); params.push(String(req.query.type).toUpperCase()); }
    if (req.query.search) {
      clauses.push(`(ft.transaction_uid LIKE ? OR ft.reference LIKE ? OR ft.description LIKE ? OR ft.party_name LIKE ? OR ft.invoice_bill_reference LIKE ?)`);
      const term = `%${String(req.query.search).trim()}%`;
      params.push(term, term, term, term, term);
    }
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM finance_transactions ft WHERE ${clauses.join(' AND ')}`, params);
    const [rows] = await pool.query(
      `SELECT ft.*, fy.label AS financial_year, tc.code AS tax_code,
       da.account_code AS debit_account_code, da.account_name AS debit_account_name,
       ca.account_code AS credit_account_code, ca.account_name AS credit_account_name
       FROM finance_transactions ft
       JOIN financial_years fy ON fy.id = ft.financial_year_id
       LEFT JOIN tax_codes tc ON tc.id = ft.tax_code_id
       LEFT JOIN chart_of_accounts da ON da.id = ft.debit_account_id
       LEFT JOIN chart_of_accounts ca ON ca.id = ft.credit_account_id
       WHERE ${clauses.join(' AND ')} ORDER BY ft.effective_date ASC, ft.id ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({
      transactions: rows.map((row) => normalizeDateFields(row, ['effective_date'])),
      total: Number(count.total || 0),
      page,
      limit
    });
  } catch (error) {
    return sendError(res, error, 'Failed to load finance transactions');
  }
};

exports.saveTransaction = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await ensureFinanceSchema();
    await connection.beginTransaction();
    const id = Number(req.body.id || 0);
    const settings = await settingsRow(connection);
    const taxCode = await taxCodeRow(req.body.tax_code, connection);
    const year = await yearForEffectiveDate(req.body.effective_date, connection);
    await assertPeriodOpen(req.body.effective_date, connection);
    const validation = validateTransaction({ ...req.body, tax_code: taxCode?.code }, {
      gstRate: taxCode?.rate || settings.default_gst_rate,
      amountsIncludeGst: Boolean(settings.amounts_include_gst)
    });
    const blockers = blockingIssues(validation.issues);
    const requestedStatus = String(req.body.status || 'DRAFT').toUpperCase();
    const status = blockers.length ? 'INCOMPLETE' : requestedStatus === 'READY' ? 'READY' : 'DRAFT';
    if (requestedStatus === 'READY' && blockers.length) {
      throw new FinanceError('This transaction is not ready.', 422, 'TRANSACTION_INCOMPLETE', validation.issues);
    }
    if (req.body.tax_override && !hasPermission(req.user, 'OVERRIDE_TAX')) {
      throw new FinanceError('GST override requires Finance Admin permission.', 403, 'GST_OVERRIDE_FORBIDDEN');
    }

    let recordId = id;
    let oldValue = null;
    if (id) {
      [[oldValue]] = await connection.query(`SELECT * FROM finance_transactions WHERE id = ? FOR UPDATE`, [id]);
      if (!oldValue) throw new FinanceError('Transaction not found.', 404);
      if (['POSTED', 'RECONCILED', 'LOCKED', 'VOID'].includes(oldValue.status)) {
        throw new FinanceError('Posted financial records cannot be edited. Use a controlled correction or void workflow.', 409, 'POSTED_RECORD_IMMUTABLE');
      }
      await connection.query(
        `UPDATE finance_transactions SET reference = ?, effective_date = ?, transaction_type = ?, description = ?, party_name = ?,
         customer_id = ?, supplier_id = ?, job_reference = ?, debit_account_id = ?, credit_account_id = ?, category = ?, subcategory = ?,
         net_amount = ?, gst_amount = ?, gross_amount = ?, tax_code_id = ?, tax_override = ?, tax_override_reason = ?, payment_method = ?,
         bank_account_id = ?, invoice_bill_reference = ?, notes = ?, status = ?, financial_year_id = ?, bas_quarter = ?, updated_by = ? WHERE id = ?`,
        [req.body.reference || null, validation.effectiveDate, validation.type, String(req.body.description).trim(), req.body.party_name || null,
          req.body.customer_id || null, req.body.supplier_id || null, req.body.job_reference || null, req.body.debit_account_id || null,
          req.body.credit_account_id || null, req.body.category || null, req.body.subcategory || null, validation.net, validation.gst, validation.gross,
          taxCode?.id || null, req.body.tax_override ? 1 : 0, req.body.tax_override_reason || null, req.body.payment_method || null,
          req.body.bank_account_id || null, req.body.invoice_bill_reference || null, req.body.notes || null, status, year.id,
          basQuarterForDate(validation.effectiveDate, settings.financial_year_start_month), req.user.id, id]
      );
    } else {
      const transactionUid = uid('TXN');
      const [result] = await connection.query(
        `INSERT INTO finance_transactions
         (transaction_uid, reference, effective_date, transaction_type, description, party_name, customer_id, supplier_id, job_reference,
          debit_account_id, credit_account_id, category, subcategory, net_amount, gst_amount, gross_amount, tax_code_id, tax_override,
          tax_override_reason, payment_method, bank_account_id, invoice_bill_reference, notes, status, financial_year_id, bas_quarter, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [transactionUid, req.body.reference || null, validation.effectiveDate, validation.type, String(req.body.description).trim(), req.body.party_name || null,
          req.body.customer_id || null, req.body.supplier_id || null, req.body.job_reference || null, req.body.debit_account_id || null,
          req.body.credit_account_id || null, req.body.category || null, req.body.subcategory || null, validation.net, validation.gst, validation.gross,
          taxCode?.id || null, req.body.tax_override ? 1 : 0, req.body.tax_override_reason || null, req.body.payment_method || null,
          req.body.bank_account_id || null, req.body.invoice_bill_reference || null, req.body.notes || null, status, year.id,
          basQuarterForDate(validation.effectiveDate, settings.financial_year_start_month), req.user.id, req.user.id]
      );
      recordId = result.insertId;
    }
    await logAudit(connection, requestAudit(req, { action: id ? 'EDITED' : 'CREATED', module: 'finance', recordType: 'transaction', recordId, oldValue, newValue: { ...req.body, status, validation_issues: validation.issues } }));
    await connection.commit();
    res.json({ message: status === 'INCOMPLETE' ? 'Draft saved with issues requiring attention.' : 'Finance transaction saved.', transaction_id: recordId, status, issues: validation.issues });
  } catch (error) {
    await connection.rollback();
    return sendError(res, error, 'Failed to save finance transaction');
  } finally {
    connection.release();
  }
};

async function createJournalForTransaction(connection, transaction, actorId) {
  const [[taxCode]] = await connection.query(`SELECT * FROM tax_codes WHERE id = ?`, [transaction.tax_code_id]);
  const taxable = ['GST_ON_INCOME', 'GST_ON_EXPENSES'].includes(taxCode?.code) && money.toCents(transaction.gst_amount) !== 0n;
  const expenseType = ['EXPENSE', 'SUPPLIER_BILL', 'SUPPLIER_PAYMENT', 'ASSET_PURCHASE', 'PAYROLL'].includes(transaction.transaction_type);
  const [[gstAccount]] = taxable
    ? await connection.query(`SELECT id FROM chart_of_accounts WHERE account_code = '2100' LIMIT 1`)
    : [[]];
  if (taxable && !gstAccount) throw new FinanceError('GST Clearing account is missing from the Chart of Accounts.', 409, 'GST_ACCOUNT_MISSING');

  const lines = [];
  if (!taxable) {
    lines.push({ account_id: transaction.debit_account_id, debit: transaction.gross_amount, credit: '0.00', description: transaction.description });
    lines.push({ account_id: transaction.credit_account_id, debit: '0.00', credit: transaction.gross_amount, description: transaction.description });
  } else if (expenseType) {
    lines.push({ account_id: transaction.debit_account_id, debit: transaction.net_amount, credit: '0.00', description: transaction.description });
    lines.push({ account_id: gstAccount.id, debit: transaction.gst_amount, credit: '0.00', description: 'GST credit' });
    lines.push({ account_id: transaction.credit_account_id, debit: '0.00', credit: transaction.gross_amount, description: transaction.description });
  } else {
    lines.push({ account_id: transaction.debit_account_id, debit: transaction.gross_amount, credit: '0.00', description: transaction.description });
    lines.push({ account_id: transaction.credit_account_id, debit: '0.00', credit: transaction.net_amount, description: transaction.description });
    lines.push({ account_id: gstAccount.id, debit: '0.00', credit: transaction.gst_amount, description: 'GST payable' });
  }
  const validation = validateJournal(lines);
  if (blockingIssues(validation.issues).length) throw new FinanceError('Cannot post journal.', 422, 'UNBALANCED_JOURNAL', validation.issues);
  const journalUid = uid('JRN');
  const [result] = await connection.query(
    `INSERT INTO journal_entries
     (journal_uid, entry_date, reference, description, financial_year_id, source_transaction_id, status, total_debit, total_credit, posted_at, posted_by, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'POSTED', ?, ?, NOW(), ?, ?)`,
    [journalUid, transaction.effective_date, transaction.reference || transaction.transaction_uid, transaction.description,
      transaction.financial_year_id, transaction.id, validation.totalDebit, validation.totalCredit, actorId, actorId]
  );
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    await connection.query(
      `INSERT INTO journal_lines
       (journal_entry_id, line_no, account_id, description, debit, credit, customer_id, supplier_id, job_reference, tax_code_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [result.insertId, index + 1, line.account_id, line.description, line.debit, line.credit,
        transaction.customer_id, transaction.supplier_id, transaction.job_reference, transaction.tax_code_id]
    );
  }
  return { journalId: result.insertId, journalUid, validation };
}

exports.postTransaction = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await ensureFinanceSchema();
    await connection.beginTransaction();
    const [[transaction]] = await connection.query(
      `SELECT ft.*, tc.code AS tax_code, tc.rate AS tax_rate FROM finance_transactions ft
       LEFT JOIN tax_codes tc ON tc.id = ft.tax_code_id WHERE ft.id = ? FOR UPDATE`, [req.params.id]
    );
    if (!transaction) throw new FinanceError('Transaction not found.', 404);
    if (transaction.status === 'POSTED') throw new FinanceError('This transaction has already been posted.', 409, 'ALREADY_POSTED');
    if (['RECONCILED', 'LOCKED', 'VOID'].includes(transaction.status)) throw new FinanceError('This transaction cannot be posted in its current state.', 409);
    await assertPeriodOpen(transaction.effective_date, connection);
    const settings = await settingsRow(connection);
    const validation = validateTransaction({
      ...transaction,
      type: transaction.transaction_type,
      document_count: 1
    }, {
      gstRate: transaction.tax_rate || settings.default_gst_rate,
      amountsIncludeGst: Boolean(settings.amounts_include_gst)
    });
    const blockers = blockingIssues(validation.issues);
    if (blockers.length) throw new FinanceError('This transaction cannot be posted because required information is incomplete.', 422, 'CANNOT_POST', validation.issues);
    const journal = await createJournalForTransaction(connection, transaction, req.user.id);
    await connection.query(`UPDATE finance_transactions SET status = 'POSTED', posted_at = NOW(), posted_by = ?, updated_by = ? WHERE id = ?`, [req.user.id, req.user.id, transaction.id]);
    await logAudit(connection, requestAudit(req, { action: 'POSTED', module: 'finance', recordType: 'transaction', recordId: transaction.id, oldValue: transaction, newValue: { status: 'POSTED', journal_uid: journal.journalUid } }));
    await connection.commit();
    res.json({ message: 'Transaction posted and balanced journal created.', journal_uid: journal.journalUid });
  } catch (error) {
    await connection.rollback();
    return sendError(res, error, 'Failed to post transaction');
  } finally {
    connection.release();
  }
};

exports.voidTransaction = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await ensureFinanceSchema();
    await connection.beginTransaction();
    const reason = String(req.body.reason || '').trim();
    if (!reason) throw new FinanceError('A reason is required to void a posted transaction.', 400, 'VOID_REASON_REQUIRED');

    const [[transaction]] = await connection.query(
      `SELECT * FROM finance_transactions WHERE id = ? FOR UPDATE`,
      [req.params.id]
    );
    if (!transaction) throw new FinanceError('Transaction not found.', 404, 'TRANSACTION_NOT_FOUND');
    if (transaction.status === 'VOID') throw new FinanceError('This transaction has already been voided.', 409, 'ALREADY_VOID');
    if (transaction.status !== 'POSTED') {
      throw new FinanceError('Only a posted, unreconciled transaction can use the controlled void workflow.', 409, 'VOID_NOT_ALLOWED');
    }
    await assertPeriodOpen(transaction.effective_date, connection);

    const [[originalJournal]] = await connection.query(
      `SELECT * FROM journal_entries WHERE source_transaction_id = ? AND status = 'POSTED' FOR UPDATE`,
      [transaction.id]
    );
    if (!originalJournal) throw new FinanceError('The posted journal could not be found. Review this record before continuing.', 409, 'POSTED_JOURNAL_MISSING');
    const [originalLines] = await connection.query(
      `SELECT * FROM journal_lines WHERE journal_entry_id = ? ORDER BY line_no`,
      [originalJournal.id]
    );
    if (!originalLines.length) throw new FinanceError('The posted journal has no ledger lines.', 409, 'JOURNAL_LINES_MISSING');

    const reversalLines = originalLines.map((line) => ({
      account_id: line.account_id,
      description: `Reversal: ${line.description || transaction.description}`,
      debit: money.fromCents(money.toCents(line.credit || 0)),
      credit: money.fromCents(money.toCents(line.debit || 0)),
      customer_id: line.customer_id,
      supplier_id: line.supplier_id,
      job_reference: line.job_reference,
      tax_code_id: line.tax_code_id
    }));
    const validation = validateJournal(reversalLines);
    if (blockingIssues(validation.issues).length) {
      throw new FinanceError('The reversal journal is not balanced.', 422, 'REVERSAL_UNBALANCED', validation.issues);
    }

    const reversalUid = uid('JRN-REV');
    const [journalResult] = await connection.query(
      `INSERT INTO journal_entries
       (journal_uid, entry_date, reference, description, financial_year_id, source_transaction_id, status,
        total_debit, total_credit, reversal_of_id, posted_at, posted_by, created_by)
       VALUES (?, ?, ?, ?, ?, NULL, 'POSTED', ?, ?, ?, NOW(), ?, ?)`,
      [reversalUid, transaction.effective_date, transaction.reference || transaction.transaction_uid,
        `Void reversal: ${transaction.description} | ${reason}`, transaction.financial_year_id,
        validation.totalDebit, validation.totalCredit, originalJournal.id, req.user.id, req.user.id]
    );
    for (let index = 0; index < reversalLines.length; index += 1) {
      const line = reversalLines[index];
      await connection.query(
        `INSERT INTO journal_lines
         (journal_entry_id, line_no, account_id, description, debit, credit, customer_id, supplier_id, job_reference, tax_code_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [journalResult.insertId, index + 1, line.account_id, line.description, line.debit, line.credit,
          line.customer_id, line.supplier_id, line.job_reference, line.tax_code_id]
      );
    }
    await connection.query(
      `UPDATE finance_transactions
       SET status = 'VOID', voided_at = NOW(), voided_by = ?, void_reason = ?, updated_by = ?
       WHERE id = ?`,
      [req.user.id, reason, req.user.id, transaction.id]
    );
    await logAudit(connection, requestAudit(req, {
      action: 'VOIDED', module: 'finance', recordType: 'transaction', recordId: transaction.id,
      oldValue: transaction,
      newValue: { status: 'VOID', reason, reversal_journal_uid: reversalUid }
    }));
    await connection.commit();
    res.json({ message: 'Transaction voided with a balanced reversal journal.', reversal_journal_uid: reversalUid });
  } catch (error) {
    await connection.rollback();
    return sendError(res, error, 'Failed to void transaction');
  } finally {
    connection.release();
  }
};

exports.getJournals = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const params = [];
    let where = '';
    if (req.query.financial_year_id) { where = 'WHERE je.financial_year_id = ?'; params.push(req.query.financial_year_id); }
    const [rows] = await pool.query(
      `SELECT je.*, fy.label AS financial_year FROM journal_entries je JOIN financial_years fy ON fy.id = je.financial_year_id
       ${where} ORDER BY je.entry_date ASC, je.id ASC LIMIT 500`, params
    );
    res.json({ journals: rows.map((row) => normalizeDateFields(row, ['entry_date'])) });
  } catch (error) {
    return sendError(res, error, 'Failed to load journals');
  }
};

exports.createJournal = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await ensureFinanceSchema();
    await connection.beginTransaction();
    const entryDate = dateOnly(req.body.entry_date);
    const year = await yearForEffectiveDate(entryDate, connection);
    await assertPeriodOpen(entryDate, connection);
    const validation = validateJournal(req.body.lines);
    if (blockingIssues(validation.issues).length) throw new FinanceError('Cannot post journal.', 422, 'UNBALANCED_JOURNAL', validation.issues);
    if (!String(req.body.description || '').trim()) throw new FinanceError('Journal description and business reason are required.');
    const status = req.body.post ? 'POSTED' : 'DRAFT';
    const journalUid = uid('JRN');
    const [result] = await connection.query(
      `INSERT INTO journal_entries
       (journal_uid, entry_date, reference, description, financial_year_id, status, total_debit, total_credit, posted_at, posted_by, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [journalUid, entryDate, req.body.reference || null, String(req.body.description).trim(), year.id, status,
        validation.totalDebit, validation.totalCredit, status === 'POSTED' ? new Date() : null, status === 'POSTED' ? req.user.id : null, req.user.id]
    );
    for (let index = 0; index < req.body.lines.length; index += 1) {
      const line = req.body.lines[index];
      await connection.query(
        `INSERT INTO journal_lines (journal_entry_id, line_no, account_id, description, debit, credit, job_reference)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [result.insertId, index + 1, line.account_id, line.description || null,
          money.fromCents(money.toCents(line.debit || 0)), money.fromCents(money.toCents(line.credit || 0)), line.job_reference || null]
      );
    }
    await logAudit(connection, requestAudit(req, { action: status === 'POSTED' ? 'POSTED' : 'CREATED', module: 'finance', recordType: 'journal', recordId: result.insertId, newValue: { journal_uid: journalUid, ...validation } }));
    await connection.commit();
    res.json({ message: status === 'POSTED' ? 'Balanced journal posted.' : 'Journal draft saved.', journal_id: result.insertId, journal_uid: journalUid });
  } catch (error) {
    await connection.rollback();
    return sendError(res, error, 'Failed to create journal');
  } finally {
    connection.release();
  }
};

async function reportRows(financialYearId) {
  if (!Number.isInteger(financialYearId) || financialYearId < 1) {
    throw new FinanceError('Financial year is required.', 400, 'FINANCIAL_YEAR_REQUIRED');
  }
  const [[year]] = await pool.query(`SELECT * FROM financial_years WHERE id = ?`, [financialYearId]);
  if (!year) throw new FinanceError('Financial year not found.', 404);
  const [trialBalance] = await pool.query(
    `SELECT coa.account_code, coa.account_name, coa.account_type, coa.reporting_category,
     COALESCE(SUM(jl.debit), 0) AS debit, COALESCE(SUM(jl.credit), 0) AS credit,
     COALESCE(SUM(jl.debit - jl.credit), 0) AS balance
     FROM chart_of_accounts coa
     LEFT JOIN journal_lines jl ON jl.account_id = coa.id
     LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.status = 'POSTED' AND je.financial_year_id = ?
     WHERE coa.active = 1 GROUP BY coa.id ORDER BY coa.account_code`, [year.id]
  );
  const debit = trialBalance.reduce((sum, row) => sum + money.toCents(row.debit), 0n);
  const credit = trialBalance.reduce((sum, row) => sum + money.toCents(row.credit), 0n);
  const grouped = trialBalance.reduce((acc, row) => {
    const key = row.account_type;
    acc[key] = (acc[key] || 0n) + money.toCents(row.balance);
    return acc;
  }, {});
  return {
    year: normalizeDateFields(year, ['start_date', 'end_date']),
    trial_balance: trialBalance,
    totals: { debit: money.fromCents(debit), credit: money.fromCents(credit), difference: money.fromCents(debit - credit), balanced: debit === credit },
    profit_loss: {
      revenue: money.fromCents(-(grouped.REVENUE || 0n)),
      cost_of_sales: money.fromCents(grouped.COST_OF_SALES || 0n),
      expenses: money.fromCents(grouped.EXPENSE || 0n),
      other_income: money.fromCents(-(grouped.OTHER_INCOME || 0n)),
      other_expenses: money.fromCents(grouped.OTHER_EXPENSE || 0n),
      net_result: money.fromCents(-(grouped.REVENUE || 0n) - (grouped.COST_OF_SALES || 0n) - (grouped.EXPENSE || 0n) - (grouped.OTHER_EXPENSE || 0n) - (grouped.OTHER_INCOME || 0n))
    },
    balance_sheet: {
      assets: money.fromCents(grouped.ASSET || 0n),
      liabilities: money.fromCents(-(grouped.LIABILITY || 0n)),
      equity: money.fromCents(-(grouped.EQUITY || 0n))
    }
  };
}

exports.getReports = async (req, res) => {
  try {
    await ensureFinanceSchema();
    res.json(await reportRows(Number(req.query.financial_year_id)));
  } catch (error) {
    return sendError(res, error, 'Failed to generate financial reports');
  }
};

exports.downloadTrialBalanceCsv = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const report = await reportRows(Number(req.query.financial_year_id));
    const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [['Account Code', 'Account', 'Type', 'Debit', 'Credit', 'Balance'].map(escape).join(',')];
    report.trial_balance.forEach((row) => lines.push([row.account_code, row.account_name, row.account_type, row.debit, row.credit, row.balance].map(escape).join(',')));
    lines.push(['', 'TOTAL', '', report.totals.debit, report.totals.credit, report.totals.difference].map(escape).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Voxel-Veda-${report.year.label}-Trial-Balance.csv"`);
    res.send(`\uFEFF${lines.join('\r\n')}`);
  } catch (error) {
    return sendError(res, error, 'Failed to export trial balance');
  }
};

exports.downloadAccountantPdf = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const report = await reportRows(Number(req.query.financial_year_id));
    const profile = companyProfile();
    const doc = new PDFDocument({ size: 'A4', margins: { top: 50, left: 48, right: 48, bottom: 50 }, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Voxel-Veda-${report.year.label}-Accountant-Review.pdf"`);
    doc.pipe(res);
    doc.fontSize(20).fillColor('#0b5f75').text(profile.legalName);
    doc.fontSize(28).fillColor('#111827').text('Financial Year Accountant Review Pack', { align: 'left' });
    doc.moveDown().fontSize(14).text(report.year.label);
    doc.fontSize(10).fillColor('#4b5563').text(`${String(report.year.start_date).slice(0, 10)} to ${String(report.year.end_date).slice(0, 10)}`);
    doc.moveDown().fillColor('#111827').fontSize(12).text(`Status: ${report.year.status}`);
    doc.text(`Readiness: ${report.year.readiness_score}%`);
    doc.text(`Blocking issues: ${report.year.blocking_issue_count}`);
    doc.moveDown().fontSize(16).text('Trial Balance');
    doc.fontSize(9);
    for (const row of report.trial_balance) {
      if (doc.y > 730) doc.addPage();
      doc.text(`${row.account_code}  ${row.account_name}`, 48, doc.y, { width: 260, continued: true });
      doc.text(`D ${money.fromCents(money.toCents(row.debit))}   C ${money.fromCents(money.toCents(row.credit))}`, { align: 'right' });
    }
    doc.moveDown().fontSize(11).text(`Total Debits: $${report.totals.debit}`);
    doc.text(`Total Credits: $${report.totals.credit}`);
    doc.text(`Difference: $${report.totals.difference}`);
    doc.text(`Status: ${report.totals.balanced ? 'BALANCED' : 'FINANCIAL INTEGRITY ERROR'}`);
    const pages = doc.bufferedPageRange();
    for (let index = 0; index < pages.count; index += 1) {
      doc.switchToPage(index);
      doc.fontSize(8).fillColor('#6b7280').text(
        `Generated ${new Date().toLocaleString('en-AU')} | Draft for accountant review | Page ${index + 1} of ${pages.count}`,
        48, 790, { width: 499, align: 'center' }
      );
    }
    await logAudit(pool, requestAudit(req, { action: 'EXPORTED', module: 'finance', recordType: 'accountant_pack_pdf', recordId: report.year.id, newValue: { financial_year: report.year.label } }));
    doc.end();
  } catch (error) {
    if (!res.headersSent) return sendError(res, error, 'Failed to generate accountant PDF');
    res.end();
  }
};

module.exports.runChecks = runChecks;
