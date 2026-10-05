'use strict';

const { amountDirection, normaliseMoneyToken } = require('../financeStatementMoney');
const { isTableHeaderLine, createAmountColumnResolver } = require('../financeStatementColumns');

const VERSION = 'generic-statement-v3';
const DATE_TOKEN = /\b(?:\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}(?:\s+\d{2,4})?)\b/;
const MONEY_TOKEN = /(?:\b(?:AUD|USD|NZD|EUR|GBP|INR|JPY|CAD|SGD)\b\s*)?(?:CR|DR)?\s*[-+]?\(?[$€£¥₹]?\d[\d.,]*[.,]\d{2}\)?(?:\s*(?:CR|DR))?/gi;

function pad(number) { return String(number).padStart(2, '0'); }
function checkedDate(year, month, day, raw) {
  const y = Number(year), m = Number(month), d = Number(day);
  const actual = new Date(Date.UTC(y, m - 1, d));
  if (y < 1900 || y > 2200 || actual.getUTCFullYear() !== y || actual.getUTCMonth() !== m - 1 || actual.getUTCDate() !== d) return { value: null, ambiguous: false, raw };
  return { value: `${y}-${pad(m)}-${pad(d)}`, ambiguous: false };
}

function normaliseDate(input, options = {}) {
  const raw = String(input || '').trim();
  let match = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (match) return checkedDate(match[1], match[2], match[3], raw);
  match = raw.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (match) {
    const first = Number(match[1]); const second = Number(match[2]);
    let year = Number(match[3]); if (year < 100) year += year >= 70 ? 1900 : 2000;
    const format = String(options.dateFormat || '').toUpperCase();
    if (!format && first <= 12 && second <= 12) return { value: null, ambiguous: true, raw };
    const day = format === 'MDY' ? second : first;
    const month = format === 'MDY' ? first : second;
    if (day < 1 || day > 31 || month < 1 || month > 12) return { value: null, ambiguous: false, raw };
    return checkedDate(year, month, day, raw);
  }
  match = raw.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})$/);
  if (match) {
    const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const month = months.indexOf(match[2].slice(0, 3).toLowerCase()) + 1;
    let year = Number(match[3]); if (year < 100) year += year >= 70 ? 1900 : 2000;
    if (month) return checkedDate(year, month, match[1], raw);
  }
  match = raw.match(/^(\d{1,2})\s+([A-Za-z]{3,9})$/);
  if (match) {
    const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const month = months.indexOf(match[2].slice(0, 3).toLowerCase()) + 1;
    if (month) {
      const start = String(options.statementStartDate || '');
      const end = String(options.statementEndDate || '');
      let year = Number(options.defaultYear || 0);
      if (/^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
        const startYear = Number(start.slice(0,4)), endYear = Number(end.slice(0,4));
        const startMonth = Number(start.slice(5,7));
        year = startYear === endYear ? startYear : (month >= startMonth ? startYear : endYear);
      }
      if (year >= 1900 && year <= 2200) return checkedDate(year, month, match[1], raw);
      return { value: null, ambiguous: true, raw };
    }
  }
  return { value: null, ambiguous: false, raw };
}

