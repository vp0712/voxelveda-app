const crypto = require('node:crypto');
const pool = require('../config/db');
const money = require('../utils/money');
const { ensureFinanceSchema } = require('../services/financeSchema');
const { logAudit } = require('../services/auditService');
const { FinanceError, dateOnly } = require('../services/financeDomain');
const { applyAutoRulesToImport } = require('../services/financeRuleEngine');

const FORMATS = new Set(['CSV', 'PDF', 'OFX', 'QFX', 'QIF', 'XLSX']);

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function audit(req, values) {
  return { actorId: req.user?.id, ipAddress: req.ip, userAgent: req.get('user-agent'), ...values };
}

function fail(res, error, message) {
  if (error instanceof FinanceError) return res.status(error.statusCode || 400).json({ message: error.message, code: error.code, issues: error.issues });
  if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'This statement or review session already exists.', code: 'DUPLICATE_RECORD' });
  console.error(`${message}:`, error);
  return res.status(500).json({ message, code: 'STATEMENT_REVIEW_ERROR' });
}

function isBalanceMarker(row) {
  const text = String(row?.description || row?.merchant_name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return /^(opening|closing) balance\b/.test(text)
    || /\bbalance (?:brought|carried) forward\b/.test(text)
    || /\bbalance (?:b\/f|c\/f)\b/.test(text);
}

function statementRowHash(accountId, row) {
  return crypto.createHash('sha256').update([
    accountId,
    dateOnly(row.transaction_date) || '',
    String(row.description || '').trim().toLowerCase().replace(/\s+/g, ' '),
    String(row.reference || '').trim().toLowerCase(),
    money.fromCents(money.toCents(row.debit || 0)),
    money.fromCents(money.toCents(row.credit || 0)),
    row.running_balance === '' || row.running_balance === null || row.running_balance === undefined
      ? '' : money.fromCents(money.toCents(row.running_balance))
  ].join('|')).digest('hex');
}


function autoStatementCategory(row) {
  const explicit = String(row?.category || '').trim().slice(0, 120);
  if (explicit) return explicit;
  const text = `${row?.description || ''} ${row?.merchant_name || ''} ${row?.reference || ''}`.toUpperCase().replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const rules = [
    ['Cash', /\b(ATM|CASH WITHDRAWAL|CASH WDL|CASH OUT|CASH ADVANCE|BRANCH WITHDRAWAL|WITHDRAWAL CASH|CASH DISPENSED)\b/],
    ['Groceries', /\b(COLES|WOOLWORTHS|ALDI|IGA|COSTCO)\b/],
    ['Fuel & Vehicle', /\b(SHELL|AMPOL|CALTEX|UNITED PETROLEUM|MOBIL|PETROL|FUEL)\b/],
    ['Eating Out', /\b(MCDONALD|KFC|SUBWAY|UBER EATS|MENULOG|DOORDASH|RESTAURANT|CAFE|COFFEE)\b/],
    ['Software & Subscriptions', /\b(ADOBE|MICROSOFT|OPENAI|CHATGPT|CANVA|AUTODESK|GITHUB|DROPBOX|NOTION|ZOOM)\b/],
    ['Website & Hosting', /\b(HOSTINGER|CLOUDFLARE|RAILWAY|VERCEL|NETLIFY|DOMAIN|HOSTING)\b/],
    ['Materials & Manufacturing', /\b(BUNNINGS|TOTAL TOOLS|SYDNEY TOOLS|RS COMPONENTS|ELEMENT14|JAYCAR|FILAMENT|RESIN|MATERIAL)\b/],
    ['Phone & Internet', /\b(TELSTRA|OPTUS|VODAFONE|TPG|AUSSIE BROADBAND|NBN)\b/],
    ['Insurance', /\b(AAMI|ALLIANZ|BINGLE|NRMA|RACV|INSURANCE)\b/],
    ['Rent & Housing', /\b(RENT|REAL ESTATE|PROPERTY MANAGEMENT|BODY CORP|STRATA|MORTGAGE|HOME LOAN)\b/],
    ['Utilities', /\b(AGL|ORIGIN ENERGY|ENERGY AUSTRALIA|RED ENERGY|WATER BILL|CITY WEST WATER|YARRA VALLEY WATER|ELECTRICITY|GAS BILL)\b/],
    ['Health & Pharmacy', /\b(CHEMIST WAREHOUSE|PRICELINE PHARMACY|PHARMACY|MEDICAL|DENTAL|DENTIST|DOCTOR|GP CLINIC|HOSPITAL|BUPA|MEDIBANK)\b/],
    ['Transport', /\b(UBER|DIDI|13CABS|TAXI|MYKI|PTV|METRO TRAINS|V\/LINE|PARKING|TOLL|LINKT|EASTLINK)\b/],
    ['Shopping', /\b(KMART|TARGET|BIG W|AMAZON|EBAY|TEMU|SHEIN|MYER|DAVID JONES|JB HI-FI|OFFICEWORKS)\b/],
    ['Education & Training', /\b(UNIVERSITY|TAFE|COLLEGE|INSTITUTE|COURSE|TUITION|UDEMY|COURSERA)\b/],
    ['Tax & Government', /\b(ATO|AUSTRALIAN TAXATION OFFICE|VICROADS|SERVICE VICTORIA|COUNCIL RATE|GOVERNMENT FEE|ASIC)\b/],
    ['Bank Fees & Interest', /\b(BANK FEE|ACCOUNT FEE|CARD FEE|INTEREST CHARGE|OVERDRAWN FEE|FOREIGN TRANSACTION FEE)\b/],
    ['Travel', /\b(QANTAS|VIRGIN AUSTRALIA|JETSTAR|AIRBNB|BOOKING\.COM|EXPEDIA|HOTEL|FLIGHT)\b/],
    ['Income', /\b(SALARY|PAYROLL|WAGES|PAYMENT RECEIVED|REFUND|CREDIT INTEREST|DIVIDEND|COMMISSION)\b/],
    ['Transfer', /\b(OSKO|PAYID|TRANSFER|INTERNAL TRANSFER|FAST PAYMENT)\b/]
  ];
  for (const [category, pattern] of rules) if (pattern.test(text)) return category;
  return null;
}

function normalizeRow(accountId, accountCurrency, input, rowNo) {
  const row = input || {};
  const transactionDate = dateOnly(row.transaction_date);
  let debit = '0.00';
  let credit = '0.00';
  let runningBalance = null;
  let validationStatus = 'VALID';
  const messages = [];

  try { debit = money.fromCents(money.toCents(row.debit || 0)); } catch { validationStatus = 'REJECTED'; messages.push('Invalid debit amount'); }
  try { credit = money.fromCents(money.toCents(row.credit || 0)); } catch { validationStatus = 'REJECTED'; messages.push('Invalid credit amount'); }
  if (!transactionDate) { validationStatus = 'REJECTED'; messages.push('Invalid or missing transaction date'); }
  if ((money.toCents(debit) > 0n) === (money.toCents(credit) > 0n)) { validationStatus = 'REJECTED'; messages.push('Exactly one of debit or credit must be positive'); }
  if (row.running_balance !== '' && row.running_balance !== null && row.running_balance !== undefined) {
    try { runningBalance = money.fromCents(money.toCents(row.running_balance)); } catch { if (validationStatus === 'VALID') validationStatus = 'WARNING'; messages.push('Running balance could not be parsed'); }
  }
  const currency = String(row.currency || accountCurrency || 'AUD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) { validationStatus = 'REJECTED'; messages.push('Invalid currency code'); }
  if (!String(row.description || row.merchant_name || '').trim()) {
    if (validationStatus === 'VALID') validationStatus = 'WARNING';
    messages.push('No transaction description');
  }
  if (row.validation_hint && validationStatus !== 'REJECTED') {
    if (validationStatus === 'VALID') validationStatus = 'WARNING';
    messages.push(String(row.validation_hint).slice(0, 220));
  }
  if (isBalanceMarker(row)) {
    validationStatus = 'REJECTED';
    messages.push('Opening/closing balance is a statement marker, not a transaction');
  }
  return {
    row_no: rowNo,
    transaction_date: transactionDate,
    posting_date: dateOnly(row.posting_date) || null,
    description: String(row.description || '').trim().slice(0, 500) || null,
    reference: String(row.reference || '').trim().slice(0, 180) || null,
    debit,
    credit,
    running_balance: runningBalance,
    merchant_name: String(row.merchant_name || '').trim().slice(0, 255) || null,
    category: autoStatementCategory(row),
    currency,
    validation_status: validationStatus,
    validation_message: messages.join('; ').slice(0, 500) || null,
    selected: validationStatus === 'REJECTED' ? 0 : 1,
    row_hash: transactionDate ? statementRowHash(accountId, { ...row, transaction_date: transactionDate, debit, credit, running_balance: runningBalance }) : null,
    raw_payload_json: JSON.stringify(row)
  };
}

function originalStatementPayload(row) {
  if (!row) return null;
  const candidates = [row.raw_payload_json, row.override_original_json];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === 'object') return candidate;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {}
  }
  return {
    transaction_date: row.transaction_date,
    posting_date: row.posting_date,
    description: row.description,
    merchant_name: row.merchant_name,
    reference: row.reference,
    category: row.category,
    debit: row.debit,
    credit: row.credit,
    running_balance: row.running_balance,
    currency: row.currency
  };
}

