'use strict';

const MONTHS = new Map([
  ['jan', '01'], ['feb', '02'], ['mar', '03'], ['apr', '04'], ['may', '05'], ['jun', '06'],
  ['jul', '07'], ['aug', '08'], ['sep', '09'], ['oct', '10'], ['nov', '11'], ['dec', '12']
]);

function isoDate(year, month, day) {
  const y = Number(year); const m = Number(month); const d = Number(day);
  if (!Number.isInteger(y) || y < 1900 || y > 2200 || !Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(d) || d < 1 || d > 31) return null;
  const value = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return value;
}

function normalizeStatementDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return isoDate(match[1], match[2], match[3]);
  match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (match) {
    const year = match[3].length === 2 ? Number(match[3]) + (Number(match[3]) >= 70 ? 1900 : 2000) : Number(match[3]);
    return isoDate(year, match[2], match[1]);
  }
  match = text.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})$/);
  if (match) {
    const month = MONTHS.get(match[2].slice(0, 3).toLowerCase());
    const year = match[3].length === 2 ? Number(match[3]) + (Number(match[3]) >= 70 ? 1900 : 2000) : Number(match[3]);
    if (month) return isoDate(year, month, match[1]);
  }
  return null;
}

function isBalanceOnlyRow(row) {
  const text = `${row?.description || ''} ${row?.merchant_name || ''}`.trim().toUpperCase();
  return /\b(OPENING|CLOSING|BROUGHT\s+FORWARD|CARRIED\s+FORWARD|BALANCE\s+B\/F|BALANCE\s+C\/F)\b/.test(text) && /BALANCE|OPENING|CLOSING/.test(text);
}

module.exports = function statementPreviewSanitizer(req, res, next) {
  if (!Array.isArray(req.body?.rows)) return next();
  const kept = [];
  let skippedBalanceRows = 0;
  const undatedRows = [];

  req.body.rows.forEach((input, index) => {
    const row = { ...(input || {}) };
    const normalizedDate = normalizeStatementDate(row.transaction_date);
    if (!normalizedDate) {
      if (isBalanceOnlyRow(row)) {
        skippedBalanceRows += 1;
        return;
      }
      undatedRows.push(index + 1);
      return;
    }
    row.transaction_date = normalizedDate;
    const postingDate = normalizeStatementDate(row.posting_date);
    row.posting_date = postingDate || null;
    kept.push(row);
  });

  if (undatedRows.length) {
    return res.status(400).json({
      code: 'STATEMENT_DATES_UNREADABLE',
      message: `Could not safely read the transaction date for ${undatedRows.length} row(s). No data was imported. Try CSV, OFX or QFX from your bank, or use a clearer text-based PDF.`,
      issues: undatedRows.slice(0, 20).map((rowNo) => ({ row_no: rowNo, message: 'Transaction date could not be read safely.' }))
    });
  }

  if (!kept.length) {
    return res.status(400).json({
      code: 'NO_DATED_TRANSACTIONS',
      message: 'No dated transactions were found in this statement. No data was imported. Try CSV, OFX or QFX from your bank.'
    });
  }

  req.body.rows = kept;
  req.statementPreviewSanitizer = { skipped_balance_rows: skippedBalanceRows };
  return next();
};

module.exports.normalizeStatementDate = normalizeStatementDate;
module.exports.isBalanceOnlyRow = isBalanceOnlyRow;
