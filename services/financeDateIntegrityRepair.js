'use strict';

const crypto = require('node:crypto');
const pool = require('../config/db');
const money = require('../utils/money');
const { dateOnly } = require('./financeDomain');
const { ensureFinanceSchema } = require('./financeSchema');

const LEGACY_PDF_TARGETS = new Map([
  ['78E48FF9-3DDC-4694-831B-0EA413C21513.pdf', { expectedMinYear: 2024, expectedMaxYear: 2031, shiftYears: 7 }],
  ['7AB548AC-523C-40B0-954A-16930800F4D1.pdf', { expectedMinYear: 2023, expectedMaxYear: 2030, shiftYears: 7 }]
]);

function shiftIsoYear(value, years) {
  const raw = dateOnly(value);
  if (!raw) return null;
  const [year, month, day] = raw.split('-').map(Number);
  const candidate = `${year - Number(years || 0)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(`${candidate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate) return null;
  return candidate;
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

function planLegacyPdfYearRepair({ originalName, minDate, maxDate, today = new Date().toISOString().slice(0, 10) }) {
  const target = LEGACY_PDF_TARGETS.get(String(originalName || ''));
  if (!target) return { eligible: false, reason: 'not-targeted' };
  const min = dateOnly(minDate);
  const max = dateOnly(maxDate);
  const current = dateOnly(today);
  if (!min || !max || !current) return { eligible: false, reason: 'missing-date-range' };
  if (max <= current) return { eligible: false, reason: 'already-plausible' };

  const minYear = Number(min.slice(0, 4));
  const maxYear = Number(max.slice(0, 4));
  if (minYear !== target.expectedMinYear || maxYear !== target.expectedMaxYear) {
    return { eligible: false, reason: 'range-does-not-match-known-parser-runaway', minYear, maxYear };
  }

  const correctedMin = shiftIsoYear(min, target.shiftYears);
  const correctedMax = shiftIsoYear(max, target.shiftYears);
  if (!correctedMin || !correctedMax || correctedMax > current || correctedMin > correctedMax) {
    return { eligible: false, reason: 'corrected-range-not-plausible' };
  }

  return {
    eligible: true,
    shiftYears: target.shiftYears,
    correctedMin,
    correctedMax,
    originalMin: min,
    originalMax: max
  };
}

async function repairOneStatement(file) {
  if (file.parser_version && file.parser_version !== 'PDF_TABLE_V4_BALANCE_DELTA') {
    return { repaired: false, reason: 'parser-version-not-targeted', original_name: file.original_name };
  }
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();

    const [rows] = await db.query(
      `SELECT bt.id,bt.bank_account_id,bt.statement_import_uid,bt.statement_row_id,
              bt.transaction_date,bt.posting_date,bt.description,bt.reference,bt.debit,bt.credit,
              bt.running_balance,bt.row_hash,sir.row_no
         FROM bank_transactions bt
         LEFT JOIN statement_import_rows sir ON sir.id=bt.statement_row_id
        WHERE bt.statement_import_uid=? AND bt.bank_account_id=?
        ORDER BY COALESCE(sir.row_no,2147483647),bt.id
        FOR UPDATE`,
      [file.import_uid, file.bank_account_id]
    );
    if (!rows.length) {
      await db.rollback();
      return { repaired: false, reason: 'no-linked-transactions', original_name: file.original_name };
    }

    const dates = rows.map((row) => dateOnly(row.transaction_date)).filter(Boolean).sort();
    const plan = planLegacyPdfYearRepair({
      originalName: file.original_name,
      minDate: dates[0],
      maxDate: dates[dates.length - 1]
    });
    if (!plan.eligible) {
      await db.rollback();
      return { repaired: false, reason: plan.reason, original_name: file.original_name, min: dates[0], max: dates[dates.length - 1] };
    }

    const updates = rows.map((row) => {
      const transactionDate = shiftIsoYear(row.transaction_date, plan.shiftYears);
      const postingDate = row.posting_date ? shiftIsoYear(row.posting_date, plan.shiftYears) : null;
      if (!transactionDate) {
        const error = new Error(`Unable to shift legacy PDF date for transaction ${row.id}`);
        error.code = 'FINANCE_DATE_REPAIR_INVALID_DATE';
        throw error;
      }
      const newHash = statementRowHash(row.bank_account_id, { ...row, transaction_date: transactionDate });
      return { row, transactionDate, postingDate: postingDate || transactionDate, newHash };
    });

    const hashes = [...new Set(updates.map((item) => item.newHash))];
    for (let offset = 0; offset < hashes.length; offset += 400) {
      const chunk = hashes.slice(offset, offset + 400);
      const placeholders = chunk.map(() => '?').join(',');
      const [collisions] = await db.query(
        `SELECT id,row_hash,statement_import_uid
           FROM bank_transactions
          WHERE bank_account_id=? AND row_hash IN (${placeholders}) AND statement_import_uid<>?`,
        [file.bank_account_id, ...chunk, file.import_uid]
      );
      if (collisions.length) {
        const error = new Error(`Date repair would collide with ${collisions.length} existing transaction(s)`);
        error.code = 'FINANCE_DATE_REPAIR_DUPLICATE_COLLISION';
        throw error;
      }
    }

    const repairNote = 'Legacy PDF year-seed parser error repaired automatically; original staged payload remains preserved for audit.';
    for (const item of updates) {
      await db.query(
        'UPDATE bank_transactions SET transaction_date=?,posting_date=?,row_hash=? WHERE id=?',
        [item.transactionDate, item.postingDate, item.newHash, item.row.id]
      );
      if (item.row.statement_row_id) {
        await db.query(
          `UPDATE statement_import_rows
              SET transaction_date=?,posting_date=?,row_hash=?,
                  validation_message=LEFT(CONCAT_WS('; ',NULLIF(validation_message,''),?),500)
            WHERE id=?`,
          [item.transactionDate, item.postingDate, item.newHash, repairNote, item.row.statement_row_id]
        );
      }
    }

    const correctedDates = updates.map((item) => item.transactionDate).sort();
    const correctedMin = correctedDates[0];
    const correctedMax = correctedDates[correctedDates.length - 1];

    await db.query(
      'UPDATE statement_import_files SET statement_start_date=?,statement_end_date=? WHERE import_uid=? AND bank_account_id=?',
      [correctedMin, correctedMax, file.import_uid, file.bank_account_id]
    );
    await db.query(
      'UPDATE statement_import_sessions SET statement_start_date=?,statement_end_date=? WHERE import_uid=? AND bank_account_id=?',
      [correctedMin, correctedMax, file.import_uid, file.bank_account_id]
    );

    const [[coverage]] = await db.query(
      `SELECT MIN(transaction_date) AS min_date,MAX(transaction_date) AS max_date
         FROM bank_transactions
        WHERE bank_account_id=? AND archived_at IS NULL AND reconciliation_status<>'IGNORED'`,
      [file.bank_account_id]
    );
    await db.query(
      'UPDATE bank_accounts SET history_start_date=?,history_end_date=? WHERE id=?',
      [coverage?.min_date || null, coverage?.max_date || null, file.bank_account_id]
    );

    await db.commit();
    return {
      repaired: true,
      original_name: file.original_name,
      import_uid: file.import_uid,
      bank_account_id: file.bank_account_id,
      transactions: updates.length,
      shift_years: plan.shiftYears,
      before: { start: plan.originalMin, end: plan.originalMax },
      after: { start: correctedMin, end: correctedMax }
    };
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    db.release();
  }
}