function sessionSummary(session) {
  return {
    total: Number(session.total_rows || 0),
    valid: Number(session.valid_rows || 0),
    warning: Number(session.warning_rows || 0),
    duplicate: Number(session.duplicate_rows || 0),
    rejected: Number(session.rejected_rows || 0),
    selected: Math.max(0, Number(session.valid_rows || 0) + Number(session.warning_rows || 0))
  };
}

function countRows(rows) {
  return rows.reduce((acc, row) => {
    if (row.validation_status === 'VALID') acc.valid += 1;
    else if (row.validation_status === 'WARNING') acc.warning += 1;
    else if (row.validation_status === 'DUPLICATE') acc.duplicate += 1;
    else acc.rejected += 1;
    return acc;
  }, { valid: 0, warning: 0, duplicate: 0, rejected: 0 });
}

async function normalizeAndDedupe(db, account, inputRows, options = {}) {
  const normalized = inputRows.map((row, index) => normalizeRow(account.id, account.currency, row, index + 1));
  const hashes = [...new Set(normalized.map((row) => row.row_hash).filter(Boolean))];
  const duplicateHashes = new Set();
  const duplicateSources = new Map();
  const contentHash = String(options.contentHash || '').trim().toLowerCase();

  if (hashes.length) {
    const chunkSize = 500;
    for (let offset = 0; offset < hashes.length; offset += chunkSize) {
      const chunk = hashes.slice(offset, offset + chunkSize);
      const placeholders = chunk.map(() => '?').join(',');

      const [existingLedger] = await db.query(
        `SELECT row_hash FROM bank_transactions WHERE bank_account_id=? AND row_hash IN (${placeholders})`,
        [account.id, ...chunk]
      );
      for (const item of existingLedger) {
        duplicateHashes.add(item.row_hash);
        duplicateSources.set(item.row_hash, 'already exists in the committed transaction ledger');
      }

      const [pendingRows] = await db.query(
        `SELECT sir.row_hash, sis.import_uid, sis.original_name
           FROM statement_import_rows sir
           JOIN statement_import_sessions sis ON sis.id=sir.import_session_id
          WHERE sis.bank_account_id=?
            AND sis.status='PENDING_REVIEW'
            AND (?='' OR sis.content_hash<>?)
            AND sir.validation_status IN ('VALID','WARNING')
            AND sir.selected=1
            AND sir.row_hash IN (${placeholders})`,
        [account.id, contentHash, contentHash, ...chunk]
      );
      for (const item of pendingRows) {
        duplicateHashes.add(item.row_hash);
        if (!duplicateSources.has(item.row_hash)) {
          duplicateSources.set(
            item.row_hash,
            `already staged in ${String(item.original_name || item.import_uid || 'another statement review').slice(0, 180)}`
          );
        }
      }
    }
  }

  const seenInFile = new Set();
  for (const row of normalized) {
    if (!row.row_hash || row.validation_status === 'REJECTED') continue;
    let duplicateReason = null;
    if (duplicateHashes.has(row.row_hash)) duplicateReason = duplicateSources.get(row.row_hash) || 'already exists in another statement';
    else if (seenInFile.has(row.row_hash)) duplicateReason = 'repeated inside this statement file';

    if (duplicateReason) {
      row.validation_status = 'DUPLICATE';
      const message = `Duplicate transaction — ${duplicateReason}. Excluded from import, totals and reports.`;
      row.validation_message = row.validation_message ? `${row.validation_message}; ${message}` : message;
      row.selected = 0;
    }
    seenInFile.add(row.row_hash);
  }
  return { normalized, counts: countRows(normalized) };
}

