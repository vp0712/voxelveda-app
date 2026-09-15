const crypto = require('node:crypto');
const pool = require('../config/db');
const money = require('../utils/money');
const { ensureFinanceSchema } = require('../services/financeSchema');
const { logAudit } = require('../services/auditService');
const { FinanceError, dateOnly } = require('../services/financeDomain');

const VALID_SCOPES = new Set(['PERSONAL', 'BUSINESS', 'MIXED', 'UNCLASSIFIED']);
const DASHBOARD_SCOPES = new Set(['PERSONAL', 'BUSINESS', 'ALL']);

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function audit(req, values) {
  return {
    actorId: req.user?.id,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
    ...values
  };
}

function fail(res, error, message) {
  if (error instanceof FinanceError) {
    return res.status(error.statusCode || 400).json({ message: error.message, code: error.code, issues: error.issues });
  }
  if (error?.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ message: 'A matching finance record already exists.', code: 'DUPLICATE_RECORD' });
  }
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
    row.running_balance === '' || row.running_balance === null || row.running_balance === undefined
      ? '' : money.fromCents(money.toCents(row.running_balance))
  ].join('|')).digest('hex');
}

exports.getOverview = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const scope = normalizeDashboardScope(req.query.scope);
    const scopeWhere = scope === 'ALL' ? '' : 'AND bt.ownership_scope = ?';
    const params = scope === 'ALL' ? [] : [scope];
    const [accountRows] = await pool.query(
      `SELECT ba.id, ba.nickname, ba.institution, ba.account_number_masked, ba.currency,
              ba.ownership_scope, ba.entity_name, ba.account_type, ba.financial_purpose,
              ba.connection_type, ba.connection_status, ba.current_ledger_balance,
              ba.available_balance, ba.history_start_date, ba.history_end_date, ba.last_synced_at,
              (SELECT COUNT(*) FROM bank_transactions bt WHERE bt.bank_account_id = ba.id) AS transaction_count,
              (SELECT COUNT(*) FROM bank_transactions bt WHERE bt.bank_account_id = ba.id AND bt.reconciliation_status = 'UNRECONCILED') AS unreconciled_count
       FROM bank_accounts ba
       WHERE ba.status = 'ACTIVE' ${scope === 'ALL' ? '' : 'AND ba.ownership_scope = ?'}
       ORDER BY ba.ownership_scope, ba.nickname`, params
    );
    const [summaryRows] = await pool.query(
      `SELECT
          COALESCE(SUM(CASE WHEN bt.credit > 0 AND bt.is_internal_transfer = 0 AND bt.reconciliation_status <> 'IGNORED' THEN bt.credit ELSE 0 END),0) AS total_inflow,
          COALESCE(SUM(CASE WHEN bt.debit > 0 AND bt.is_internal_transfer = 0 AND bt.reconciliation_status <> 'IGNORED' THEN bt.debit ELSE 0 END),0) AS total_outflow,
          COUNT(*) AS transaction_count,
          SUM(CASE WHEN bt.classification_status = 'UNCLASSIFIED' THEN 1 ELSE 0 END) AS unclassified_count,
          SUM(CASE WHEN bt.reconciliation_status = 'UNRECONCILED' THEN 1 ELSE 0 END) AS unreconciled_count
       FROM bank_transactions bt
       WHERE 1=1 ${scopeWhere}`, params
    );
    const [categoryRows] = await pool.query(
      `SELECT COALESCE(NULLIF(bt.category,''), 'Unclassified') AS category, SUM(bt.debit) AS amount, COUNT(*) AS transaction_count
       FROM bank_transactions bt
       WHERE bt.debit > 0 AND bt.is_internal_transfer = 0 AND bt.reconciliation_status <> 'IGNORED' ${scopeWhere}
       GROUP BY COALESCE(NULLIF(bt.category,''), 'Unclassified')
       ORDER BY amount DESC LIMIT 12`, params
    );
    const [monthRows] = await pool.query(
      `SELECT DATE_FORMAT(bt.transaction_date, '%Y-%m') AS month,
              SUM(CASE WHEN bt.credit > 0 AND bt.is_internal_transfer = 0 AND bt.reconciliation_status <> 'IGNORED' THEN bt.credit ELSE 0 END) AS inflow,
              SUM(CASE WHEN bt.debit > 0 AND bt.is_internal_transfer = 0 AND bt.reconciliation_status <> 'IGNORED' THEN bt.debit ELSE 0 END) AS outflow
       FROM bank_transactions bt
       WHERE bt.transaction_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH) ${scopeWhere}
       GROUP BY DATE_FORMAT(bt.transaction_date, '%Y-%m') ORDER BY month`, params
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
        account_count: accountRows.length
      },
      accounts: accountRows,
      spending_by_category: categoryRows,
      monthly_cash_flow: monthRows
    });
  } catch (error) {
    return fail(res, error, 'Failed to load Finance Intelligence overview');
  }
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
       GROUP BY ba.id ORDER BY ba.status = 'ACTIVE' DESC, ba.ownership_scope, ba.nickname`
    );
    return res.json({ bank_accounts: rows });
  } catch (error) {
    return fail(res, error, 'Failed to load finance accounts');
  }
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
      const [[existing]] = await pool.query('SELECT * FROM bank_accounts WHERE id = ?', [id]);
      if (!existing) throw new FinanceError('Bank account not found.', 404, 'BANK_ACCOUNT_NOT_FOUND');
      await pool.query(
        `UPDATE bank_accounts SET nickname=?, institution=?, bsb_masked=?, account_number_masked=?, currency=?,
         ownership_scope=?, entity_name=?, account_type=?, financial_purpose=?, status=? WHERE id=?`,
        [nickname, req.body.institution || null, req.body.bsb_masked || null, req.body.account_number_masked || null,
          currency, ownershipScope, req.body.entity_name || null, req.body.account_type || null,
          req.body.financial_purpose || null, req.body.status || 'ACTIVE', id]
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
        currency, opening, opening, opening, ownershipScope, req.body.entity_name || null, req.body.account_type || null,
        req.body.financial_purpose || null, req.user.id]
    );
    await logAudit(pool, audit(req, { action: 'CREATED', module: 'finance_intelligence', recordType: 'bank_account', recordId: insert.insertId, newValue: { nickname, currency, ownership_scope: ownershipScope } }));
    return res.status(201).json({ message: 'Financial account created.', bank_account_id: insert.insertId });
  } catch (error) {
    return fail(res, error, 'Failed to save financial account');
  }
};

exports.importStatementRows = async (req, res) => {
  let db;
  try {
    await ensureFinanceSchema();
    const accountId = Number(req.params.id || 0);
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    const sourceFormat = String(req.body.source_format || 'CSV').toUpperCase();
    if (!['CSV', 'PDF', 'OFX', 'QFX', 'QIF', 'XLSX'].includes(sourceFormat)) throw new FinanceError('Unsupported statement format.', 400, 'UNSUPPORTED_STATEMENT_FORMAT');
    if (sourceFormat !== 'CSV' && !rows.length) {
      throw new FinanceError(`${sourceFormat} extraction adapter is not configured yet. Upload CSV now or configure a statement parser provider.`, 501, 'STATEMENT_PARSER_NOT_CONFIGURED');
    }
    if (!rows.length) throw new FinanceError('No statement rows were supplied.', 400, 'IMPORT_ROWS_REQUIRED');
    if (rows.length > 10000) throw new FinanceError('Statement import is limited to 10,000 rows per batch.', 413, 'IMPORT_TOO_LARGE');

    db = await pool.getConnection();
    await db.beginTransaction();
    const [[account]] = await db.query('SELECT * FROM bank_accounts WHERE id=? AND status="ACTIVE" FOR UPDATE', [accountId]);
    if (!account) throw new FinanceError('Active financial account not found.', 404, 'BANK_ACCOUNT_NOT_FOUND');
    const importUid = uid('STMT');
    const batchUid = uid('BANK');
    const fileHash = String(req.body.content_hash || '').trim().toLowerCase() || crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    if (!/^[a-f0-9]{64}$/.test(fileHash)) throw new FinanceError('Invalid statement content hash.', 400, 'INVALID_CONTENT_HASH');

    const [[duplicateFile]] = await db.query('SELECT import_uid FROM statement_import_files WHERE bank_account_id=? AND content_hash=? LIMIT 1', [accountId, fileHash]);
    if (duplicateFile) throw new FinanceError(`This statement was already imported as ${duplicateFile.import_uid}.`, 409, 'DUPLICATE_STATEMENT_FILE');

    let imported = 0;
    let duplicates = 0;
    const rejected = [];
    let minDate = null;
    let maxDate = null;
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
            String(row.description || '').trim() || null, String(row.reference || '').trim() || null,
            debit, credit, row.running_balance === '' || row.running_balance === null || row.running_balance === undefined ? null : money.fromCents(money.toCents(row.running_balance)),
            sourceFormat, String(row.merchant_name || '').trim() || null, String(row.currency || account.currency || 'AUD').toUpperCase(),
            account.ownership_scope, String(row.category || '').trim() || null, row.category ? 'CLASSIFIED' : 'UNCLASSIFIED', req.user.id]
        );
        if (insert.affectedRows) {
          imported += 1;
          if (!minDate || transactionDate < minDate) minDate = transactionDate;
          if (!maxDate || transactionDate > maxDate) maxDate = transactionDate;
        } else duplicates += 1;
      } catch (error) {
        rejected.push({ row: index + 1, message: String(error.message || 'Rejected').slice(0, 180) });
      }
    }
    await db.query(
      `INSERT INTO bank_import_batches (batch_uid, bank_account_id, original_name, imported_rows, duplicate_rows, rejected_rows, imported_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [batchUid, accountId, req.body.original_name || null, imported, duplicates, rejected.length, req.user.id]
    );
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
      await db.query(
        `UPDATE bank_accounts SET
          history_start_date = CASE WHEN history_start_date IS NULL OR ? < history_start_date THEN ? ELSE history_start_date END,
          history_end_date = CASE WHEN history_end_date IS NULL OR ? > history_end_date THEN ? ELSE history_end_date END
         WHERE id=?`,
        [minDate, minDate, maxDate, maxDate, accountId]
      );
    }
    await logAudit(db, audit(req, { action: 'STATEMENT_IMPORTED', module: 'finance_intelligence', recordType: 'statement_import', recordId: importUid, newValue: { bank_account_id: accountId, source_format: sourceFormat, imported, duplicates, rejected: rejected.length } }));
    await db.commit();
    return res.json({ message: `Statement import complete: ${imported} imported, ${duplicates} duplicates, ${rejected.length} rejected.`, import_uid: importUid, batch_uid: batchUid, imported, duplicates, rejected, coverage: { start: minDate, end: maxDate } });
  } catch (error) {
    if (db) await db.rollback();
    return fail(res, error, 'Failed to import statement');
  } finally {
    if (db) db.release();
  }
};

