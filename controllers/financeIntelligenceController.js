const crypto = require('node:crypto');
const pool = require('../config/db');
const money = require('../utils/money');
const { ensureFinanceSchema } = require('../services/financeSchema');
const { logAudit } = require('../services/auditService');
const { FinanceError, dateOnly } = require('../services/financeDomain');
const privacy = require('../services/financePrivacyService');
const trustedTotals = require('../services/financeTrustedTotals');
const { buildCoreBankTransactionFilter } = require('../services/financeFilterContract');
const { cleanMerchant, normalizeTags, normalizeGstTreatment, upsertExactAutoCategoryRule } = require('../services/financeRuleEngine');

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
    const accountClauses = ["ba.status = 'ACTIVE'", privacy.visibilitySql('ba', req)];
    const accountParams = [...privacy.visibilityParams(req)];
    if (scope !== 'ALL') { accountClauses.push('ba.ownership_scope = ?'); accountParams.push(scope); }
    const txClauses = [privacy.visibilitySql('ba', req), "bt.reconciliation_status <> 'IGNORED'"];
    const txParams = [...privacy.visibilityParams(req)];
    if (scope !== 'ALL') { txClauses.push('bt.ownership_scope = ?'); txParams.push(scope); }
    const txWhere = txClauses.join(' AND ');

    const [accountRows, summaryByCurrency, categoryRows, monthRows, qualityRows] = await Promise.all([
      pool.query(
        `SELECT ba.id,ba.nickname,ba.institution,ba.account_number_masked,ba.currency,
                ba.ownership_scope,ba.entity_name,ba.account_type,ba.financial_purpose,
                ba.connection_type,ba.connection_status,ba.current_ledger_balance,
                ba.available_balance,ba.history_start_date,ba.history_end_date,ba.last_synced_at,
                (SELECT COUNT(*) FROM bank_transactions bx WHERE bx.bank_account_id=ba.id) AS transaction_count,
                (SELECT COUNT(*) FROM bank_transactions bx WHERE bx.bank_account_id=ba.id AND bx.reconciliation_status='UNRECONCILED') AS unreconciled_count
           FROM bank_accounts ba
          WHERE ${accountClauses.join(' AND ')}
          ORDER BY ba.ownership_scope,ba.nickname`, accountParams
      ).then(([rows]) => rows),
      trustedTotals.cashTotalsByCurrency(pool, txWhere, txParams),
      trustedTotals.categorySpendByCurrency(pool, txWhere, txParams, 40),
      pool.query(
        `SELECT bt.currency,DATE_FORMAT(bt.transaction_date,'%Y-%m') AS month,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.credit ELSE 0 END),0) AS inflow,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.debit ELSE 0 END),0) AS outflow
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE bt.transaction_date>=DATE_SUB(CURDATE(),INTERVAL 12 MONTH) AND ${txWhere}
          GROUP BY bt.currency,DATE_FORMAT(bt.transaction_date,'%Y-%m')
          ORDER BY bt.currency,month`, txParams
      ).then(([rows]) => rows),
      pool.query(
        `SELECT
            COUNT(*) AS transaction_count,
            SUM(CASE WHEN bt.classification_status='UNCLASSIFIED' THEN 1 ELSE 0 END) AS unclassified_count,
            SUM(CASE WHEN bt.reconciliation_status='UNRECONCILED' THEN 1 ELSE 0 END) AS unreconciled_count
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${txWhere}`, txParams
      ).then(([rows]) => rows[0] || {})
    ]);
    const single = trustedTotals.singleCurrencySummary(summaryByCurrency);
    return res.json({
      scope,
      privacy: { personal_accounts_owner_only: true },
      currency_rule: 'Currencies are never combined without verified FX evidence. Refund cash is separated from ordinary money-in.',
      summary: {
        ...single,
        total_inflow: single.consolidated_available ? single.money_in : null,
        total_outflow: single.consolidated_available ? single.money_out : null,
        transaction_count: Number(qualityRows.transaction_count || 0),
        unclassified_count: Number(qualityRows.unclassified_count || 0),
        unreconciled_count: Number(qualityRows.unreconciled_count || 0),
        account_count: accountRows.length
      },
      summary_by_currency: summaryByCurrency,
      accounts: accountRows,
      spending_by_category: categoryRows,
      monthly_cash_flow: monthRows,
      split_policy: 'Split child category amounts replace the parent category amount and are never double counted.'
    });
  } catch (error) { return fail(res, error, 'Failed to load Finance Intelligence overview'); }
};
exports.getTransactions = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const core = spendingWhere(req);
    const scope = core.scope;

    const limit = Math.min(250, Math.max(10, Number.parseInt(req.query.limit, 10) || 50));
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const offset = (page - 1) * limit;
    const q = String(req.query.q || '').trim().slice(0, 120);
    const accountId = core.accountId;
    const category = String(req.query.category || '').trim().slice(0, 120);
    const merchant = String(req.query.merchant || '').trim().slice(0, 120);
    const currency = core.currency || '';
    const source = String(req.query.source || '').trim().toUpperCase().slice(0, 40);
    const reconciliation = String(req.query.reconciliation_status || '').trim().toUpperCase().slice(0, 40);
    const reviewStatus = String(req.query.review_status || '').trim().toUpperCase().slice(0, 40);
    const bank = String(req.query.bank || '').trim().slice(0, 120);
    const type = String(req.query.type || '').trim().toUpperCase().slice(0, 40);
    const from = core.from;
    const to = core.to;
    const amountMin = req.query.amount_min === undefined || req.query.amount_min === '' ? null : Number(req.query.amount_min);
    const amountMax = req.query.amount_max === undefined || req.query.amount_max === '' ? null : Number(req.query.amount_max);
    if (amountMin !== null && !Number.isFinite(amountMin)) throw new FinanceError('Minimum amount must be a number.', 400, 'INVALID_AMOUNT_FILTER');
    if (amountMax !== null && !Number.isFinite(amountMax)) throw new FinanceError('Maximum amount must be a number.', 400, 'INVALID_AMOUNT_FILTER');
    if (amountMin !== null && amountMax !== null && amountMin > amountMax) throw new FinanceError('Minimum amount cannot exceed maximum amount.', 400, 'INVALID_AMOUNT_FILTER');

    const clauses = [...core.clauses];
    const params = [...core.params];
    if (source) { clauses.push('bt.source_type=?'); params.push(source); }
    if (reconciliation) { clauses.push('bt.reconciliation_status=?'); params.push(reconciliation); }
    if (reviewStatus) { clauses.push('bt.review_source_status=?'); params.push(reviewStatus); }
    if (bank) { clauses.push('ba.institution LIKE ?'); params.push(`%${bank}%`); }
    if (merchant) { clauses.push('COALESCE(bt.merchant_normalized,bt.merchant_name) LIKE ?'); params.push(`%${merchant}%`); }
    if (category) {
      if (category.toUpperCase() === 'UNCLASSIFIED') {
        clauses.push("((NOT EXISTS (SELECT 1 FROM bank_transaction_splits sx WHERE sx.parent_bank_transaction_id=bt.id) AND (bt.category IS NULL OR bt.category='')) OR EXISTS (SELECT 1 FROM bank_transaction_splits sx WHERE sx.parent_bank_transaction_id=bt.id AND (sx.category IS NULL OR sx.category='')))");
      } else {
        clauses.push("(bt.category=? OR EXISTS (SELECT 1 FROM bank_transaction_splits sx WHERE sx.parent_bank_transaction_id=bt.id AND sx.category=?))");
        params.push(category, category);
      }
    }
    if (type === 'TRANSFER') clauses.push('bt.is_internal_transfer=1');
    else if (type === 'INCOME') clauses.push('bt.credit>0 AND bt.is_internal_transfer=0');
    else if (type === 'EXPENSE') clauses.push('bt.debit>0 AND bt.is_internal_transfer=0');
    else if (type && type !== 'ALL') throw new FinanceError('Transaction type filter must be Income, Expense, Transfer or All.', 400, 'INVALID_TRANSACTION_TYPE_FILTER');
    if (amountMin !== null) { clauses.push('GREATEST(bt.debit,bt.credit)>=?'); params.push(amountMin); }
    if (amountMax !== null) { clauses.push('GREATEST(bt.debit,bt.credit)<=?'); params.push(amountMax); }
    if (q) {
      clauses.push('(bt.description LIKE ? OR bt.merchant_name LIKE ? OR bt.merchant_normalized LIKE ? OR bt.reference LIKE ? OR bt.category LIKE ? OR bt.project_ref LIKE ? OR ba.nickname LIKE ? OR ba.institution LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like, like, like, like, like, like);
    }
    const where = clauses.join(' AND ');

    const [[count]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN bt.manual_override=1 THEN 1 ELSE 0 END) AS manual_overrides
         FROM bank_transactions bt
         JOIN bank_accounts ba ON ba.id=bt.bank_account_id
        WHERE ${where}`, params
    );
    const summaryByCurrency = await trustedTotals.cashTotalsByCurrency(pool, where, params);
    const [rows] = await pool.query(
      `SELECT bt.id, bt.bank_account_id, bt.transaction_date, bt.posting_date, bt.description, bt.reference,
              bt.debit, bt.credit, bt.running_balance, bt.merchant_name, bt.merchant_normalized, bt.category, bt.currency,
              bt.ownership_scope, bt.classification_status, bt.reconciliation_status, bt.is_internal_transfer, bt.ignored_reason,
              bt.project_ref,bt.tags_json,bt.gst_treatment,bt.reviewed_at,bt.reviewed_by,
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
      filters: { q: q || null, account_id: accountId || null, category: category || null, merchant: merchant || null,
        currency: currency || null, source: source || null, reconciliation_status: reconciliation || null,
        review_status: reviewStatus || null, bank: bank || null, type: type || null, from, to, amount_min: amountMin, amount_max: amountMax },
      page,
      limit,
      total: Number(count.total || 0),
      total_pages: Math.max(1, Math.ceil(Number(count.total || 0) / limit)),
      summary: {
        ...trustedTotals.singleCurrencySummary(summaryByCurrency),
        manual_overrides: Number(count.manual_overrides || 0),
        transfer_policy: 'Internal transfers are excluded from money-in and money-out totals.',
        refund_policy: 'Linked refunds are cash inflow but are separated from ordinary money-in.'
      },
      summary_by_currency: summaryByCurrency,
      transactions: rows,
      separation: {
        business_label: 'Voxel Veda Company',
        personal_label: 'Personal',
        inherited_from_bank_account: true
      }
    });
  } catch (error) { return fail(res, error, 'Failed to load separated transaction ledger'); }
};