async function insertReviewRows(db, sessionId, normalized) {
  const rows = Array.isArray(normalized) ? normalized : [];
  const chunkSize = 250;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',');
    const params = [];
    for (const row of chunk) {
      params.push(
        sessionId, row.row_no, row.transaction_date, row.posting_date, row.description, row.reference, row.debit, row.credit,
        row.running_balance, row.merchant_name, row.category, row.currency, row.row_hash, row.validation_status, row.validation_message, row.selected, row.raw_payload_json
      );
    }
    await db.query(
      `INSERT INTO statement_import_rows
       (import_session_id, row_no, transaction_date, posting_date, description, reference, debit, credit, running_balance,
        merchant_name, category, currency, row_hash, validation_status, validation_message, selected, raw_payload_json)
       VALUES ${placeholders}`,
      params
    );
  }
}

async function repairPendingReview(db, session) {
  if (!session || session.status !== 'PENDING_REVIEW') return { session, rows: null, repaired: 0 };
  const [rows] = await db.query('SELECT * FROM statement_import_rows WHERE import_session_id=? ORDER BY row_no', [session.id]);
  const staleMarkers = rows.filter((row) => isBalanceMarker(row) && (Number(row.selected) || row.validation_status !== 'REJECTED'));
  if (staleMarkers.length) {
    const ids = staleMarkers.map((row) => Number(row.id)).filter(Boolean);
    const placeholders = ids.map(() => '?').join(',');
    await db.query(
      `UPDATE statement_import_rows
       SET selected=0, validation_status='REJECTED', validation_message='Opening/closing balance is a statement marker, not a transaction'
       WHERE id IN (${placeholders})`, ids
    );
  }
  const [freshRows] = staleMarkers.length
    ? await db.query('SELECT * FROM statement_import_rows WHERE import_session_id=? ORDER BY row_no', [session.id])
    : [rows];
  const counts = countRows(freshRows);
  if (staleMarkers.length || Number(session.valid_rows || 0) !== counts.valid || Number(session.warning_rows || 0) !== counts.warning || Number(session.duplicate_rows || 0) !== counts.duplicate || Number(session.rejected_rows || 0) !== counts.rejected) {
    await db.query(
      'UPDATE statement_import_sessions SET valid_rows=?, warning_rows=?, duplicate_rows=?, rejected_rows=? WHERE id=?',
      [counts.valid, counts.warning, counts.duplicate, counts.rejected, session.id]
    );
  }
  return {
    session: { ...session, valid_rows: counts.valid, warning_rows: counts.warning, duplicate_rows: counts.duplicate, rejected_rows: counts.rejected },
    rows: freshRows,
    repaired: staleMarkers.length
  };
}

