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
  const text = `${row?.description || ''} ${row?.merchant_name || ''}`.trim().toUpperCase().replace(/\s+/g, ' ');
  return /^(?:OPENING|CLOSING|CURRENT|AVAILABLE)\s+BALANCE\b/.test(text)
    || /^BALANCE\s+(?:BROUGHT|CARRIED)\s+FORWARD\b/.test(text)
    || /^BALANCE\s+(?:B\/F|C\/F)\b/.test(text);
}

module.exports = function statementPreviewSanitizer(req, res, next) {
  if (!Array.isArray(req.body?.rows)) return next();
  const kept = [];
  let skippedBalanceRows = 0;
  let unreadableDateRows = 0;

  req.body.rows.forEach((input, index) => {
    const row = { ...(input || {}) };
    if (isBalanceOnlyRow(row)) {
      skippedBalanceRows += 1;
      return;
    }
    const normalizedDate = normalizeStatementDate(row.transaction_date);
    if (!normalizedDate) {
      // Never fail the whole statement because one row is malformed. The finance
      // normalizer will persist this candidate as REJECTED for review/audit.
      row.transaction_date = null;
      row.validation_hint = 'Transaction date could not be read safely.';
      row.source_row_no = Number(row.source_row_no || index + 1);
      unreadableDateRows += 1;
    } else {
      row.transaction_date = normalizedDate;
    }
    const postingDate = normalizeStatementDate(row.posting_date);
    row.posting_date = postingDate || null;
    kept.push(row);
  });

  if (!kept.length) {
    return res.status(400).json({
      code: 'NO_TRANSACTION_CANDIDATES',
      message: 'Only statement balance markers were detected. No transaction rows were found, so nothing was imported. Retry after the PDF parser finishes extracting the transaction table.'
    });
  }

  req.body.rows = kept;
  req.statementPreviewSanitizer = { skipped_balance_rows: skippedBalanceRows, unreadable_date_rows: unreadableDateRows };
  return next();
};

module.exports.normalizeStatementDate = normalizeStatementDate;
module.exports.isBalanceOnlyRow = isBalanceOnlyRow;