function bboxForLine(line) {
  const words = Array.isArray(line.words) ? line.words : [];
  if (!words.length) return null;
  const left = Math.min(...words.map((word) => Number(word.x || word.left || 0)));
  const top = Math.min(...words.map((word) => Number(word.y || word.top || 0)));
  const right = Math.max(...words.map((word) => Number(word.x || word.left || 0) + Number(word.width || 0)));
  const bottom = Math.max(...words.map((word) => Number(word.y || word.top || 0) + Number(word.height || 0)));
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function confidenceForLine(line) {
  const values = (line.words || []).map((word) => Number(word.confidence)).filter(Number.isFinite);
  return values.length ? Math.max(0, Math.min(1, values.reduce((sum, value) => sum + value, 0) / values.length / 100)) : 1;
}

function isStatementSummaryLine(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (/^(?:page\s+\d+\s+of\s+\d+|(?:page\s+)?(?:sub)?totals?\s*(?=[:$€£₹\d]|(?:withdrawals?|deposits?|debits?|credits?|paid|money|transactions?)\b)|balance\s+(?:as\s+(?:of|at)|b\/f|c\/f|brought\s+forward|carried\s+forward)\b|(?:available|current|ledger|account)\s+balance\b|continued\s+on\b|transaction\s+report\s+generated\b)/i.test(text)) return true;
  const dateMatch = text.match(DATE_TOKEN);
  if (!dateMatch) return false;
  const afterDate = text.slice((dateMatch.index || 0) + dateMatch[0].length).trim();
  return /^(?:(?:page\s+)?(?:sub)?total(?:s)?|total\s+(?:debits?|withdrawals?|credits?|deposits?|payments?|transactions?))(?:\s+(?:debits?|withdrawals?|credits?|deposits?|payments?|transactions?))?\s*(?=(?:AUD|USD|NZD|EUR|GBP|INR|JPY|CAD|SGD)?\s*[-+($€£¥\d])/i.test(afterDate);
}

function logicalTransactionLines(lines) {
  const source = Array.isArray(lines) ? lines : [];
  const logical = [];
  const hasTableHeader = source.some(isTableHeaderLine);
  let insideTable = !hasTableHeader;
  for (let index = 0; index < source.length; index += 1) {
    const line = source[index] || {};
    const text = String(line.text || '').replace(/\s+/g, ' ').trim();
    if (isTableHeaderLine(line)) { insideTable = true; continue; }
    const date = text.match(DATE_TOKEN);
    if (!insideTable || !date || date.index !== 0 || isStatementSummaryLine(text)) continue;
    if (/^\s*(?:to|through|[-–—])\s+\d/i.test(text.slice(date[0].length))) continue;
    let combined = text;
    const words = Array.isArray(line.words) ? [...line.words] : [];
    let end = index;
    let amountCount = [...combined.matchAll(MONEY_TOKEN)].length;
    while (end + 1 < source.length && end - index < 6) {
      const next = source[end + 1] || {};
      const nextText = String(next.text || '').replace(/\s+/g, ' ').trim();
      if (!nextText || Number(next.page || 1) !== Number(line.page || 1) || DATE_TOKEN.test(nextText) || isStatementSummaryLine(nextText) || isTableHeaderLine(next) || /^(?:statement|account\s+(?:no|number|name)|branch\s+number|please\s+check|date\b|[A-Z]{3}\s+\d{4}\b)/i.test(nextText)) break;
      if (amountCount >= 2 && [...nextText.matchAll(MONEY_TOKEN)].length) break;
      if (/^blank$/i.test(nextText)) { end += 1; continue; }
      combined += ' ' + nextText;
      if (Array.isArray(next.words)) words.push(...next.words);
      end += 1;
      amountCount = [...combined.matchAll(MONEY_TOKEN)].length;
    }
    logical.push({ ...line, text: combined, words });
    index = end;
  }
  return logical;
}

function inferUnsignedBalanceDirections(rows) {
  const values = Array.isArray(rows) ? rows : [];
  let order = null;
  for (let index = 0; index + 1 < values.length; index += 1) {
    const left = String(values[index]?.transaction_date || '');
    const right = String(values[index + 1]?.transaction_date || '');
    if (!left || !right || left === right) continue;
    order = left < right ? 'ASC' : 'DESC';
    break;
  }
  if (!order) return values;

  for (let index = 0; index < values.length; index += 1) {
    const row = values[index];
    if (!row?._unsigned_amount || row.running_balance === null || row.running_balance === undefined) continue;
    const neighbourIndex = order === 'ASC' ? index - 1 : index + 1;
    if (neighbourIndex < 0 || neighbourIndex >= values.length) continue;
    const neighbour = values[neighbourIndex];
    if (neighbour?.running_balance === null || neighbour?.running_balance === undefined) continue;
    const amount = normaliseMoneyToken(row._unsigned_amount);
    const currentBalance = normaliseMoneyToken(row.running_balance);
    const previousBalance = normaliseMoneyToken(neighbour.running_balance);
    if (!amount || !currentBalance || !previousBalance) continue;
    const absolute = amount.cents < 0n ? -amount.cents : amount.cents;
    const delta = currentBalance.cents - previousBalance.cents;
    const absoluteDelta = delta < 0n ? -delta : delta;
    if (absolute === 0n || absoluteDelta !== absolute) continue;

    const inferred = amountDirection(row._unsigned_amount, { direction: delta < 0n ? 'DEBIT' : 'CREDIT' });
    row.debit = inferred?.debit || '0.00';
    row.credit = inferred?.credit || '0.00';
    row.force_rejected = Boolean(row._date_ambiguous);
    const notes = [];
    if (row._date_ambiguous) notes.push(row.validation_hint);
    notes.push('Debit/credit direction verified from the source running-balance movement');
    if (Number(row.confidence_score || 1) < 0.72) notes.push('Low OCR confidence requires review');
    row.validation_hint = notes.filter(Boolean).join('; ');
  }
  return values;
}

function parseLines(lines, options = {}) {
  const rows = [];
  const resolveColumns = createAmountColumnResolver(lines);
  for (const line of logicalTransactionLines(lines)) {
    const text = String(line.text || '').replace(/\s+/g, ' ').trim();
    const dateMatch = text.match(DATE_TOKEN);
    if (!dateMatch) continue;
    const amounts = [...text.matchAll(MONEY_TOKEN)].map((match) => ({ raw: match[0].trim(), index: (match.index || 0) + match[0].length - match[0].trimStart().length }));
    if (!amounts.length) continue;
    const parsedDate = normaliseDate(dateMatch[0], options);
    const dateEnd = (dateMatch.index || 0) + dateMatch[0].length;
    const markerText = text.slice(dateEnd, amounts[0].index).trim();
    const balanceMarker = /\b(?:OPENING|CLOSING)\s+BALANCE\b|\bBALANCE\s+(?:B\/F|C\/F|BROUGHT\s+FORWARD|CARRIED\s+FORWARD)\b/i.test(markerText);
    const columns = resolveColumns({ line, amounts });
    const positiveColumns = ['debit','credit','amount'].filter(key => columns?.[key] && (normaliseMoneyToken(columns[key].raw)?.cents || 0n) !== 0n);
    const ambiguousColumns = Boolean(columns?.ambiguous || positiveColumns.length > 1);
    const transactionAmount = balanceMarker || ambiguousColumns ? null : positiveColumns.length === 1 ? columns[positiveColumns[0]] : (amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[0]);
    const balanceAmount = columns?.balance ? normaliseMoneyToken(columns.balance.raw) : balanceMarker
      ? normaliseMoneyToken(amounts[amounts.length - 1].raw)
      : (amounts.length >= 2 ? normaliseMoneyToken(amounts[amounts.length - 1].raw) : null);
    const explicitDirection = transactionAmount ? /\b(?:CR|DR)\b|^[+\-(]/i.test(transactionAmount.raw.trim()) : false;
    const columnAmounts = ['debit','credit','amount'].map(key => columns?.[key]).filter(Boolean);
    const descriptionEnd = columnAmounts.length ? Math.min(...columnAmounts.map(amount => amount.index)) : transactionAmount ? transactionAmount.index : amounts[0].index;
    const description = text.slice((dateMatch.index || 0) + dateMatch[0].length, descriptionEnd).trim();
    const confidence = confidenceForLine(line);
    const unsignedNeedsBalanceProof = Boolean(transactionAmount) && !explicitDirection && !options.allowUnsignedAmounts;
    let inferredDirection = null;
    if (!ambiguousColumns && positiveColumns.length === 1 && positiveColumns[0] !== 'amount') inferredDirection = positiveColumns[0] === 'debit' ? 'DEBIT' : 'CREDIT';
    if (!inferredDirection && unsignedNeedsBalanceProof && typeof options.inferUnsignedDirection === 'function') {
      try {
        inferredDirection = options.inferUnsignedDirection({
          line, text, amountIndex: transactionAmount.index,
          amountLength: transactionAmount.raw.length, amountCount: amounts.length
        });
      } catch { inferredDirection = null; }
    }
    if (!['DEBIT', 'CREDIT'].includes(inferredDirection)) inferredDirection = null;
    const direction = transactionAmount ? amountDirection(transactionAmount.raw, {
      signedAmountRule: options.signedAmountRule,
      direction: inferredDirection || undefined
    }) : null;
    const directionResolved = explicitDirection || options.allowUnsignedAmounts || Boolean(inferredDirection);
    const markerHint = balanceMarker ? 'Opening/closing balance marker retained only as balance context' : null;
    rows.push({
      transaction_date: parsedDate.value,
      description: description || null,
      debit: transactionAmount && directionResolved ? (direction?.debit || '0.00') : '0.00',
      credit: transactionAmount && directionResolved ? (direction?.credit || '0.00') : '0.00',
      running_balance: balanceAmount?.decimal || null,
      currency: options.currency || null,
      confidence_score: confidence,
      source_page: Number(line.page || 1),
      source_bbox: bboxForLine(line),
      source_snippet: text.slice(0, 1000),
      validation_hint: parsedDate.ambiguous
        ? `Ambiguous date ${dateMatch[0]}; verify statement period/date format`
        : (ambiguousColumns ? 'Multiple values occupy debit/credit columns; verify the original row' : markerHint || (unsignedNeedsBalanceProof && !inferredDirection ? 'Transaction direction requires running-balance verification' : (confidence < 0.72 ? 'Low OCR confidence requires review' : null))),
      force_rejected: ambiguousColumns || balanceMarker || parsedDate.ambiguous || (unsignedNeedsBalanceProof && !inferredDirection),
      _unsigned_amount: unsignedNeedsBalanceProof && !inferredDirection ? transactionAmount.raw : null,
      _date_ambiguous: parsedDate.ambiguous
    });
  }
  inferUnsignedBalanceDirections(rows);
  return rows.map((row) => {
    const { _unsigned_amount, _date_ambiguous, ...clean } = row;
    return clean;
  });
}

function match() { return 0.1; }

module.exports = { DATE_TOKEN, MONEY_TOKEN, VERSION, match, normaliseDate, parseLines, _test: { inferUnsignedBalanceDirections, isStatementSummaryLine, logicalTransactionLines } };