exports.preview = async (req, res) => {
  let db;
  try {
    await ensureFinanceSchema();
    const accountId = Number(req.params.id || 0);
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    const sourceFormat = String(req.body.source_format || 'CSV').toUpperCase();
    if (!FORMATS.has(sourceFormat)) throw new FinanceError('Unsupported statement format.', 400, 'UNSUPPORTED_STATEMENT_FORMAT');
    if (!rows.length) throw new FinanceError('No transactions could be extracted from this statement.', 400, 'NO_EXTRACTED_TRANSACTIONS');
    if (rows.length > 10000) throw new FinanceError('Statement preview is limited to 10,000 rows.', 413, 'IMPORT_TOO_LARGE');
    const fileHash = String(req.body.content_hash || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(fileHash)) throw new FinanceError('A valid SHA-256 statement hash is required.', 400, 'INVALID_CONTENT_HASH');

    db = await pool.getConnection();
    await db.beginTransaction();
    const [[account]] = await db.query('SELECT * FROM bank_accounts WHERE id=? AND status="ACTIVE"', [accountId]);
    if (!account) throw new FinanceError('Active financial account not found.', 404, 'BANK_ACCOUNT_NOT_FOUND');
    const [[alreadyImported]] = await db.query('SELECT import_uid FROM statement_import_files WHERE bank_account_id=? AND content_hash=? LIMIT 1', [accountId, fileHash]);
    if (alreadyImported) throw new FinanceError(`This statement was already committed as ${alreadyImported.import_uid}.`, 409, 'DUPLICATE_STATEMENT_FILE');

    const prepared = await normalizeAndDedupe(db, account, rows, { contentHash: fileHash });
    const normalized = prepared.normalized;
    const counts = prepared.counts;
    const dates = normalized.filter((row) => row.validation_status !== 'REJECTED').map((row) => row.transaction_date).filter(Boolean).sort();
    const parserVersion = String(req.body.parser_version || '').trim().slice(0, 40) || null;
    const parserConfidence = Number.isFinite(Number(req.body.parser_confidence)) ? Math.max(0, Math.min(1, Number(req.body.parser_confidence))) : null;
    const reconciliationStatus = String(req.body.reconciliation_status || '').trim().slice(0, 30) || null;
    const reconciliationDifference = req.body.reconciliation_difference === null || req.body.reconciliation_difference === undefined || req.body.reconciliation_difference === '' ? null : Number(req.body.reconciliation_difference);
    const diagnostics = req.body.extraction_diagnostics && typeof req.body.extraction_diagnostics === 'object' ? JSON.stringify(req.body.extraction_diagnostics) : null;

    const [[existingSession]] = await db.query('SELECT * FROM statement_import_sessions WHERE bank_account_id=? AND content_hash=? ORDER BY id DESC LIMIT 1 FOR UPDATE', [accountId, fileHash]);
    if (existingSession && existingSession.status === 'PENDING_REVIEW') {
      const existingImportable = Number(existingSession.valid_rows || 0) + Number(existingSession.warning_rows || 0);
      const parserChanged = sourceFormat === 'PDF' && parserVersion && String(existingSession.parser_version || '') !== parserVersion;
      const shouldReparse = sourceFormat === 'PDF' && (parserChanged || existingImportable === 0);
      if (shouldReparse) {
        await db.query('DELETE FROM statement_import_rows WHERE import_session_id=?', [existingSession.id]);
        await insertReviewRows(db, existingSession.id, normalized);
        await db.query(
          `UPDATE statement_import_sessions SET
             source_format=?, original_name=?, statement_start_date=?, statement_end_date=?, opening_balance=?, closing_balance=?,
             total_rows=?, valid_rows=?, warning_rows=?, duplicate_rows=?, rejected_rows=?, parser_version=?, parser_confidence=?,
             reconciliation_status=?, reconciliation_difference=?, extraction_diagnostics_json=?, updated_at=NOW()
           WHERE id=?`,
          [sourceFormat, String(req.body.original_name || existingSession.original_name || 'statement.pdf').slice(0,255),
            dateOnly(req.body.statement_start_date) || dates[0] || null, dateOnly(req.body.statement_end_date) || dates[dates.length-1] || null,
            req.body.opening_balance ?? null, req.body.closing_balance ?? null, normalized.length, counts.valid, counts.warning, counts.duplicate, counts.rejected,
            parserVersion, parserConfidence, reconciliationStatus, Number.isFinite(reconciliationDifference) ? reconciliationDifference : null, diagnostics, existingSession.id]
        );
        await logAudit(db, audit(req, { action: 'STATEMENT_PREVIEW_REPARSED', module: 'finance_intelligence', recordType: 'statement_import_session', recordId: existingSession.import_uid, newValue: { parser_version: parserVersion, previous_parser_version: existingSession.parser_version || null, previous_importable_rows: existingImportable, total_rows: normalized.length, ...counts } }));
        await db.commit();
        return res.status(200).json({
          message: `Existing review ${existingSession.import_uid} was rebuilt with the current PDF parser.`,
          import_uid: existingSession.import_uid,
          reused: true,
          reparsed: true,
          summary: { total: normalized.length, ...counts, selected: counts.valid + counts.warning },
          coverage: { start: dates[0] || null, end: dates[dates.length - 1] || null },
          rows: normalized.slice(0,250)
        });
      }
      const repaired = await repairPendingReview(db, existingSession);
      await db.commit();
      return res.status(200).json({
        message: repaired.repaired
          ? `Existing review ${existingSession.import_uid} reopened and ${repaired.repaired} balance marker row(s) were safely excluded.`
          : `Existing review ${existingSession.import_uid} reopened. No duplicate review was created.`,
        import_uid: existingSession.import_uid,
        reused: true,
        repaired_rows: repaired.repaired,
        summary: sessionSummary(repaired.session),
        coverage: { start: existingSession.statement_start_date || null, end: existingSession.statement_end_date || null }
      });
    }
    if (existingSession && existingSession.status !== 'REJECTED') {
      throw new FinanceError(`This statement review is ${existingSession.status}.`, 409, 'STATEMENT_REVIEW_LOCKED');
    }

    const importUid = uid('REVIEW');
    const [session] = await db.query(
      `INSERT INTO statement_import_sessions
       (import_uid, bank_account_id, source_format, original_name, content_hash, statement_start_date, statement_end_date,
        opening_balance, closing_balance, total_rows, valid_rows, warning_rows, duplicate_rows, rejected_rows, created_by,
        parser_version, parser_confidence, reconciliation_status, reconciliation_difference, extraction_diagnostics_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [importUid, accountId, sourceFormat, String(req.body.original_name || `statement.${sourceFormat.toLowerCase()}`).slice(0, 255), fileHash,
        dateOnly(req.body.statement_start_date) || dates[0] || null, dateOnly(req.body.statement_end_date) || dates[dates.length - 1] || null,
        req.body.opening_balance ?? null, req.body.closing_balance ?? null, normalized.length, counts.valid, counts.warning, counts.duplicate, counts.rejected, req.user.id,
        parserVersion, parserConfidence, reconciliationStatus, Number.isFinite(reconciliationDifference) ? reconciliationDifference : null, diagnostics]
    );
    await insertReviewRows(db, session.insertId, normalized);
    await logAudit(db, audit(req, { action: 'STATEMENT_PREVIEW_CREATED', module: 'finance_intelligence', recordType: 'statement_import_session', recordId: importUid, newValue: { bank_account_id: accountId, source_format: sourceFormat, parser_version: parserVersion, total_rows: normalized.length, ...counts } }));
    await db.commit();
    return res.status(201).json({
      message: 'Statement parsed and staged for review. No bank transactions have been committed yet.',
      import_uid: importUid,
      summary: { total: normalized.length, ...counts, selected: counts.valid + counts.warning },
      coverage: { start: dates[0] || null, end: dates[dates.length - 1] || null },
      rows: normalized.slice(0, 250)
    });
  } catch (error) {
    if (db) await db.rollback();
    return fail(res, error, 'Failed to stage statement preview');
  } finally {
    if (db) db.release();
  }
};

exports.list = async (req, res) => {
  try {
    const status = String(req.query.status || '').trim().toUpperCase();
    const params = [];
    const where = status ? 'WHERE s.status=?' : '';
    if (status) params.push(status);
    const [rows] = await pool.query(
      `SELECT s.*, ba.nickname AS account_name, ba.ownership_scope
       FROM statement_import_sessions s JOIN bank_accounts ba ON ba.id=s.bank_account_id
       ${where} ORDER BY s.created_at DESC LIMIT 100`, params
    );
    return res.json({ sessions: rows });
  } catch (error) { return fail(res, error, 'Failed to load statement review queue'); }
};

exports.get = async (req, res) => {
  let db;
  try {
    db = await pool.getConnection();
    await db.beginTransaction();
    const [[session]] = await db.query(
      `SELECT s.*, ba.nickname AS account_name, ba.ownership_scope, ba.currency AS account_currency
       FROM statement_import_sessions s JOIN bank_accounts ba ON ba.id=s.bank_account_id WHERE s.import_uid=? FOR UPDATE`, [req.params.uid]
    );
    if (!session) throw new FinanceError('Statement review session not found.', 404, 'STATEMENT_REVIEW_NOT_FOUND');
    const repaired = await repairPendingReview(db, session);
    const rows = repaired.rows || (await db.query('SELECT * FROM statement_import_rows WHERE import_session_id=? ORDER BY row_no', [session.id]))[0];
    await db.commit();
    return res.json({ session: repaired.session || session, rows, repaired_rows: repaired.repaired });
  } catch (error) {
    if (db) await db.rollback();
    return fail(res, error, 'Failed to load statement review');
  } finally { if (db) db.release(); }
};

exports.updateRowSelection = async (req, res) => {
  try {
    const [[session]] = await pool.query('SELECT * FROM statement_import_sessions WHERE import_uid=?', [req.params.uid]);
    if (!session) throw new FinanceError('Statement review session not found.', 404, 'STATEMENT_REVIEW_NOT_FOUND');
    if (session.status !== 'PENDING_REVIEW') throw new FinanceError('Only pending statement reviews can be edited.', 409, 'STATEMENT_REVIEW_LOCKED');
    const rowId = Number(req.params.rowId || 0);
    const selected = req.body.selected ? 1 : 0;
    const [[row]] = await pool.query('SELECT * FROM statement_import_rows WHERE id=? AND import_session_id=?', [rowId, session.id]);
    if (!row) throw new FinanceError('Statement row not found.', 404, 'STATEMENT_ROW_NOT_FOUND');
    if ((row.validation_status === 'REJECTED' || row.validation_status === 'DUPLICATE' || isBalanceMarker(row)) && selected) throw new FinanceError('Rejected, duplicate or balance-marker rows cannot be selected for import.', 409, 'REJECTED_ROW_NOT_IMPORTABLE');
    await pool.query('UPDATE statement_import_rows SET selected=? WHERE id=?', [selected, row.id]);
    await logAudit(pool, audit(req, { action: 'STATEMENT_ROW_SELECTION_CHANGED', module: 'finance_intelligence', recordType: 'statement_import_row', recordId: row.id, oldValue: { selected: row.selected }, newValue: { selected } }));
    return res.json({ message: selected ? 'Row selected for import.' : 'Row excluded from import.' });
  } catch (error) { return fail(res, error, 'Failed to update statement row'); }
};


exports.overrideRejectedRow = async (req, res) => {
  let db;
  try {
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 3) throw new FinanceError('Explain why this rejected row is a genuine transaction before including it.', 400, 'OVERRIDE_REASON_REQUIRED');

    db = await pool.getConnection();
    await db.beginTransaction();
    const [[session]] = await db.query('SELECT * FROM statement_import_sessions WHERE import_uid=? FOR UPDATE', [req.params.uid]);
    if (!session) throw new FinanceError('Statement review session not found.', 404, 'STATEMENT_REVIEW_NOT_FOUND');
    if (session.status !== 'PENDING_REVIEW') throw new FinanceError('Only pending statement reviews can be corrected.', 409, 'STATEMENT_REVIEW_LOCKED');

    const [[account]] = await db.query('SELECT * FROM bank_accounts WHERE id=? AND status="ACTIVE" FOR UPDATE', [session.bank_account_id]);
    if (!account) throw new FinanceError('Active financial account not found.', 404, 'BANK_ACCOUNT_NOT_FOUND');

    const rowId = Number(req.params.rowId || 0);
    const [[row]] = await db.query('SELECT * FROM statement_import_rows WHERE id=? AND import_session_id=? FOR UPDATE', [rowId, session.id]);
    if (!row) throw new FinanceError('Statement row not found.', 404, 'STATEMENT_ROW_NOT_FOUND');
    if (row.validation_status === 'DUPLICATE') throw new FinanceError('Duplicate rows stay locked to prevent double-importing the same transaction.', 409, 'DUPLICATE_ROW_LOCKED');
    if (isBalanceMarker(row)) throw new FinanceError('Opening and closing balances are statement markers, not transactions, and cannot be imported.', 409, 'BALANCE_MARKER_LOCKED');
    if (row.validation_status !== 'REJECTED' && !Number(row.manual_override || 0)) {
      throw new FinanceError('Only rejected rows need the correction workflow. Valid and warning rows can be selected normally.', 409, 'ROW_OVERRIDE_NOT_REQUIRED');
    }

    const direction = String(req.body.direction || '').trim().toUpperCase();
    const amount = req.body.amount;
    let debit = req.body.debit ?? row.debit;
    let credit = req.body.credit ?? row.credit;
    if (amount !== undefined && amount !== null && amount !== '') {
      const normalizedAmount = money.fromCents(money.toCents(amount));
      if (direction === 'DEBIT') { debit = normalizedAmount; credit = '0.00'; }
      else if (direction === 'CREDIT') { credit = normalizedAmount; debit = '0.00'; }
    }

    const candidate = normalizeRow(account.id, account.currency, {
      transaction_date: req.body.transaction_date ?? row.transaction_date,
      posting_date: req.body.posting_date ?? row.posting_date,
      description: req.body.description ?? row.description,
      reference: req.body.reference ?? row.reference,
      debit,
      credit,
      running_balance: req.body.running_balance ?? row.running_balance,
      merchant_name: req.body.merchant_name ?? row.merchant_name,
      category: req.body.category ?? row.category,
      currency: req.body.currency ?? row.currency ?? account.currency
    }, row.row_no);

    if (candidate.validation_status === 'REJECTED' || !candidate.row_hash) {
      throw new FinanceError(
        candidate.validation_message || 'Correct the date and choose exactly one money-out or money-in amount.',
        422,
        'ROW_STILL_INVALID'
      );
    }
    if (isBalanceMarker(candidate)) throw new FinanceError('Balance markers cannot be converted into transactions.', 409, 'BALANCE_MARKER_LOCKED');

    const [[existingLedger]] = await db.query(
      'SELECT id FROM bank_transactions WHERE bank_account_id=? AND row_hash=? LIMIT 1',
      [account.id, candidate.row_hash]
    );
    const [[existingReview]] = await db.query(
      `SELECT id FROM statement_import_rows
         WHERE import_session_id=? AND id<>? AND row_hash=? AND validation_status IN ('VALID','WARNING','DUPLICATE')
         LIMIT 1`,
      [session.id, row.id, candidate.row_hash]
    );
    if (existingLedger || existingReview) {
      throw new FinanceError('This corrected row matches an existing transaction and remains excluded as a duplicate.', 409, 'CORRECTED_ROW_DUPLICATE');
    }

    const original = row.override_original_json || JSON.stringify({
      transaction_date: row.transaction_date,
      posting_date: row.posting_date,
      description: row.description,
      reference: row.reference,
      debit: row.debit,
      credit: row.credit,
      running_balance: row.running_balance,
      merchant_name: row.merchant_name,
      category: row.category,
      currency: row.currency,
      validation_status: row.validation_status,
      validation_message: row.validation_message
    });
    const overrideMessage = `Manually corrected and approved for import: ${reason}`.slice(0, 500);

    await db.query(
      `UPDATE statement_import_rows SET
         transaction_date=?, posting_date=?, description=?, reference=?, debit=?, credit=?, running_balance=?,
         merchant_name=?, category=?, currency=?, row_hash=?, validation_status='WARNING', validation_message=?, selected=1,
         manual_override=1, override_reason=?, override_original_json=?, overridden_by=?, overridden_at=NOW(),
         override_version=override_version+1
       WHERE id=?`,
      [candidate.transaction_date, candidate.posting_date, candidate.description, candidate.reference, candidate.debit, candidate.credit,
        candidate.running_balance, candidate.merchant_name, candidate.category, candidate.currency, candidate.row_hash, overrideMessage,
        reason.slice(0, 500), typeof original === 'string' ? original : JSON.stringify(original), req.user.id, row.id]
    );

    const [freshRows] = await db.query('SELECT * FROM statement_import_rows WHERE import_session_id=? ORDER BY row_no', [session.id]);
    const counts = countRows(freshRows);
    await db.query(
      'UPDATE statement_import_sessions SET valid_rows=?, warning_rows=?, duplicate_rows=?, rejected_rows=? WHERE id=?',
      [counts.valid, counts.warning, counts.duplicate, counts.rejected, session.id]
    );
    const corrected = freshRows.find((item) => Number(item.id) === Number(row.id));
    await logAudit(db, audit(req, {
      action: 'STATEMENT_REJECTED_ROW_OVERRIDDEN',
      module: 'finance_intelligence',
      recordType: 'statement_import_row',
      recordId: row.id,
      oldValue: { validation_status: row.validation_status, selected: row.selected, validation_message: row.validation_message },
      newValue: { validation_status: 'WARNING', selected: 1, manual_override: true, reason }
    }));
    await db.commit();
    return res.json({
      message: 'Rejected row corrected and selected. It will remain clearly marked as a manual override in the transaction ledger.',
      row: corrected,
      summary: { total: freshRows.length, ...counts, selected: freshRows.filter((item) => Number(item.selected) && ['VALID','WARNING'].includes(item.validation_status)).length }
    });
  } catch (error) {
    if (db) await db.rollback();
    return fail(res, error, 'Failed to correct rejected statement row');
  } finally { if (db) db.release(); }
};

exports.commit = async (req, res) => {
  let db;
  try {
    db = await pool.getConnection();
    await db.beginTransaction();
    const [[session]] = await db.query('SELECT * FROM statement_import_sessions WHERE import_uid=? FOR UPDATE', [req.params.uid]);
    if (!session) throw new FinanceError('Statement review session not found.', 404, 'STATEMENT_REVIEW_NOT_FOUND');
    if (session.status === 'IMPORTED') {
      const [[file]] = await db.query('SELECT imported_rows, duplicate_rows, rejected_rows FROM statement_import_files WHERE import_uid=? LIMIT 1', [session.import_uid]);
      await db.commit();
      return res.json({
        message: 'This statement was already imported successfully. No duplicate import was created.',
        imported: Number(file?.imported_rows || 0),
        duplicates: Number(file?.duplicate_rows || 0),
        rejected: Number(file?.rejected_rows || 0),
        already_imported: true
      });
    }
    if (session.status !== 'PENDING_REVIEW') throw new FinanceError(`Statement review is already ${session.status}.`, 409, 'STATEMENT_REVIEW_LOCKED');
    const [[account]] = await db.query('SELECT * FROM bank_accounts WHERE id=? AND status="ACTIVE" FOR UPDATE', [session.bank_account_id]);
    if (!account) throw new FinanceError('Active financial account not found.', 404, 'BANK_ACCOUNT_NOT_FOUND');

    const repaired = await repairPendingReview(db, session);
    const [selectedRows] = await db.query(
      `SELECT * FROM statement_import_rows
       WHERE import_session_id=? AND selected=1 AND validation_status IN ('VALID','WARNING') ORDER BY row_no`, [session.id]
    );
    if (!selectedRows.length) {
      await logAudit(db, audit(req, { action: 'STATEMENT_REVIEW_NO_IMPORTABLE_ROWS', module: 'finance_intelligence', recordType: 'statement_import_session', recordId: session.import_uid, newValue: { repaired_balance_markers: repaired.repaired, parser_version: session.parser_version || null } }));
      await db.commit();
      return res.status(422).json({
        message: repaired.repaired
          ? `This review contained ${repaired.repaired} opening/closing balance marker row(s), not transactions. They have now been safely excluded. Re-upload the same PDF once so the current parser can rebuild the review, or use CSV/OFX/QFX if no transaction rows can be verified.`
          : 'No importable transaction rows are selected. If this is an older PDF review, re-upload the same PDF so the current parser can rebuild it. Otherwise select a valid/warning row or use CSV/OFX/QFX.',
        code: 'NO_IMPORTABLE_TRANSACTIONS',
        review_repaired: true,
        repaired_rows: repaired.repaired,
        parser_version: session.parser_version || null
      });
    }

    const batchUid = uid('BANK');
    let imported = 0;
    let duplicates = 0;
    const finalDuplicateRowIds = [];
    const rows = selectedRows;
    const dates = rows.map((row) => String(row.transaction_date || '').slice(0, 10)).filter(Boolean).sort();
    const minDate = dates[0] || null;
    const maxDate = dates[dates.length - 1] || null;
    const chunkSize = 400;

    for (let offset = 0; offset < rows.length; offset += chunkSize) {
      const chunk = rows.slice(offset, offset + chunkSize);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'STATEMENT_IMPORT\', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',');
      const params = [];
      for (const row of chunk) {
        params.push(
          account.id, batchUid, row.row_hash, row.transaction_date, row.posting_date, row.description, row.reference,
          row.debit, row.credit, row.running_balance, session.source_format, row.merchant_name, row.currency || account.currency,
          account.ownership_scope, row.category, row.category ? 'CLASSIFIED' : 'UNCLASSIFIED',
          session.import_uid, row.id, row.validation_status, Number(row.manual_override || 0) ? 1 : 0, req.user.id
        );
      }
      const [insert] = await db.query(
        `INSERT IGNORE INTO bank_transactions
         (bank_account_id, import_batch_uid, row_hash, transaction_date, posting_date, description, reference,
          debit, credit, running_balance, source_type, source_provider, merchant_name, currency, ownership_scope,
          category, classification_status, statement_import_uid, statement_row_id, review_source_status, manual_override, imported_by)
         VALUES ${placeholders}`,
        params
      );
      const inserted = Number(insert.affectedRows || 0);
      imported += inserted;
      duplicates += Math.max(0, chunk.length - inserted);

      const chunkHashes = chunk.map((row) => row.row_hash).filter(Boolean);
      if (chunkHashes.length) {
        const idPlaceholders = chunkHashes.map(() => '?').join(',');
        const [ledgerRows] = await db.query(
          `SELECT id,row_hash FROM bank_transactions WHERE bank_account_id=? AND import_batch_uid=? AND row_hash IN (${idPlaceholders})`,
          [account.id, batchUid, ...chunkHashes]
        );
        const ledgerByHash = new Map(ledgerRows.map((item) => [item.row_hash, item.id]));
        for (const row of chunk) {
          const bankTransactionId = ledgerByHash.get(row.row_hash);
          if (!bankTransactionId) {
            finalDuplicateRowIds.push(Number(row.id));
            continue;
          }
          await db.query(
            `INSERT IGNORE INTO bank_transaction_original_data
             (bank_transaction_id,bank_account_id,source_type,source_statement_uid,source_statement_row_id,
              original_transaction_date,original_posting_date,original_description,original_merchant_string,
              original_reference,original_bank_category,original_debit,original_credit,original_running_balance,
              original_currency,original_payload_json,captured_by)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              bankTransactionId, account.id, 'STATEMENT_IMPORT', session.import_uid, row.id,
              row.transaction_date, row.posting_date, row.description, row.merchant_name,
              row.reference, row.category, row.debit, row.credit, row.running_balance,
              row.currency || account.currency, JSON.stringify(originalStatementPayload(row)), req.user.id
            ]
          );
        }
      }
    }

    if (finalDuplicateRowIds.length) {
      const ids = [...new Set(finalDuplicateRowIds.filter((id) => Number.isInteger(id) && id > 0))];
      if (ids.length) {
        const placeholders = ids.map(() => '?').join(',');
        await db.query(
          `UPDATE statement_import_rows
              SET selected=0,
                  validation_status='DUPLICATE',
                  validation_message=LEFT(CONCAT_WS('; ', NULLIF(validation_message,''), 'Duplicate detected during final commit — excluded from the ledger, totals and reports.'),500)
            WHERE id IN (${placeholders})`,
          ids
        );
      }
    }

    const [finalReviewRows] = await db.query(
      'SELECT validation_status FROM statement_import_rows WHERE import_session_id=?',
      [session.id]
    );
    const finalCounts = countRows(finalReviewRows);
    await db.query(
      'UPDATE statement_import_sessions SET valid_rows=?, warning_rows=?, duplicate_rows=?, rejected_rows=? WHERE id=?',
      [finalCounts.valid, finalCounts.warning, finalCounts.duplicate, finalCounts.rejected, session.id]
    );

    const autoRuleResult = await applyAutoRulesToImport(db, { batchUid, userId: req.user.id });
    for (const change of autoRuleResult.changes) {
      await logAudit(db, audit(req, {
        action: 'FINANCE_RULE_AUTO_APPLIED',
        module: 'finance_intelligence',
        recordType: 'bank_transaction',
        recordId: change.transaction_id,
        oldValue: change.old_value,
        newValue: { ...change.new_value, finance_category_rule_id: change.rule_id }
      }));
    }

    await db.query(
      `INSERT INTO bank_import_batches (batch_uid, bank_account_id, original_name, imported_rows, duplicate_rows, rejected_rows, imported_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [batchUid, account.id, session.original_name, imported, duplicates, Number(repaired.session?.rejected_rows || session.rejected_rows || 0), req.user.id]
    );
    await db.query(
      `INSERT INTO statement_import_files
       (import_uid, bank_account_id, source_format, original_name, content_hash, statement_start_date, statement_end_date,
        opening_balance, closing_balance, parse_status, imported_rows, duplicate_rows, rejected_rows, uploaded_by, reviewed_at, reviewed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'IMPORTED', ?, ?, ?, ?, NOW(), ?)`,
      [session.import_uid, account.id, session.source_format, session.original_name, session.content_hash,
        session.statement_start_date || minDate, session.statement_end_date || maxDate, session.opening_balance, session.closing_balance,
        imported, finalCounts.duplicate, finalCounts.rejected, session.created_by, req.user.id]
    );
    await db.query(
      'UPDATE statement_import_sessions SET status="IMPORTED", reviewed_by=?, reviewed_at=NOW(), committed_by=?, committed_at=NOW() WHERE id=?',
      [req.user.id, req.user.id, session.id]
    );
    const latestRunningBalance = [...rows].reverse().find((row) => row.running_balance !== null && row.running_balance !== undefined && row.running_balance !== '');
    const statementClosingBalance = session.closing_balance !== null && session.closing_balance !== undefined && session.closing_balance !== ''
      ? session.closing_balance
      : (latestRunningBalance ? latestRunningBalance.running_balance : null);
    const advancesAccountBalance = statementClosingBalance !== null
      && (!account.history_end_date || !maxDate || String(maxDate) >= String(account.history_end_date).slice(0,10));
    if (minDate || maxDate || advancesAccountBalance) {
      await db.query(
        `UPDATE bank_accounts SET
          history_start_date=CASE WHEN history_start_date IS NULL OR ? < history_start_date THEN ? ELSE history_start_date END,
          history_end_date=CASE WHEN history_end_date IS NULL OR ? > history_end_date THEN ? ELSE history_end_date END,
          current_ledger_balance=CASE WHEN ?=1 THEN ? ELSE current_ledger_balance END,
          reconciled_balance=CASE WHEN ?=1 THEN ? ELSE reconciled_balance END
         WHERE id=?`,
        [minDate, minDate, maxDate, maxDate, advancesAccountBalance ? 1 : 0, statementClosingBalance,
          advancesAccountBalance ? 1 : 0, statementClosingBalance, account.id]
      );
    }
    const manualOverrides = rows.filter((row) => Number(row.manual_override || 0)).length;
    await logAudit(db, audit(req, { action: 'STATEMENT_REVIEW_COMMITTED', module: 'finance_intelligence', recordType: 'statement_import_session', recordId: session.import_uid, newValue: { imported, duplicates: finalCounts.duplicate, duplicates_at_commit: duplicates, manual_overrides: manualOverrides, repaired_balance_markers: repaired.repaired, batch_uid: batchUid, closing_balance_applied: advancesAccountBalance ? statementClosingBalance : null, auto_rules: { matched: autoRuleResult.matched, applied: autoRuleResult.applied, skipped_period: autoRuleResult.skipped_period } } }));
    await db.commit();
    return res.json({
      message: `${imported} statement transactions committed after review. ${finalCounts.duplicate} duplicate transaction(s) were excluded from the ledger, totals and reports.${repaired.repaired ? ` ${repaired.repaired} stale balance marker row(s) were safely excluded.` : ''}`,
      imported,
      duplicates: finalCounts.duplicate,
      duplicates_at_commit: duplicates,
      manual_overrides: manualOverrides,
      excluded_balance_markers: repaired.repaired,
      auto_rules: { matched: autoRuleResult.matched, applied: autoRuleResult.applied, skipped_period: autoRuleResult.skipped_period },
      batch_uid: batchUid,
      coverage: { start: minDate, end: maxDate }
    });
  } catch (error) {
    if (db) await db.rollback();
    return fail(res, error, 'Failed to commit statement review');
  } finally { if (db) db.release(); }
};

exports.getOriginalBankTransaction = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const id = Number(req.params.id || 0);
    const [[row]] = await pool.query(
      `SELECT
         bt.id AS bank_transaction_id, bt.bank_account_id, bt.source_type, bt.statement_import_uid,
         original.source_statement_row_id, original.original_transaction_date, original.original_posting_date,
         original.original_description, original.original_merchant_string, original.original_reference,
         original.original_bank_category, original.original_debit, original.original_credit,
         original.original_running_balance, original.original_currency, original.original_payload_json,
         original.captured_at,
         ba.nickname AS account_name, ba.institution
       FROM bank_transactions bt
       JOIN bank_accounts ba ON ba.id=bt.bank_account_id
       LEFT JOIN bank_transaction_original_data original ON original.bank_transaction_id=bt.id
       WHERE bt.id=? LIMIT 1`,
      [id]
    );
    if (!row) throw new FinanceError('Bank transaction not found.', 404, 'BANK_TRANSACTION_NOT_FOUND');
    return res.json({
      transaction_id: row.bank_transaction_id,
      account: { id: row.bank_account_id, name: row.account_name, institution: row.institution },
      source_type: row.source_type,
      source_statement_uid: row.statement_import_uid || null,
      source_statement_row_id: row.source_statement_row_id || null,
      original: row.original_description === null && row.original_payload_json === null ? null : {
        transaction_date: row.original_transaction_date,
        posting_date: row.original_posting_date,
        description: row.original_description,
        merchant_string: row.original_merchant_string,
        reference: row.original_reference,
        bank_category: row.original_bank_category,
        debit: row.original_debit,
        credit: row.original_credit,
        running_balance: row.original_running_balance,
        currency: row.original_currency,
        raw_payload: row.original_payload_json,
        captured_at: row.captured_at
      }
    });
  } catch (error) { return fail(res, error, 'Failed to load original bank transaction'); }
};

exports.reject = async (req, res) => {
  try {
    const reason = String(req.body.reason || '').trim();
    if (!reason) throw new FinanceError('A rejection reason is required.', 400, 'REJECTION_REASON_REQUIRED');
    const [[session]] = await pool.query('SELECT * FROM statement_import_sessions WHERE import_uid=?', [req.params.uid]);
    if (!session) throw new FinanceError('Statement review session not found.', 404, 'STATEMENT_REVIEW_NOT_FOUND');
    if (session.status !== 'PENDING_REVIEW') throw new FinanceError('Only pending statement reviews can be rejected.', 409, 'STATEMENT_REVIEW_LOCKED');
    await pool.query('UPDATE statement_import_sessions SET status="REJECTED", rejection_reason=?, reviewed_by=?, reviewed_at=NOW() WHERE id=?', [reason, req.user.id, session.id]);
    await logAudit(pool, audit(req, { action: 'STATEMENT_REVIEW_REJECTED', module: 'finance_intelligence', recordType: 'statement_import_session', recordId: session.import_uid, newValue: { reason } }));
    return res.json({ message: 'Statement review rejected. No transactions were imported.' });
  } catch (error) { return fail(res, error, 'Failed to reject statement review'); }
};