exports.getHistoryCoverage = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const [rows] = await pool.query(
      `SELECT ba.id, ba.nickname, ba.ownership_scope, ba.connection_type, ba.connection_status,
              ba.history_start_date, ba.history_end_date,
              MIN(bt.transaction_date) AS transaction_start,
              MAX(bt.transaction_date) AS transaction_end,
              SUM(CASE WHEN bt.source_type='OPEN_BANKING' THEN 1 ELSE 0 END) AS open_banking_rows,
              SUM(CASE WHEN bt.source_type='STATEMENT_IMPORT' THEN 1 ELSE 0 END) AS statement_rows
       FROM bank_accounts ba LEFT JOIN bank_transactions bt ON bt.bank_account_id=ba.id
       WHERE ba.status='ACTIVE' GROUP BY ba.id ORDER BY ba.ownership_scope, ba.nickname`
    );
    return res.json({ accounts: rows });
  } catch (error) {
    return fail(res, error, 'Failed to load history coverage');
  }
};

exports.getConnectionStatus = async (req, res) => {
  try {
    const provider = String(process.env.BANK_DATA_PROVIDER || '').trim();
    const configured = Boolean(provider && process.env.BANK_DATA_CLIENT_ID && process.env.BANK_DATA_CLIENT_SECRET && process.env.BANK_DATA_REDIRECT_URI);
    const [connections] = await pool.query(
      `SELECT id, connection_uid, provider, institution, consent_status, consent_expires_at,
              last_sync_started_at, last_sync_completed_at, last_sync_status, last_sync_error_code, created_at
       FROM bank_connections ORDER BY created_at DESC`
    );
    return res.json({ configured, provider: configured ? provider : null, connections, message: configured ? 'Bank data provider configuration is present.' : 'Bank connection requires an Australian Open Banking/CDR provider configuration.' });
  } catch (error) {
    return fail(res, error, 'Failed to load bank connection status');
  }
};

