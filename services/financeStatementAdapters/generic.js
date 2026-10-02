'use strict';

const { amountDirection, normaliseMoneyToken } = require('../financeStatementMoney');

const VERSION = 'generic-statement-v2';
const DATE_TOKEN = /\b(?:\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}(?:\s+\d{2,4})?)\b/;
const MONEY_TOKEN = /(?:\b(?:AUD|USD|NZD|EUR|GBP|INR|JPY|CAD|SGD)\b\s*)?(?:CR|DR)?\s*[-+]?\(?[$€£¥₹]?\d[\d.,]*[.,]\d{2}\)?(?:\s*(?:CR|DR))?/gi;

function pad(number) { return String(number).padStart(2, '0'); }

function normaliseDate(input, options = {}) {
  const raw = String(input || '').trim();
  let match = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (match) return { value: `${match[1]}-${pad(match[2])}-${pad(match[3])}`, ambiguous: false };
  match = raw.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (match) {
    const first = Number(match[1]); const second = Number(match[2]);
    let year = Number(match[3]); if (year < 100) year += year >= 70 ? 1900 : 2000;
    const format = String(options.dateFormat || '').toUpperCase();
    if (!format && first <= 12 && second <= 12) return { value: null, ambiguous: true, raw };
    const day = format === 'MDY' ? second : first;
    const month = format === 'MDY' ? first : second;
    if (day < 1 || day > 31 || month < 1 || month > 12) return { value: null, ambiguous: false, raw };
    return { value: `${year}-${pad(month)}-${pad(day)}`, ambiguous: false };
  }
  match = raw.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})$/);
  if (match) {
    const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const month = months.indexOf(match[2].slice(0, 3).toLowerCase()) + 1;
    let year = Number(match[3]); if (year < 100) year += year >= 70 ? 1900 : 2000;
    if (month) return { value: `${year}-${pad(month)}-${pad(match[1])}`, ambiguous: false };
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
      if (year >= 1900 && year <= 2200) return { value: `${year}-${pad(month)}-${pad(match[1])}`, ambiguous: false };
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

function logicalTransactionLines(lines) {
  const source = Array.isArray(lines) ? lines : [];
  const logical = [];
  for (let index = 0; index < source.length; index += 1) {
    const line = source[index] || {};
    const text = String(line.text || '').replace(/\s+/g, ' ').trim();
    if (!DATE_TOKEN.test(text)) continue;
    let combined = text;
    const words = Array.isArray(line.words) ? [...line.words] : [];
    let end = index;
    let amountCount = [...combined.matchAll(MONEY_TOKEN)].length;
    while (amountCount < 2 && end + 1 < source.length && end - index < 3) {
      const next = source[end + 1] || {};
      const nextText = String(next.text || '').replace(/\s+/g, ' ').trim();
      if (!nextText || DATE_TOKEN.test(nextText)) break;
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
  for (const line of logicalTransactionLines(lines)) {
    const text = String(line.text || '').replace(/\s+/g, ' ').trim();
    const dateMatch = text.match(DATE_TOKEN);
    if (!dateMatch) continue;
    const amounts = [...text.matchAll(MONEY_TOKEN)].map((match) => ({ raw: match[0].trim(), index: match.index || 0 }));
    if (!amounts.length) continue;
    const parsedDate = normaliseDate(dateMatch[0], options);
    const afterDate = text.slice((dateMatch.index || 0) + dateMatch[0].length).trim();
    const markerText = afterDate.slice(0, amounts[0].index - ((dateMatch.index || 0) + dateMatch[0].length)).trim();
    const balanceMarker = /\b(?:OPENING|CLOSING)\s+BALANCE\b|\bBALANCE\s+(?:B\/F|C\/F|BROUGHT\s+FORWARD|CARRIED\s+FORWARD)\b/i.test(markerText);
    const transactionAmount = balanceMarker ? null : (amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[0]);
    const balanceAmount = balanceMarker
      ? normaliseMoneyToken(amounts[amounts.length - 1].raw)
      : (amounts.length >= 2 ? normaliseMoneyToken(amounts[amounts.length - 1].raw) : null);
    const explicitDirection = transactionAmount ? /\b(?:CR|DR)\b|^[+\-(]/i.test(transactionAmount.raw.trim()) : false;
    const direction = transactionAmount ? amountDirection(transactionAmount.raw, { signedAmountRule: options.signedAmountRule }) : null;
    const descriptionEnd = transactionAmount ? transactionAmount.index : amounts[0].index;
    const description = text.slice((dateMatch.index || 0) + dateMatch[0].length, descriptionEnd).trim();
    const confidence = confidenceForLine(line);
    const unsignedNeedsBalanceProof = Boolean(transactionAmount) && !explicitDirection && !options.allowUnsignedAmounts;
    const markerHint = balanceMarker ? 'Opening/closing balance marker retained only as balance context' : null;
    rows.push({
      transaction_date: parsedDate.value,
      description: description || null,
      debit: transactionAmount && (explicitDirection || options.allowUnsignedAmounts) ? (direction?.debit || '0.00') : '0.00',
      credit: transactionAmount && (explicitDirection || options.allowUnsignedAmounts) ? (direction?.credit || '0.00') : '0.00',
      running_balance: balanceAmount?.decimal || null,
      currency: options.currency || null,
      confidence_score: confidence,
      source_page: Number(line.page || 1),
      source_bbox: bboxForLine(line),
      source_snippet: text.slice(0, 1000),
      validation_hint: parsedDate.ambiguous
        ? `Ambiguous date ${dateMatch[0]}; verify statement period/date format`
        : (markerHint || (unsignedNeedsBalanceProof ? 'Transaction direction requires running-balance verification' : (confidence < 0.72 ? 'Low OCR confidence requires review' : null))),
      force_rejected: balanceMarker || parsedDate.ambiguous || unsignedNeedsBalanceProof,
      _unsigned_amount: unsignedNeedsBalanceProof ? transactionAmount.raw : null,
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

module.exports = { DATE_TOKEN, MONEY_TOKEN, VERSION, match, normaliseDate, parseLines, _test: { inferUnsignedBalanceDirections, logicalTransactionLines } };
