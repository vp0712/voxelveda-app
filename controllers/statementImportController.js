const crypto = require('node:crypto');
const pool = require('../config/db');
const money = require('../utils/money');
const { ensureFinanceSchema } = require('../services/financeSchema');
const { logAudit } = require('../services/auditService');
const { FinanceError, dateOnly } = require('../services/financeDomain');

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
    try { runningBalance = money.fromCents(money.toCents(row.running_balance)); } catch { validationStatus = 'WARNING'; messages.push('Running balance could not be parsed'); }
  }
  const currency = String(row.currency || accountCurrency || 'AUD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) { validationStatus = 'REJECTED'; messages.push('Invalid currency code'); }
  if (!String(row.description || row.merchant_name || '').trim()) {
    if (validationStatus === 'VALID') validationStatus = 'WARNING';
    messages.push('No transaction description');
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
    category: String(row.category || '').trim().slice(0, 120) || null,
    currency,
    validation_status: validationStatus,
    validation_message: messages.join('; ').slice(0, 500) || null,
    selected: validationStatus === 'REJECTED' ? 0 : 1,
    row_hash: transactionDate ? statementRowHash(accountId, { ...row, transaction_date: transactionDate, debit, credit, running_balance: runningBalance }) : null
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
  const counts = freshRows.reduce((acc, row) => {
    if (row.validation_status === 'VALID') acc.valid += 1;
    else if (row.validation_status === 'WARNING') acc.warning += 1;
    else if (row.validation_status === 'DUPLICATE') acc.duplicate += 1;
    else acc.rejected += 1;
    return acc;
  }, { valid: 0, warning: 0, duplicate: 0, rejected: 0 });
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
    const [[account]] = await db.query('SELECT * FROM bank_accounts WHERE id=? AND status="ACTIVE" FOR UPDATE', [accountId]);
    if (!account) throw new FinanceError('Active financial account not found.', 404, 'BANK_ACCOUNT_NOT_FOUND');
    const [[alreadyImported]] = await db.query('SELECT import_uid FROM statement_import_files WHERE bank_account_id=? AND content_hash=? LIMIT 1', [accountId, fileHash]);
    if (alreadyImported) throw new FinanceError(`This statement was already committed as ${alreadyImported.import_uid}.`, 409, 'DUPLICATE_STATEMENT_FILE');
    const [[existingSession]] = await db.query('SELECT * FROM statement_import_sessions WHERE bank_account_id=? AND content_hash=? ORDER BY id DESC LIMIT 1', [accountId, fileHash]);
    if (existingSession && existingSession.status === 'PENDING_REVIEW') {
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

    const normalized = rows.map((row, index) => normalizeRow(accountId, account.currency, row, index + 1));
    const hashes = normalized.map((row) => row.row_hash).filter(Boolean);
    const duplicateHashes = new Set();
    if (hashes.length) {
      const chunkSize = 500;
      for (let offset = 0; offset < hashes.length; offset += chunkSize) {
        const chunk = hashes.slice(offset, offset + chunkSize);
        const placeholders = chunk.map(() => '?').join(',');
        const [existing] = await db.query(`SELECT row_hash FROM bank_transactions WHERE bank_account_id=? AND row_hash IN (${placeholders})`, [accountId, ...chunk]);
        existing.forEach((row) => duplicateHashes.add(row.row_hash));
      }
    }
    const seenInFile = new Set();
    for (const row of normalized) {
      if (!row.row_hash || row.validation_status === 'REJECTED') continue;
      if (duplicateHashes.has(row.row_hash) || seenInFile.has(row.row_hash)) {
        row.validation_status = 'DUPLICATE';
        row.validation_message = row.validation_message ? `${row.validation_message}; Duplicate transaction` : 'Duplicate transaction';
        row.selected = 0;
      }
      seenInFile.add(row.row_hash);
    }

    const counts = normalized.reduce((acc, row) => {
      if (row.validation_status === 'VALID') acc.valid += 1;
      else if (row.validation_status === 'WARNING') acc.warning += 1;
      else if (row.validation_status === 'DUPLICATE') acc.duplicate += 1;
      else acc.rejected += 1;
      return acc;
    }, { valid: 0, warning: 0, duplicate: 0, rejected: 0 });
    const dates = normalized.filter((row) => row.validation_status !== 'REJECTED').map((row) => row.transaction_date).filter(Boolean).sort();
    const importUid = uid('REVIEW');
    const [session] = await db.query(
      `INSERT INTO statement_import_sessions
       (import_uid, bank_account_id, source_format, original_name, content_hash, statement_start_date, statement_end_date,
        opening_balance, closing_balance, total_rows, valid_rows, warning_rows, duplicate_rows, rejected_rows, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [importUid, accountId, sourceFormat, String(req.body.original_name || `statement.${sourceFormat.toLowerCase()}`).slice(0, 255), fileHash,
        dateOnly(req.body.statement_start_date) || dates[0] || null, dateOnly(req.body.statement_end_date) || dates[dates.length - 1] || null,
        req.body.opening_balance ?? null, req.body.closing_balance ?? null, normalized.length, counts.valid, counts.warning, counts.duplicate, counts.rejected, req.user.id]
    );
    for (const row of normalized) {
      await db.query(
        `INSERT INTO statement_import_rows
         (import_session_id, row_no, transaction_date, posting_date, description, reference, debit, credit, running_balance,
          merchant_name, category, currency, row_hash, validation_status, validation_message, selected)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [session.insertId, row.row_no, row.transaction_date, row.posting_date, row.description, row.reference, row.debit, row.credit,
          row.running_balance, row.merchant_name, row.category, row.currency, row.row_hash, row.validation_status, row.validation_message, row.selected]
      );
    }
    await logAudit(db, audit(req, { action: 'STATEMENT_PREVIEW_CREATED', module: 'finance_intelligence', recordType: 'statement_import_session', recordId: importUid, newValue: { bank_account_id: accountId, source_format: sourceFormat, total_rows: normalized.length, ...counts } }));
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
      await logAudit(db, audit(req, { action: 'STATEMENT_REVIEW_NO_IMPORTABLE_ROWS', module: 'finance_intelligence', recordType: 'statement_import_session', recordId: session.import_uid, newValue: { repaired_balance_markers: repaired.repaired } }));
      await db.commit();
      return res.status(422).json({
        message: repaired.repaired
          ? `This review contained ${repaired.repaired} opening/closing balance marker row(s), not transactions. They have now been safely excluded. No real transaction rows are available to import. Please use CSV, OFX or QFX from your bank, or a transaction-detail PDF with explicit debit/credit direction.`
          : 'No real transaction rows are selected for import. Select at least one valid transaction, or use CSV, OFX or QFX if this PDF does not expose transaction detail safely.',
        code: 'NO_IMPORTABLE_TRANSACTIONS',
        review_repaired: true,
        repaired_rows: repaired.repaired
      });
    }

    const batchUid = uid('BANK');
    let imported = 0;
    let duplicates = 0;
    const rows = selectedRows;
    const dates = rows.map((row) => String(row.transaction_date || '').slice(0, 10)).filter(Boolean).sort();
    const minDate = dates[0] || null;
    const maxDate = dates[dates.length - 1] || null;
    const chunkSize = 400;

    for (let offset = 0; offset < rows.length; offset += chunkSize) {
      const chunk = rows.slice(offset, offset + chunkSize);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'STATEMENT_IMPORT\', ?, ?, ?, ?, ?, ?, ?)').join(',');
      const params = [];
      for (const row of chunk) {
        params.push(
          account.id, batchUid, row.row_hash, row.transaction_date, row.posting_date, row.description, row.reference,
          row.debit, row.credit, row.running_balance, session.source_format, row.merchant_name, row.currency || account.currency,
          account.ownership_scope, row.category, row.category ? 'CLASSIFIED' : 'UNCLASSIFIED', req.user.id
        );
      }
      const [insert] = await db.query(
        `INSERT IGNORE INTO bank_transactions
         (bank_account_id, import_batch_uid, row_hash, transaction_date, posting_date, description, reference,
          debit, credit, running_balance, source_type, source_provider, merchant_name, currency, ownership_scope,
          category, classification_status, imported_by) VALUES ${placeholders}`,
        params
      );
      const inserted = Number(insert.affectedRows || 0);
      imported += inserted;
      duplicates += Math.max(0, chunk.length - inserted);
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
        imported, Number(repaired.session?.duplicate_rows || session.duplicate_rows || 0) + duplicates, Number(repaired.session?.rejected_rows || session.rejected_rows || 0), session.created_by, req.user.id]
    );
    await db.query(
      'UPDATE statement_import_sessions SET status="IMPORTED", reviewed_by=?, reviewed_at=NOW(), committed_by=?, committed_at=NOW() WHERE id=?',
      [req.user.id, req.user.id, session.id]
    );
    if (minDate || maxDate) {
      await db.query(
        `UPDATE bank_accounts SET
          history_start_date=CASE WHEN history_start_date IS NULL OR ? < history_start_date THEN ? ELSE history_start_date END,
          history_end_date=CASE WHEN history_end_date IS NULL OR ? > history_end_date THEN ? ELSE history_end_date END
         WHERE id=?`, [minDate, minDate, maxDate, maxDate, account.id]
      );
    }
    await logAudit(db, audit(req, { action: 'STATEMENT_REVIEW_COMMITTED', module: 'finance_intelligence', recordType: 'statement_import_session', recordId: session.import_uid, newValue: { imported, duplicates, repaired_balance_markers: repaired.repaired, batch_uid: batchUid } }));
    await db.commit();
    return res.json({
      message: `${imported} statement transactions committed after review.${repaired.repaired ? ` ${repaired.repaired} stale balance marker row(s) were safely excluded.` : ''}`,
      imported,
      duplicates,
      excluded_balance_markers: repaired.repaired,
      batch_uid: batchUid,
      coverage: { start: minDate, end: maxDate }
    });
  } catch (error) {
    if (db) await db.rollback();
    return fail(res, error, 'Failed to commit statement review');
  } finally { if (db) db.release(); }
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