exports.startConnection = async (req, res) => {
  try {
    const provider = String(process.env.BANK_DATA_PROVIDER || '').trim();
    const configured = Boolean(provider && process.env.BANK_DATA_CLIENT_ID && process.env.BANK_DATA_CLIENT_SECRET && process.env.BANK_DATA_REDIRECT_URI);
    if (!configured) {
      throw new FinanceError('Live bank connection is not enabled yet. Configure an Australian Open Banking/CDR provider first; bank usernames, passwords, PINs and OTPs must never be collected by this app.', 503, 'BANK_PROVIDER_NOT_CONFIGURED');
    }
    throw new FinanceError('Provider credentials are configured, but the provider-specific consent adapter has not been verified in production yet.', 501, 'BANK_PROVIDER_ADAPTER_NOT_VERIFIED');
  } catch (error) {
    return fail(res, error, 'Failed to start bank connection');
  }
};

exports.getDataQuality = async (req, res) => {
  try {
    const [[counts]] = await pool.query(
      `SELECT
        SUM(CASE WHEN classification_status='UNCLASSIFIED' THEN 1 ELSE 0 END) AS unclassified,
        SUM(CASE WHEN reconciliation_status='UNRECONCILED' THEN 1 ELSE 0 END) AS unreconciled,
        SUM(CASE WHEN ownership_scope='UNCLASSIFIED' THEN 1 ELSE 0 END) AS ownership_missing
       FROM bank_transactions`
    );
    const [[accounts]] = await pool.query(
      `SELECT SUM(CASE WHEN connection_type='OPEN_BANKING' AND (connection_status IS NULL OR connection_status <> 'CONNECTED') THEN 1 ELSE 0 END) AS disconnected,
              SUM(CASE WHEN history_start_date IS NULL OR history_end_date IS NULL THEN 1 ELSE 0 END) AS coverage_unknown
       FROM bank_accounts WHERE status='ACTIVE'`
    );
    return res.json({
      issues: {
        unclassified_transactions: Number(counts?.unclassified || 0),
        unreconciled_transactions: Number(counts?.unreconciled || 0),
        ownership_missing: Number(counts?.ownership_missing || 0),
        disconnected_accounts: Number(accounts?.disconnected || 0),
        unknown_history_coverage: Number(accounts?.coverage_unknown || 0)
      }
    });
  } catch (error) {
    return fail(res, error, 'Failed to load finance data quality');
  }
};
