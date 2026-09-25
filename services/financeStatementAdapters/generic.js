'use strict';

const { amountDirection, normaliseMoneyToken } = require('../financeStatementMoney');

const VERSION = 'generic-statement-v1';
const DATE_TOKEN = /\b(?:\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})\b/;
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

function parseLines(lines, options = {}) {
  const rows = [];
  for (const line of lines || []) {
    const text = String(line.text || '').replace(/\s+/g, ' ').trim();
    const dateMatch = text.match(DATE_TOKEN);
    if (!dateMatch) continue;
    const amounts = [...text.matchAll(MONEY_TOKEN)].map((match) => ({ raw: match[0].trim(), index: match.index || 0 }));
    if (!amounts.length) continue;
    const transactionAmount = amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[0];
    const balanceAmount = amounts.length >= 2 ? normaliseMoneyToken(amounts[amounts.length - 1].raw) : null;
    const direction = amountDirection(transactionAmount.raw, { signedAmountRule: options.signedAmountRule });
    const explicitDirection = /\b(?:CR|DR)\b|^[+\-(]/i.test(transactionAmount.raw.trim());
    const parsedDate = normaliseDate(dateMatch[0], options);
    const description = text.slice((dateMatch.index || 0) + dateMatch[0].length, transactionAmount.index).trim();
    const confidence = confidenceForLine(line);
    rows.push({
      transaction_date: parsedDate.value,
      description: description || null,
      debit: direction?.debit || '0.00',
      credit: direction?.credit || '0.00',
      running_balance: balanceAmount?.decimal || null,
      currency: options.currency || null,
      confidence_score: confidence,
      source_page: Number(line.page || 1),
      source_bbox: bboxForLine(line),
      source_snippet: text.slice(0, 1000),
      validation_hint: parsedDate.ambiguous
        ? `Ambiguous date ${dateMatch[0]}; choose a date format before approval`
        : (!explicitDirection && !options.allowUnsignedAmounts ? 'Transaction direction is not explicit in the source row' : (confidence < 0.72 ? 'Low OCR confidence requires review' : null)),
      force_rejected: parsedDate.ambiguous || (!explicitDirection && !options.allowUnsignedAmounts)
    });
  }
  return rows;
}

function match() { return 0.1; }

module.exports = { DATE_TOKEN, MONEY_TOKEN, VERSION, match, normaliseDate, parseLines };
