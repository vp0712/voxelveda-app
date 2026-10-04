'use strict';

const generic = require('./generic');

const BANKS = Object.freeze([
  { name: 'State Bank of India', format: 'DMY', pattern: /\b(?:STATE BANK OF INDIA|\bSBI\b)\b/i },
  { name: 'HDFC Bank', format: 'DMY', pattern: /\bHDFC(?: BANK)?\b/i },
  { name: 'ICICI Bank', format: 'DMY', pattern: /\bICICI(?: BANK)?\b/i },
  { name: 'Axis Bank', format: 'DMY', pattern: /\bAXIS BANK\b/i },
  { name: 'Kotak Mahindra Bank', format: 'DMY', pattern: /\bKOTAK(?: MAHINDRA)? BANK\b/i },
  { name: 'Punjab National Bank', format: 'DMY', pattern: /\b(?:PUNJAB NATIONAL BANK|PNB)\b/i },
  { name: 'Bank of Baroda', format: 'DMY', pattern: /\bBANK OF BARODA\b/i },
  { name: 'Canara Bank', format: 'DMY', pattern: /\bCANARA BANK\b/i },
  { name: 'Union Bank of India', format: 'DMY', pattern: /\bUNION BANK OF INDIA\b/i },
  { name: 'IDFC FIRST Bank', format: 'DMY', pattern: /\bIDFC(?: FIRST)? BANK\b/i },
  { name: 'Chase', format: 'MDY', pattern: /\b(?:JPMORGAN CHASE|CHASE BANK|CHASE)\b/i },
  { name: 'Bank of America', format: 'MDY', pattern: /\bBANK OF AMERICA\b/i },
  { name: 'Wells Fargo', format: 'MDY', pattern: /\bWELLS FARGO\b/i },
  { name: 'Citibank', format: 'MDY', pattern: /\b(?:CITIBANK|CITI BANK)\b/i },
  { name: 'Capital One', format: 'MDY', pattern: /\bCAPITAL ONE\b/i },
  { name: 'U.S. Bank', format: 'MDY', pattern: /\bU\.?S\.? BANK\b/i },
  { name: 'HSBC', format: 'DMY', pattern: /\bHSBC\b/i },
  { name: 'Barclays', format: 'DMY', pattern: /\bBARCLAYS\b/i },
  { name: 'Lloyds Bank', format: 'DMY', pattern: /\bLLOYDS(?: BANK)?\b/i },
  { name: 'NatWest', format: 'DMY', pattern: /\bNATWEST\b/i },
  { name: 'Monzo', format: 'DMY', pattern: /\bMONZO\b/i },
  { name: 'Revolut', format: 'DMY', pattern: /\bREVOLUT\b/i },
  { name: 'TD Canada Trust', format: 'MDY', pattern: /\b(?:TD CANADA TRUST|TORONTO-DOMINION BANK)\b/i },
  { name: 'Royal Bank of Canada', format: 'MDY', pattern: /\b(?:ROYAL BANK OF CANADA|RBC ROYAL BANK)\b/i },
  { name: 'ANZ New Zealand', format: 'DMY', pattern: /\bANZ NEW ZEALAND\b/i },
  { name: 'Kiwibank', format: 'DMY', pattern: /\bKIWIBANK\b/i }
]);

function findBank(text) {
  const source = String(text || '');
  return BANKS.find((bank) => bank.pattern.test(source)) || null;
}

function match(context) {
  return findBank(context?.text)?.name ? 0.96 : 0;
}

function parseLines(lines, options = {}) {
  const bank = findBank(options.sourceText || options.documentText || '');
  return generic.parseLines(lines, {
    ...options,
    dateFormat: options.dateFormat || bank?.format || 'DMY'
  });
}

module.exports = {
  VERSION: 'international-bank-adapter-v1',
  DATE_FORMAT: 'DMY',
  dateFormatFor: (text) => findBank(text)?.format || 'DMY',
  BANKS,
  findBank,
  match,
  parseLines
};
