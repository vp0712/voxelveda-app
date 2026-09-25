'use strict';

const money = require('../utils/money');

function normaliseMoneyToken(input) {
  let value = String(input ?? '').trim();
  if (!value) return null;
  const negativeByParens = /^\(.*\)$/.test(value);
  const direction = /\bDR\b/i.test(value) ? 'DEBIT' : /\bCR\b/i.test(value) ? 'CREDIT' : null;
  value = value.replace(/[()]/g, '').replace(/\b(?:AUD|USD|NZD|EUR|GBP|INR|JPY|CAD|SGD|CR|DR)\b/gi, '').replace(/[$€£¥₹\s]/g, '');
  const comma = value.lastIndexOf(',');
  const dot = value.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    if (comma > dot) value = value.replace(/\./g, '').replace(',', '.');
    else value = value.replace(/,/g, '');
  } else if (comma >= 0) {
    const decimals = value.length - comma - 1;
    value = decimals === 2 ? value.replace(',', '.') : value.replace(/,/g, '');
  }
  value = value.replace(/[^0-9+\-.]/g, '');
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(value)) return null;
  let cents;
  try { cents = money.toCents(value); } catch { return null; }
  if (negativeByParens && cents > 0n) cents = -cents;
  return { decimal: money.fromCents(cents), cents, direction };
}

function amountDirection(input, options = {}) {
  const parsed = normaliseMoneyToken(input);
  if (!parsed || parsed.cents === 0n) return null;
  const explicit = parsed.direction || String(options.direction || '').toUpperCase();
  if (explicit === 'DEBIT') return { debit: money.fromCents(parsed.cents < 0n ? -parsed.cents : parsed.cents), credit: '0.00' };
  if (explicit === 'CREDIT') return { debit: '0.00', credit: money.fromCents(parsed.cents < 0n ? -parsed.cents : parsed.cents) };
  const signedAmountRule = String(options.signedAmountRule || 'NEGATIVE_DEBIT').toUpperCase();
  const negativeMeansDebit = signedAmountRule !== 'NEGATIVE_CREDIT';
  const debit = (parsed.cents < 0n) === negativeMeansDebit;
  const absolute = parsed.cents < 0n ? -parsed.cents : parsed.cents;
  return debit ? { debit: money.fromCents(absolute), credit: '0.00' } : { debit: '0.00', credit: money.fromCents(absolute) };
}

function moneySum(values) {
  return money.fromCents(values.reduce((sum, value) => sum + money.toCents(value || 0), 0n));
}

module.exports = { amountDirection, moneySum, normaliseMoneyToken };