async function repairKnownLegacyPdfDateRunaway() {
  await ensureFinanceSchema();
  const names = [...LEGACY_PDF_TARGETS.keys()];
  const placeholders = names.map(() => '?').join(',');
  const [files] = await pool.query(
    `SELECT sif.import_uid,sif.bank_account_id,sif.original_name,sif.source_format,sif.statement_start_date,sif.statement_end_date,sif.reviewed_at,
            sis.parser_version
       FROM statement_import_files sif
       LEFT JOIN statement_import_sessions sis ON sis.import_uid=sif.import_uid AND sis.bank_account_id=sif.bank_account_id
      WHERE sif.parse_status='IMPORTED' AND UPPER(sif.source_format)='PDF' AND sif.original_name IN (${placeholders})`,
    names
  );

  const results = [];
  for (const file of files) {
    const result = await repairOneStatement(file);
    results.push(result);
    if (result.repaired) {
      console.log(
        `FINANCE_DATE_INTEGRITY_REPAIR_OK file=${result.original_name} rows=${result.transactions} shift_years=${result.shift_years} before=${result.before.start}..${result.before.end} after=${result.after.start}..${result.after.end}`
      );
    } else {
      console.log(
        `FINANCE_DATE_INTEGRITY_REPAIR_SKIPPED file=${result.original_name} reason=${result.reason} range=${result.min || ''}..${result.max || ''}`
      );
    }
  }
  return { checked: files.length, repaired: results.filter((item) => item.repaired).length, results };
}

module.exports = {
  LEGACY_PDF_TARGETS,
  shiftIsoYear,
  planLegacyPdfYearRepair,
  repairKnownLegacyPdfDateRunaway
};