exports.createManualTransaction = async (req, res) => {
  let db;
  try {
    await ensureFinanceSchema();
    const accountId = Number(req.body.bank_account_id || 0);
    if (!accountId) throw new FinanceError('Choose a financial account.', 400, 'BANK_ACCOUNT_REQUIRED');
    const type = String(req.body.type || '').trim().toUpperCase();
    if (!['INCOME','EXPENSE','ADJUSTMENT_IN','ADJUSTMENT_OUT'].includes(type)) {
      throw new FinanceError('Manual movement type must be Income, Expense, Adjustment In or Adjustment Out.', 400, 'INVALID_MANUAL_TRANSACTION_TYPE');
    }
    const transactionDate = dateOnly(req.body.transaction_date);
    if (!transactionDate) throw new FinanceError('A valid transaction date is required.', 400, 'DATE_REQUIRED');
    const amount = money.fromCents(money.toCents(req.body.amount));
    if (money.toCents(amount) <= 0n) throw new FinanceError('Amount must be greater than zero.', 400, 'INVALID_AMOUNT');
    const description = String(req.body.description || '').trim().slice(0,500);
    if (!description) throw new FinanceError('Description is required.', 400, 'DESCRIPTION_REQUIRED');

    db = await pool.getConnection();
    await db.beginTransaction();
    const [[account]] = await db.query(
      `SELECT * FROM bank_accounts ba WHERE ba.id=? AND ba.status='ACTIVE' AND ${privacy.visibilitySql('ba', req)} FOR UPDATE`,
      [accountId, ...privacy.visibilityParams(req)]
    );
    if (!account) throw new FinanceError('Active financial account not found.', 404, 'BANK_ACCOUNT_NOT_FOUND');

    const accountScope = String(account.ownership_scope || 'UNCLASSIFIED').toUpperCase();
    const requestedScope = String(req.body.ownership_scope || accountScope).trim().toUpperCase();
    const allowedScopes = new Set(['PERSONAL','BUSINESS','MIXED','UNCLASSIFIED']);
    if (!allowedScopes.has(requestedScope)) throw new FinanceError('Choose a valid ownership scope.', 400, 'INVALID_TRANSACTION_SCOPE');
    const ownershipScope = ['MIXED','UNCLASSIFIED'].includes(accountScope) ? requestedScope : accountScope;
    const debit = ['EXPENSE','ADJUSTMENT_OUT'].includes(type) ? amount : '0.00';
    const credit = ['INCOME','ADJUSTMENT_IN'].includes(type) ? amount : '0.00';
    const reference = String(req.body.reference || '').trim().slice(0,120) || null;
    const merchant = String(req.body.merchant_name || '').trim().slice(0,255) || null;
    const category = String(req.body.category || '').trim().slice(0,120) || null;
    const fingerprint = crypto.createHash('sha256').update([
      'MANUAL', account.id, transactionDate, description.toLowerCase(), reference || '',
      debit, credit, String(req.user?.id || ''), String(Date.now()), crypto.randomBytes(8).toString('hex')
    ].join('|')).digest('hex');

    const [insert] = await db.query(
      `INSERT INTO bank_transactions
       (bank_account_id,row_hash,transaction_date,posting_date,description,reference,debit,credit,running_balance,
        merchant_name,category,currency,ownership_scope,classification_status,reconciliation_status,
        is_internal_transfer,source_type,source_provider,review_source_status,manual_override,imported_by,imported_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'UNRECONCILED',0,'MANUAL','VOXEL_VEDA','MANUAL',1,?,NOW())`,
      [account.id,fingerprint,transactionDate,dateOnly(req.body.posting_date)||transactionDate,description,reference,
        debit,credit,null,merchant,category,account.currency,ownershipScope,category?'CLASSIFIED':'UNCLASSIFIED',req.user.id]
    );
    await logAudit(db, audit(req, {
      action:'MANUAL_BANK_TRANSACTION_CREATED', module:'finance_intelligence', recordType:'bank_transaction',
      recordId:insert.insertId, newValue:{bank_account_id:account.id,transaction_date:transactionDate,type,amount,currency:account.currency,ownership_scope:ownershipScope,category}
    }));
    await db.commit();
    return res.status(201).json({
      message:'Manual financial movement recorded in the canonical bank/cash ledger.',
      id:insert.insertId, currency:account.currency, ownership_scope:ownershipScope
    });
  } catch (error) {
    if (db) await db.rollback();
    return fail(res,error,'Failed to create manual financial movement');
  } finally { if (db) db.release(); }
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
  const statementUid = String(options.statementUid || req.query.statement_uid || '').trim().slice(0, 80);
  const core = buildCoreBankTransactionFilter(req, req.query, { statementUid });
  return { ...core, accountId: core.account_id || 0, statementUid };
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function normalizeBulkChanges(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const changes = {};
  if (hasOwn(source, 'category')) changes.category = String(source.category || '').trim().slice(0, 120) || null;
  if (hasOwn(source, 'ownership_scope')) changes.ownership_scope = normalizeScope(source.ownership_scope, 'UNCLASSIFIED');
  if (hasOwn(source, 'merchant_normalized')) changes.merchant_normalized = cleanMerchant(source.merchant_normalized) || null;
  if (hasOwn(source, 'project_ref')) changes.project_ref = String(source.project_ref || '').trim().slice(0, 120) || null;
  if (hasOwn(source, 'tags')) changes.tags = normalizeTags(source.tags);
  if (hasOwn(source, 'gst_treatment')) changes.gst_treatment = normalizeGstTreatment(source.gst_treatment, true);
  if (hasOwn(source, 'reviewed')) {
    if (typeof source.reviewed !== 'boolean') throw new FinanceError('Reviewed must be true or false.', 400, 'INVALID_REVIEWED_STATUS');
    changes.reviewed = source.reviewed;
  }
  if (!Object.keys(changes).length) throw new FinanceError('Choose at least one bulk review change.', 400, 'BULK_CHANGES_REQUIRED');
  return changes;
}

function bulkValue(row, key) {
  if (key === 'tags') {
    if (!row.tags_json) return [];
    try { return normalizeTags(JSON.parse(row.tags_json)); } catch { return normalizeTags(row.tags_json); }
  }
  if (key === 'reviewed') return Boolean(row.reviewed_at);
  return row[key] === undefined ? null : row[key];
}

function bulkRowChanges(row, changes) {
  const delta = {};
  for (const [key, value] of Object.entries(changes)) {
    const current = bulkValue(row, key);
    if (JSON.stringify(current) !== JSON.stringify(value)) delta[key] = { from: current, to: value };
  }
  return delta;
}

async function assertCategoryVisible(db, req, category) {
  if (!category) return;
  const [[row]] = await db.query(
    `SELECT id FROM finance_system_categories c
      WHERE c.name=? AND c.active=1 AND c.archived_at IS NULL
        AND ((c.scope IN ('BUSINESS','BOTH') AND c.owner_user_id IS NULL)
          OR (c.scope='PERSONAL' AND c.owner_user_id=?))
      LIMIT 1`,
    [category, privacy.userId(req)]
  );
  if (!row) throw new FinanceError('Choose an active Finance category available to this user.', 400, 'FINANCE_CATEGORY_NOT_AVAILABLE');
}

async function resolveTransactionCategory(db, req, row, body = {}) {
  const createName = String(body.create_category_name || '').trim().slice(0, 120);
  let targetCategory = String(body.category || '').trim().slice(0, 120) || null;
  if (!createName) {
    if (targetCategory !== (row.category || null)) await assertCategoryVisible(db, req, targetCategory);
    return targetCategory;
  }
  if (createName.length < 2) throw new FinanceError('New category name must be at least 2 characters.', 400, 'CATEGORY_NAME_REQUIRED');
  const actorId = privacy.userId(req);
  const [[existing]] = await db.query(
    `SELECT c.* FROM finance_system_categories c
      WHERE LOWER(c.name)=LOWER(?)
        AND ((c.scope IN ('BUSINESS','BOTH') AND c.owner_user_id IS NULL) OR (c.scope='PERSONAL' AND c.owner_user_id=?))
      ORDER BY c.active DESC,c.id DESC LIMIT 1 FOR UPDATE`,
    [createName, actorId]
  );
  if (existing) {
    if (!Number(existing.active) || existing.archived_at) {
      await db.query('UPDATE finance_system_categories SET active=1,archived_at=NULL,archived_by=NULL,updated_by=? WHERE id=?',[actorId, existing.id]);
      await logAudit(db, audit(req, {
        action:'FINANCE_CATEGORY_RESTORED_FROM_TRANSACTION_MOVE',module:'finance_categories',recordType:'finance_system_category',recordId:existing.id,
        oldValue:{active:existing.active,archived_at:existing.archived_at},newValue:{active:1,name:existing.name}
      }));
    }
    return existing.name;
  }
  const requestedScope = String(body.create_category_scope || '').trim().toUpperCase();
  const accountScope = String(row.account_scope || '').toUpperCase();
  const rowScope = String(row.ownership_scope || '').toUpperCase();
  const inferredScope = accountScope === 'PERSONAL' ? 'PERSONAL' : accountScope === 'BUSINESS' ? 'BUSINESS' : ['PERSONAL','BUSINESS'].includes(rowScope) ? rowScope : 'BOTH';
  const scope = requestedScope || inferredScope;
  if (!['PERSONAL','BUSINESS','BOTH'].includes(scope)) throw new FinanceError('New category scope must be Personal, Business or Both.',400,'INVALID_CATEGORY_SCOPE');
  const ownerUserId = scope === 'PERSONAL' ? actorId : null;
  const categoryUid = uid('CAT');
  const [insert] = await db.query(
    `INSERT INTO finance_system_categories
     (category_uid,name,parent_id,scope,owner_user_id,icon,color,gst_default,active,created_by,updated_by)
     VALUES (?,?,NULL,?,?,NULL,NULL,'REVIEW',1,?,?)`,
    [categoryUid, createName, scope, ownerUserId, actorId, actorId]
  );
  await logAudit(db, audit(req, {
    action:'FINANCE_CATEGORY_CREATED_FROM_TRANSACTION_MOVE',module:'finance_categories',recordType:'finance_system_category',recordId:insert.insertId,
    newValue:{category_uid:categoryUid,name:createName,scope,owner_user_id:ownerUserId}
  }));
  return createName;
}
async function assertClassificationPeriodsOpen(db, rows) {
  const dates = [...new Set(rows.map((row) => dateOnly(row.transaction_date)).filter(Boolean))];
  for (const effectiveDate of dates) {
    const [[period]] = await db.query(
      `SELECT ap.status,fy.status AS financial_year_status
         FROM accounting_periods ap
         JOIN financial_years fy ON fy.id=ap.financial_year_id
        WHERE ? BETWEEN ap.start_date AND ap.end_date LIMIT 1`,
      [effectiveDate]
    );
    if (!period) throw new FinanceError(`No accounting period is configured for ${effectiveDate}.`, 409, 'PERIOD_NOT_CONFIGURED');
    if (period.status === 'LOCKED' || ['LOCKED', 'ARCHIVED'].includes(String(period.financial_year_status || '').toUpperCase())) {
      throw new FinanceError(`The accounting period containing ${effectiveDate} is locked.`, 423, 'PERIOD_LOCKED');
    }
  }
}

async function bulkVisibleTransactions(db, req, ids, forUpdate = false) {
  const placeholders = ids.map(() => '?').join(',');
  const suffix = forUpdate ? ' FOR UPDATE' : '';
  const [rows] = await db.query(
    `SELECT bt.*,ba.ownership_scope AS account_scope,ba.created_by AS account_created_by
       FROM bank_transactions bt
       JOIN bank_accounts ba ON ba.id=bt.bank_account_id
      WHERE bt.id IN (${placeholders}) AND bt.archived_at IS NULL AND ${privacy.visibilitySql('ba', req)}
      ORDER BY bt.id${suffix}`,
    [...ids, ...privacy.visibilityParams(req)]
  );
  if (rows.length !== ids.length) {
    throw new FinanceError('One or more selected transactions are unavailable. No changes were made.', 403, 'BULK_REVIEW_ACCESS_MISMATCH');
  }
  return rows;
}


async function visibleBankTransaction(id, req, db = pool, forUpdate = false) {
  const suffix = forUpdate ? ' FOR UPDATE' : '';
  const [[row]] = await db.query(
    `SELECT bt.*, ba.nickname AS account_name, ba.ownership_scope AS account_scope, ba.created_by AS account_created_by
       FROM bank_transactions bt
       JOIN bank_accounts ba ON ba.id=bt.bank_account_id
      WHERE bt.id=? AND ${privacy.visibilitySql('ba', req)}${suffix}`,
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
    await assertClassificationPeriodsOpen(db, [row]);

    const category = await resolveTransactionCategory(db, req, row, req.body);
    const categoryChanged = category !== (row.category || null);
    let replacedSplits = [];
    if (categoryChanged && req.body.move_whole_transaction === true) {
      const [splitRows] = await db.query(
        'SELECT * FROM bank_transaction_splits WHERE parent_bank_transaction_id=? ORDER BY id FOR UPDATE',
        [id]
      );
      replacedSplits = splitRows || [];
      if (replacedSplits.length) await db.query('DELETE FROM bank_transaction_splits WHERE parent_bank_transaction_id=?',[id]);
    }
    const requestedScope = String(req.body.ownership_scope || row.ownership_scope || '').trim().toUpperCase();
    const allowedScopes = new Set(['PERSONAL','BUSINESS','MIXED','UNCLASSIFIED']);
    if (!allowedScopes.has(requestedScope)) throw new FinanceError('Choose Personal, Business, Mixed or Needs owner.', 400, 'INVALID_TRANSACTION_SCOPE');

    const accountScope = String(row.account_scope || '').toUpperCase();
    const canOverrideScope = accountScope === 'MIXED' || accountScope === 'UNCLASSIFIED';
    const nextScope = canOverrideScope ? requestedScope : accountScope || requestedScope;

    const internalTransfer = hasOwn(req.body, 'is_internal_transfer')
      ? (req.body.is_internal_transfer === true ? 1 : 0)
      : Number(row.is_internal_transfer || 0);
    const ignored = hasOwn(req.body, 'ignored') ? req.body.ignored === true : row.reconciliation_status === 'IGNORED';
    const ignoredReason = ignored
      ? String(hasOwn(req.body, 'ignored_reason') ? req.body.ignored_reason : row.ignored_reason || '').trim().slice(0,500)
      : null;
    if (hasOwn(req.body, 'ignored') && ignored && ignoredReason.length < 3) throw new FinanceError('Add a short reason before excluding a transaction from reports.', 400, 'IGNORE_REASON_REQUIRED');
    const reconciliationStatus = ignored ? 'IGNORED' : (hasOwn(req.body, 'ignored') && row.reconciliation_status === 'IGNORED' ? 'UNRECONCILED' : row.reconciliation_status);
    const rememberRule = req.body.remember_rule === true;
    const learnMerchant = req.body.learn_merchant === true;
    const merchantNormalized = hasOwn(req.body, 'merchant_normalized') ? cleanMerchant(req.body.merchant_normalized) || null : row.merchant_normalized;
    const projectRef = hasOwn(req.body, 'project_ref') ? String(req.body.project_ref || '').trim().slice(0, 120) || null : row.project_ref;
    const tags = hasOwn(req.body, 'tags') ? normalizeTags(req.body.tags) : bulkValue(row, 'tags');
    const gstTreatment = hasOwn(req.body, 'gst_treatment') ? normalizeGstTreatment(req.body.gst_treatment, true) : row.gst_treatment;
    const reviewed = hasOwn(req.body, 'reviewed') ? req.body.reviewed === true : Boolean(row.reviewed_at);

    await db.query(
      `UPDATE bank_transactions
          SET category=?, classification_status=?, ownership_scope=?, is_internal_transfer=?,
              reconciliation_status=?, ignored_reason=?, merchant_normalized=?,project_ref=?,tags_json=?,gst_treatment=?,
              reviewed_at=IF(?,COALESCE(reviewed_at,NOW()),NULL),reviewed_by=IF(?,COALESCE(reviewed_by,?),NULL)
        WHERE id=?`,
      [category, category ? 'CLASSIFIED' : 'UNCLASSIFIED', nextScope, internalTransfer, reconciliationStatus, ignoredReason,
        merchantNormalized, projectRef, tags.length ? JSON.stringify(tags) : null, gstTreatment,
        reviewed, reviewed, req.user.id, id]
    );

    if (rememberRule && category) {
      const pattern = String(merchantNormalized || row.merchant_name || row.description || '').trim().slice(0,255);
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
        ignored_reason: row.ignored_reason,
        merchant_normalized: row.merchant_normalized,
        project_ref: row.project_ref,
        tags: bulkValue(row, 'tags'),
        gst_treatment: row.gst_treatment,
        reviewed: Boolean(row.reviewed_at)
      },
      newValue: {
        category,
        ownership_scope: nextScope,
        is_internal_transfer: internalTransfer,
        reconciliation_status: reconciliationStatus,
        ignored_reason: ignoredReason,
        merchant_normalized: merchantNormalized,
        project_ref: projectRef,
        tags,
        gst_treatment: gstTreatment,
        reviewed,
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

exports.bulkReviewTransactions = async (req, res) => {
  let db;
  try {
    await ensureFinanceSchema();
    const ids = [...new Set((Array.isArray(req.body.transaction_ids) ? req.body.transaction_ids : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    if (!ids.length) throw new FinanceError('Select at least one transaction.', 400, 'TRANSACTIONS_REQUIRED');
    if (ids.length > 200) throw new FinanceError('Bulk review is limited to 200 transactions at a time.', 413, 'BULK_REVIEW_LIMIT');
    const changes = normalizeBulkChanges(req.body.changes || (hasOwn(req.body, 'category') ? { category: req.body.category } : {}));
    const preview = req.body.preview === true;

    db = await pool.getConnection();
    await db.beginTransaction();
    const rows = await bulkVisibleTransactions(db, req, ids, !preview);
    await assertCategoryVisible(db, req, changes.category);
    if (changes.ownership_scope) {
      const conflicting = rows.find((row) => {
        const accountScope = String(row.account_scope || '').toUpperCase();
        return !['MIXED', 'UNCLASSIFIED'].includes(accountScope) && accountScope !== changes.ownership_scope;
      });
      if (conflicting) throw new FinanceError('Ownership is fixed by one or more selected accounts. No changes were made.', 409, 'BULK_SCOPE_LOCKED_TO_ACCOUNT');
    }
    const accountingFields = ['category', 'ownership_scope', 'merchant_normalized', 'project_ref', 'tags', 'gst_treatment'];
    if (accountingFields.some((field) => hasOwn(changes, field))) await assertClassificationPeriodsOpen(db, rows);

    const affected = rows.map((row) => ({ row, delta: bulkRowChanges(row, changes) })).filter((item) => Object.keys(item.delta).length);
    const response = {
      selected_count: rows.length,
      affected_count: affected.length,
      unchanged_count: rows.length - affected.length,
      fields: Object.keys(changes),
      recovery: 'Each applied transaction records its prior and replacement classification in the existing audit chain.'
    };
    if (preview) {
      await db.rollback();
      return res.json({ message: `${affected.length} transaction(s) would be changed. Review this count before applying.`, preview: true, ...response });
    }

    const expectedCount = Number(req.body.expected_count);
    if (!Number.isInteger(expectedCount) || expectedCount < 0) {
      throw new FinanceError('Preview this bulk review before applying it.', 409, 'BULK_REVIEW_PREVIEW_REQUIRED');
    }
    if (expectedCount !== affected.length) {
      throw new FinanceError('The affected transaction count changed after preview. Review the selection again.', 409, 'BULK_REVIEW_PREVIEW_STALE');
    }

    for (const { row, delta } of affected) {
      const fields = [];
      const params = [];
      if (hasOwn(changes, 'category')) {
        fields.push("category=?", "classification_status=?");
        params.push(changes.category, changes.category ? 'CLASSIFIED' : 'UNCLASSIFIED');
      }
      if (hasOwn(changes, 'ownership_scope')) { fields.push('ownership_scope=?'); params.push(changes.ownership_scope); }
      if (hasOwn(changes, 'merchant_normalized')) { fields.push('merchant_normalized=?'); params.push(changes.merchant_normalized); }
      if (hasOwn(changes, 'project_ref')) { fields.push('project_ref=?'); params.push(changes.project_ref); }
      if (hasOwn(changes, 'tags')) { fields.push('tags_json=?'); params.push(changes.tags.length ? JSON.stringify(changes.tags) : null); }
      if (hasOwn(changes, 'gst_treatment')) { fields.push('gst_treatment=?'); params.push(changes.gst_treatment); }
      if (hasOwn(changes, 'reviewed')) {
        fields.push(changes.reviewed ? 'reviewed_at=NOW()' : 'reviewed_at=NULL');
        fields.push(changes.reviewed ? 'reviewed_by=?' : 'reviewed_by=NULL');
        if (changes.reviewed) params.push(req.user.id);
      }
      params.push(row.id);
      await db.query(`UPDATE bank_transactions SET ${fields.join(',')} WHERE id=?`, params);
      await logAudit(db, audit(req, {
        action: 'BANK_TRANSACTION_BULK_REVIEWED',
        module: 'finance_intelligence',
        recordType: 'bank_transaction',
        recordId: row.id,
        oldValue: Object.fromEntries(Object.entries(delta).map(([key, value]) => [key, value.from])),
        newValue: Object.fromEntries(Object.entries(delta).map(([key, value]) => [key, value.to]))
      }));
    }
    await logAudit(db, audit(req, {
      action: 'BANK_TRANSACTIONS_BULK_REVIEW_COMPLETED',
      module: 'finance_intelligence',
      recordType: 'bank_transaction_bulk_review',
      recordId: ids.join(',').slice(0,180),
      newValue: { requested: ids.length, affected: affected.length, fields: Object.keys(changes) }
    }));
    await db.commit();
    return res.json({ message: `${affected.length} transaction(s) updated after preview confirmation.`, preview: false, ...response });
  } catch (error) {
    if (db) await db.rollback();
    return fail(res, error, 'Failed to apply bulk transaction review');
  } finally { if (db) db.release(); }
};

exports.bulkCategorizeTransactions = (req, res) => exports.bulkReviewTransactions(req, res);

exports.getStatementLibrary = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const scope = reportScope(req.query.scope);
    const accountId = Number(req.query.account_id || 0);
    const clauses = ["sif.parse_status='IMPORTED'", privacy.visibilitySql('ba', req)];
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
      `SELECT sif.*,ba.nickname AS account_name,ba.institution,ba.ownership_scope,ba.currency,ba.entity_name
         FROM statement_import_files sif
         JOIN bank_accounts ba ON ba.id=sif.bank_account_id
        WHERE sif.import_uid=? AND ${privacy.visibilitySql('ba', req)}
        LIMIT 1`,
      [importUid, ...privacy.visibilityParams(req)]
    );
    if (!statement) throw new FinanceError('Statement was not found or is not available to this user.', 404, 'STATEMENT_NOT_FOUND');

    const filters = spendingWhere(req, { statementUid: importUid });
    const [summaryByCurrency, categories, merchantRows, monthlyRows, transactionRows, manualRows] = await Promise.all([
      trustedTotals.cashTotalsByCurrency(pool, filters.where, filters.params),
      trustedTotals.categorySpendByCurrency(pool, filters.where, filters.params, 200),
      pool.query(
        `SELECT bt.currency,COALESCE(NULLIF(bt.merchant_name,''),NULLIF(bt.description,''),'Unknown') AS merchant,
                COUNT(*) AS transaction_count,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.debit ELSE 0 END),0) AS spent,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.credit ELSE 0 END),0) AS received
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${filters.where}
          GROUP BY bt.currency,COALESCE(NULLIF(bt.merchant_name,''),NULLIF(bt.description,''),'Unknown')
          ORDER BY bt.currency,spent DESC,transaction_count DESC LIMIT 100`, filters.params
      ).then(([rows]) => rows),
      pool.query(
        `SELECT bt.currency,DATE_FORMAT(bt.transaction_date,'%Y-%m') AS month,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.debit ELSE 0 END),0) AS spent,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.credit ELSE 0 END),0) AS received,
                COUNT(*) AS transaction_count
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${filters.where}
          GROUP BY bt.currency,DATE_FORMAT(bt.transaction_date,'%Y-%m')
          ORDER BY bt.currency,month`, filters.params
      ).then(([rows]) => rows),
      pool.query(
        `SELECT bt.id,bt.transaction_date,bt.posting_date,bt.description,bt.reference,bt.merchant_name,bt.category,bt.debit,bt.credit,
                bt.running_balance,bt.currency,bt.reconciliation_status,bt.manual_override,bt.source_type,bt.statement_row_id,
                bt.is_internal_transfer,ba.nickname AS account_name
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${filters.where}
          ORDER BY bt.transaction_date ASC,bt.id ASC LIMIT 5000`, filters.params
      ).then(([rows]) => rows),
      pool.query(
        `SELECT bt.currency,SUM(CASE WHEN bt.manual_override=1 THEN 1 ELSE 0 END) AS manual_overrides
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${filters.where} GROUP BY bt.currency`, filters.params
      ).then(([rows]) => rows)
    ]);
    const enrichedSummary = summaryByCurrency.map((row) => {
      const currencyCategories = categories.filter((entry) => entry.currency === row.currency);
      const cashSpentCents = currencyCategories.filter((entry) => String(entry.category).toLowerCase() === 'cash').reduce((sum, entry) => sum + money.toCents(entry.spent || 0), 0n);
      const unclassified = currencyCategories.filter((entry) => String(entry.category).toLowerCase() === 'unclassified').reduce((sum, entry) => sum + Number(entry.source_transaction_count || 0), 0);
      const manual = manualRows.find((entry) => String(entry.currency).toUpperCase() === row.currency);
      return { ...row, net_flow: row.net_cash_flow, cash_spent: money.fromCents(cashSpentCents), unclassified, manual_overrides: Number(manual?.manual_overrides || 0) };
    });
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
      currency_rule: 'Statement activity remains in native currency; linked refunds are not ordinary revenue.',
      summary: trustedTotals.singleCurrencySummary(enrichedSummary),
      summary_by_currency: enrichedSummary,
      categories,
      merchants: merchantRows,
      monthly: monthlyRows,
      transactions: transactionRows,
      split_policy: 'Split child categories replace the parent category allocation for reporting; the source bank transaction stays immutable.',
      refund_policy: 'Linked refund cash inflow is separated and reduces net economic expense.',
      legacy_linkage: Number(statement.imported_rows || 0) > 0 && transactionRows.length === 0
    });
  } catch (error) { return fail(res, error, 'Failed to build statement report'); }
};
exports.getSpendingReport = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const filters = spendingWhere(req);
    const includeTransactions=String(req.query.include_transactions??'1')!=='0';
    const [summaryByCurrency, categories, merchantRows, accountRows, accountCategoryRows, monthlyRows, weekdayRows, transactionRows, manualRows] = await Promise.all([
      trustedTotals.cashTotalsByCurrency(pool, filters.where, filters.params),
      trustedTotals.categorySpendByCurrency(pool, filters.where, filters.params, 200),
      pool.query(
        `SELECT bt.currency,COALESCE(NULLIF(bt.merchant_name,''),NULLIF(bt.description,''),'Unknown') AS merchant,
                COUNT(*) AS transaction_count,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.debit ELSE 0 END),0) AS spent,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.credit ELSE 0 END),0) AS received
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${filters.where}
          GROUP BY bt.currency,COALESCE(NULLIF(bt.merchant_name,''),NULLIF(bt.description,''),'Unknown')
          ORDER BY bt.currency,spent DESC,transaction_count DESC LIMIT 200`, filters.params
      ).then(([rows]) => rows),
      pool.query(
        `SELECT ba.id AS bank_account_id,ba.nickname AS account_name,ba.ownership_scope,ba.currency,
                COUNT(*) AS transaction_count,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.debit ELSE 0 END),0) AS spent,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.credit ELSE 0 END),0) AS received
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${filters.where} GROUP BY ba.id ORDER BY spent DESC`, filters.params
      ).then(([rows]) => rows),
      pool.query(
        `SELECT ba.id AS bank_account_id,ba.nickname AS account_name,ba.institution,bt.currency,
                COALESCE(NULLIF(s.category,''),NULLIF(bt.category,''),'Unclassified') AS category,
                COUNT(DISTINCT bt.id) AS source_transaction_count,
                COUNT(s.id) AS split_line_count,
                COALESCE(SUM(CASE WHEN s.id IS NOT NULL THEN s.amount ELSE bt.debit END),0) AS spent
           FROM bank_transactions bt
           JOIN bank_accounts ba ON ba.id=bt.bank_account_id
           LEFT JOIN bank_transaction_splits s ON s.parent_bank_transaction_id=bt.id
          WHERE bt.debit>0 AND bt.is_internal_transfer=0 AND ${filters.where}
          GROUP BY ba.id,ba.nickname,ba.institution,bt.currency,
                   COALESCE(NULLIF(s.category,''),NULLIF(bt.category,''),'Unclassified')
          ORDER BY ba.nickname,bt.currency,spent DESC`, filters.params
      ).then(([rows]) => rows),
      pool.query(
        `SELECT bt.currency,DATE_FORMAT(bt.transaction_date,'%Y-%m') AS month,COUNT(*) AS transaction_count,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.debit ELSE 0 END),0) AS spent,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.credit ELSE 0 END),0) AS received
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${filters.where}
          GROUP BY bt.currency,DATE_FORMAT(bt.transaction_date,'%Y-%m')
          ORDER BY bt.currency,month`, filters.params
      ).then(([rows]) => rows),
      pool.query(
        `SELECT bt.currency,DAYNAME(bt.transaction_date) AS weekday,WEEKDAY(bt.transaction_date) AS weekday_index,
                COUNT(*) AS transaction_count,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.debit ELSE 0 END),0) AS spent
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${filters.where}
          GROUP BY bt.currency,DAYNAME(bt.transaction_date),WEEKDAY(bt.transaction_date)
          ORDER BY bt.currency,weekday_index`, filters.params
      ).then(([rows]) => rows),
      includeTransactions ? pool.query(
        `SELECT bt.id,bt.transaction_date,bt.description,bt.merchant_name,bt.category,bt.debit,bt.credit,
                bt.currency,bt.ownership_scope,bt.reconciliation_status,bt.source_type,bt.statement_import_uid,
                bt.manual_override,bt.is_internal_transfer,ba.nickname AS account_name,sif.original_name AS statement_name
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
           LEFT JOIN statement_import_files sif ON sif.import_uid=bt.statement_import_uid AND sif.bank_account_id=bt.bank_account_id
          WHERE ${filters.where}
          ORDER BY bt.transaction_date DESC,bt.id DESC LIMIT 5000`, filters.params
      ).then(([rows]) => rows) : Promise.resolve([]),
      pool.query(
        `SELECT bt.currency,SUM(CASE WHEN bt.manual_override=1 THEN 1 ELSE 0 END) AS manual_overrides
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${filters.where} GROUP BY bt.currency`, filters.params
      ).then(([rows]) => rows)
    ]);

    const enrichedSummary = summaryByCurrency.map((row) => {
      const currencyCategories = categories.filter((entry) => entry.currency === row.currency);
      const cashSpentCents = currencyCategories
        .filter((entry) => String(entry.category).toLowerCase() === 'cash')
        .reduce((sum, entry) => sum + money.toCents(entry.spent || 0), 0n);
      const unclassified = currencyCategories
        .filter((entry) => String(entry.category).toLowerCase() === 'unclassified')
        .reduce((sum, entry) => sum + Number(entry.source_transaction_count || 0), 0);
      const manual = manualRows.find((entry) => String(entry.currency).toUpperCase() === row.currency);
      return {
        ...row,
        net_flow: row.net_cash_flow,
        cash_spent: money.fromCents(cashSpentCents),
        unclassified,
        manual_overrides: Number(manual?.manual_overrides || 0)
      };
    });
    const categoriesWithPercent = categories.map((row) => {
      const currencySummary = enrichedSummary.find((entry) => entry.currency === row.currency);
      const gross = Number(currencySummary?.money_out || 0);
      return {
        ...row,
        percentage_of_spend: gross > 0 ? Number(((Number(row.spent || 0) / gross) * 100).toFixed(2)) : 0
      };
    });

    const accountCategories = accountCategoryRows.map((row) => ({
      bank_account_id: Number(row.bank_account_id),
      account_name: row.account_name,
      institution: row.institution,
      currency: String(row.currency || 'AUD').toUpperCase(),
      category: row.category || 'Unclassified',
      source_transaction_count: Number(row.source_transaction_count || 0),
      split_line_count: Number(row.split_line_count || 0),
      spent: money.fromCents(money.toCents(row.spent || 0))
    }));

    return res.json({
      filters: { scope: filters.scope, account_id: filters.accountId || null, statement_uid: filters.statementUid || null, from: filters.from, to: filters.to },
      currency_rule: 'Currencies are never combined without verified FX evidence. Linked refunds are separated from ordinary money-in.',
      summary: trustedTotals.singleCurrencySummary(enrichedSummary),
      summary_by_currency: enrichedSummary,
      categories: categoriesWithPercent,
      merchants: merchantRows,
      accounts: accountRows,
      account_categories: accountCategories,
      monthly: monthlyRows,
      weekdays: weekdayRows,
      transactions: transactionRows,
      transactions_included: includeTransactions,
      split_policy: 'Split parents contribute child category amounts instead of parent + child amounts, preventing double counting.',
      refund_policy: 'Linked refunds remain cash inflow but are excluded from ordinary_money_in and reduce net_economic_expense.',
      generated_at: new Date().toISOString()
    });
  } catch (error) { return fail(res, error, 'Failed to build spending report'); }
};
exports.getBankingDashboard = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const filters = spendingWhere(req);
    const scope = normalizeDashboardScope(filters.scope);
    const accountId = filters.accountId;
    const accountClauses = ["ba.status='ACTIVE'", privacy.visibilitySql('ba', req)];
    const accountParams = [...privacy.visibilityParams(req)];
    const txWhere = filters.where;
    const txParams = filters.params;
    if (scope !== 'ALL') {
      accountClauses.push('ba.ownership_scope=?');
      accountParams.push(scope);
    }
    if (accountId) {
      accountClauses.push('ba.id=?'); accountParams.push(accountId);
    }

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
      trustedTotals.cashTotalsByCurrency(pool, txWhere, txParams),
      trustedTotals.categorySpendByCurrency(pool, txWhere, txParams, 200),
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
          WHERE ${txWhere}
          GROUP BY bt.currency,DATE_FORMAT(bt.transaction_date,'%Y-%m')
          ORDER BY bt.currency,month`,
        txParams
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
            AND ${txWhere}
          GROUP BY fi.recurring_frequency,fi.merchant_normalized,bt.currency,merchant
          ORDER BY last_seen DESC LIMIT 30`,
        txParams
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
      account_id: accountId || null,
      period: { from: filters.from || null, to: filters.to || null },
      currency_rule: 'Currencies are never added together. Choose a currency to analyse balances and spending.',
      accounts,
      balances_by_currency: balances.map((row) => ({ currency: row.currency, account_count: Number(row.account_count || 0), balance: Number(row.balance || 0) })),
      flow_by_currency: flow.map((row) => ({
        currency: row.currency,
        transaction_count: Number(row.source_transaction_count || 0),
        money_in: Number(row.money_in || 0),
        ordinary_money_in: Number(row.ordinary_money_in || 0),
        linked_refund_inflow: Number(row.linked_refund_inflow || 0),
        money_out: Number(row.money_out || 0),
        net_flow: Number(row.net_cash_flow || 0),
        net_economic_expense: Number(row.net_economic_expense || 0),
        transfer_movement: Number(row.transfer_movement || 0),
        cash_out: Number(row.cash_out || 0),
        cash_in: Number(row.cash_in || 0),
        unclassified: Number(row.unclassified || 0)
      })),
      categories: categories.map((row) => ({ ...row, spent: Number(row.spent || 0), transaction_count: Number(row.source_transaction_count || 0) })),
      merchants: merchants.map((row) => ({ ...row, spent: Number(row.spent || 0), transaction_count: Number(row.transaction_count || 0) })),
      monthly: monthly.map((row) => ({ ...row, money_in: Number(row.money_in || 0), money_out: Number(row.money_out || 0) })),
      recent_transactions: recent,
      detected_recurring: detectedRecurring.map((row) => ({ ...row, typical_amount: Number(row.typical_amount || 0), matched_transactions: Number(row.matched_transactions || 0) })),
      intelligence_by_currency: intelligence
    });
  } catch (error) { return fail(res, error, 'Failed to load Finance dashboard'); }
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
        privacy.visibilitySql('ba', req),
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
        WHERE ${privacy.visibilitySql('ba', req)}
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
        WHERE ba.status='ACTIVE' AND ${privacy.visibilitySql('ba', req)}
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
       WHERE ${privacy.visibilitySql('ba', req)}`, privacy.visibilityParams(req)
    );
    const [[accounts]] = await pool.query(
      `SELECT SUM(CASE WHEN connection_type='OPEN_BANKING' AND (connection_status IS NULL OR connection_status <> 'CONNECTED') THEN 1 ELSE 0 END) AS disconnected,
              SUM(CASE WHEN history_start_date IS NULL OR history_end_date IS NULL THEN 1 ELSE 0 END) AS coverage_unknown
       FROM bank_accounts ba WHERE status='ACTIVE' AND ${privacy.visibilitySql('ba', req)}`, privacy.visibilityParams(req)
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
    const accountClauses = [privacy.visibilitySql('ba', req), "ba.status='ACTIVE'"];
    const accountParams = [...privacy.visibilityParams(req)];
    if (filters.scope !== 'ALL') { accountClauses.push('ba.ownership_scope=?'); accountParams.push(filters.scope); }
    if (filters.accountId) { accountClauses.push('ba.id=?'); accountParams.push(filters.accountId); }

    const [summaryByCurrency, categoryRows, monthlyRows, accountRows, statementRows, transactionRows] = await Promise.all([
      trustedTotals.cashTotalsByCurrency(pool, filters.where, filters.params),
      trustedTotals.categorySpendByCurrency(pool, filters.where, filters.params, 300),
      pool.query(
        `SELECT bt.currency,DATE_FORMAT(bt.transaction_date,'%Y-%m') AS month,
                COUNT(*) AS transaction_count,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.debit ELSE 0 END),0) AS spent,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.credit ELSE 0 END),0) AS received
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${filters.where}
          GROUP BY bt.currency,DATE_FORMAT(bt.transaction_date,'%Y-%m')
          ORDER BY bt.currency,month`, filters.params
      ).then(([rows]) => rows),
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
      ).then(([rows]) => rows),
      pool.query(
        `SELECT sif.import_uid,sif.bank_account_id,sif.original_name,sif.source_format,sif.statement_start_date,sif.statement_end_date,
                sif.opening_balance,sif.closing_balance,sif.imported_rows,sif.duplicate_rows,sif.rejected_rows,sif.reviewed_at,
                ba.nickname AS account_name,ba.institution,ba.currency,ba.ownership_scope
           FROM statement_import_files sif JOIN bank_accounts ba ON ba.id=sif.bank_account_id
          WHERE sif.parse_status='IMPORTED' AND ${accountClauses.join(' AND ')}
          ORDER BY COALESCE(sif.statement_end_date,sif.reviewed_at) DESC,sif.id DESC`, accountParams
      ).then(([rows]) => rows),
      pool.query(
        `SELECT bt.id,bt.transaction_date,bt.description,bt.merchant_name,bt.category,bt.debit,bt.credit,bt.currency,
                bt.ownership_scope,bt.is_internal_transfer,bt.reconciliation_status,bt.source_type,bt.statement_import_uid,
                ba.nickname AS account_name,ba.institution,sif.original_name AS statement_name
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
           LEFT JOIN statement_import_files sif ON sif.import_uid=bt.statement_import_uid AND sif.bank_account_id=bt.bank_account_id
          WHERE ${filters.where}
          ORDER BY bt.transaction_date DESC,bt.id DESC LIMIT 10000`, filters.params
      ).then(([rows]) => rows)
    ]);

    const liquidPosition = {};
    for (const account of accountRows) {
      const cur = account.currency || 'AUD';
      const raw = Number(account.available_balance == null ? account.current_ledger_balance : account.available_balance || 0);
      const liability = /credit\s*card|loan|overdraft/i.test(String(account.account_type || ''));
      liquidPosition[cur] = Number(((liquidPosition[cur] || 0) + (liability ? -Math.abs(raw) : raw)).toFixed(2));
    }
    const categoriesByCurrency = {};
    for (const row of categoryRows) (categoriesByCurrency[row.currency || 'AUD'] ||= []).push({
      category: row.category,
      transaction_count: Number(row.source_transaction_count || 0),
      split_line_count: Number(row.split_line_count || 0),
      spent: Number(row.spent || 0)
    });
    const monthlyByCurrency = {};
    for (const row of monthlyRows) (monthlyByCurrency[row.currency || 'AUD'] ||= []).push({
      month: row.month, transaction_count: Number(row.transaction_count || 0),
      spent: Number(row.spent || 0), received: Number(row.received || 0)
    });

    return res.json({
      filters: { scope: filters.scope, account_id: filters.accountId || null, from: filters.from, to: filters.to },
      currency_rule: 'Currencies are reported separately and are never added together without verified FX evidence.',
      refund_rule: 'Linked refunds are cash inflow but are separated from ordinary money-in and reduce net economic expense.',
      split_rule: 'Category spend uses split child amounts instead of parent + child values.',
      net_position_note: 'Bank net position uses visible bank-account balances and treats credit-card, loan and overdraft accounts as liabilities. It does not include external property, investments or liabilities not stored as bank accounts.',
      bank_net_position_by_currency: liquidPosition,
      summary_by_currency: summaryByCurrency,
      categories_by_currency: categoriesByCurrency,
      monthly_by_currency: monthlyByCurrency,
      accounts: accountRows.map((row) => ({ ...row, transaction_count: Number(row.transaction_count || 0), statement_count: Number(row.statement_count || 0) })),
      statements: statementRows,
      transactions: transactionRows,
      generated_at: new Date().toISOString()
    });
  } catch (error) { return fail(res, error, 'Failed to build multi-bank portfolio history report'); }
};
exports.getStatementWarehouse = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const scope = normalizeDashboardScope(req.query.scope);
    const txClauses = [privacy.visibilitySql('ba', req), "bt.reconciliation_status <> 'IGNORED'"];
    const txParams = [...privacy.visibilityParams(req)];
    const accountClauses = ["ba.status='ACTIVE'", privacy.visibilitySql('ba', req)];
    const accountParams = [...privacy.visibilityParams(req)];
    if (scope !== 'ALL') {
      txClauses.push('bt.ownership_scope=?'); txParams.push(scope);
      accountClauses.push('ba.ownership_scope=?'); accountParams.push(scope);
    }
    const txWhere = txClauses.join(' AND ');
    const accountWhere = accountClauses.join(' AND ');

    const [summaryByCurrency, accountRows, statementRows, categoryRows, monthlyRows, metaRows] = await Promise.all([
      trustedTotals.cashTotalsByCurrency(pool, txWhere, txParams),
      pool.query(
        `SELECT ba.id,ba.nickname,ba.institution,ba.currency,ba.ownership_scope,ba.account_type,
                ba.current_ledger_balance,ba.available_balance,ba.history_start_date,ba.history_end_date,
                COUNT(DISTINCT bt.id) AS transaction_count,
                COUNT(DISTINCT sif.import_uid) AS statement_count,
                MAX(sif.statement_end_date) AS latest_statement_date
           FROM bank_accounts ba
           LEFT JOIN bank_transactions bt ON bt.bank_account_id=ba.id
           LEFT JOIN statement_import_files sif ON sif.bank_account_id=ba.id AND sif.parse_status='IMPORTED'
          WHERE ${accountWhere}
          GROUP BY ba.id ORDER BY ba.currency,ba.nickname`, accountParams
      ).then(([rows]) => rows),
      pool.query(
        `SELECT sif.import_uid,sif.original_name,sif.source_format,sif.statement_start_date,sif.statement_end_date,
                sif.imported_rows,sif.duplicate_rows,sif.rejected_rows,ba.id AS bank_account_id,ba.nickname AS account_name,
                ba.institution,ba.currency,ba.ownership_scope
           FROM statement_import_files sif JOIN bank_accounts ba ON ba.id=sif.bank_account_id
          WHERE sif.parse_status='IMPORTED' AND ${accountWhere}
          ORDER BY COALESCE(sif.statement_end_date,sif.reviewed_at) DESC,sif.id DESC LIMIT 250`, accountParams
      ).then(([rows]) => rows),
      trustedTotals.categorySpendByCurrency(pool, txWhere, txParams, 300),
      pool.query(
        `SELECT bt.currency,DATE_FORMAT(bt.transaction_date,'%Y-%m') AS month,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.credit ELSE 0 END),0) AS money_in,
                COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.debit ELSE 0 END),0) AS money_out
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${txWhere}
          GROUP BY bt.currency,DATE_FORMAT(bt.transaction_date,'%Y-%m')
          ORDER BY bt.currency,month`, txParams
      ).then(([rows]) => rows),
      pool.query(
        `SELECT bt.currency,
                SUM(CASE WHEN bt.classification_status='UNCLASSIFIED' THEN 1 ELSE 0 END) AS needs_category,
                MIN(bt.transaction_date) AS first_transaction,
                MAX(bt.transaction_date) AS last_transaction
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${txWhere} GROUP BY bt.currency`, txParams
      ).then(([rows]) => rows)
    ]);

    const netPosition = {};
    for (const account of accountRows) {
      const cur = account.currency || 'AUD';
      const balance = Number(account.available_balance == null ? account.current_ledger_balance : account.available_balance || 0);
      const liability = /credit\s*card|loan|overdraft/i.test(String(account.account_type || ''));
      netPosition[cur] = Number(((netPosition[cur] || 0) + (liability ? -Math.abs(balance) : balance)).toFixed(2));
    }
    const categories = {};
    for (const row of categoryRows) (categories[row.currency || 'AUD'] ||= []).push({
      category: row.category,
      transaction_count: Number(row.source_transaction_count || 0),
      split_line_count: Number(row.split_line_count || 0),
      spent: Number(row.spent || 0)
    });
    const monthly = {};
    for (const row of monthlyRows) (monthly[row.currency || 'AUD'] ||= []).push({
      month: row.month, money_in: Number(row.money_in || 0), money_out: Number(row.money_out || 0)
    });

    return res.json({
      scope,
      architecture: 'STATEMENT_FIRST_MONEY_WAREHOUSE',
      currency_rule: 'Each currency is calculated separately. No cross-currency total is produced without verified FX evidence.',
      refund_rule: 'Linked refunds are separated from ordinary money-in and reduce net economic expense.',
      split_rule: 'Split child category amounts replace parent category allocation.',
      totals: {
        accounts: accountRows.length,
        statements: statementRows.length,
        transactions: summaryByCurrency.reduce((sum,row)=>sum+Number(row.source_transaction_count||0),0)
      },
      summary_by_currency: summaryByCurrency.map((row) => {
        const meta = metaRows.find((item) => String(item.currency || 'AUD').toUpperCase() === row.currency) || {};
        return {
          ...row,
          transactions: Number(row.source_transaction_count || 0),
          needs_category: Number(meta.needs_category || 0),
          first_transaction: meta.first_transaction || null,
          last_transaction: meta.last_transaction || null,
          bank_net_position: Number(netPosition[row.currency] || 0)
        };
      }),
      accounts: accountRows,
      statements: statementRows,
      categories_by_currency: categories,
      monthly_by_currency: monthly,
      generated_at: new Date().toISOString()
    });
  } catch (error) { return fail(res,error,'Failed to load statement money warehouse'); }
};

module.exports._test={spendingWhere,normalizeBulkChanges,bulkRowChanges};
