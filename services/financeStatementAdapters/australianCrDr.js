'use strict';

const generic = require('./generic');

const VERSION = 'australian-crdr-v1';
const INSTITUTION_PATTERNS = [
  ['Commonwealth Bank', /\b(?:COMMONWEALTH BANK|COMMBANK|CBA)\b/i],
  ['ANZ', /\b(?:AUSTRALIA AND NEW ZEALAND BANKING GROUP|ANZ)\b/i],
  ['NAB', /\b(?:NATIONAL AUSTRALIA BANK|NAB)\b/i],
  ['Westpac', /\bWESTPAC\b/i],
  ['Bendigo Bank', /\bBENDIGO BANK\b/i],
  ['Macquarie', /\bMACQUARIE\b/i],
  ['ING', /\bING(?: AUSTRALIA)?\b/i],
  ['Bank Australia', /\bBANK AUSTRALIA\b/i]
];

function institution(text) {
  const found = INSTITUTION_PATTERNS.find(([, pattern]) => pattern.test(String(text || '')));
  return found?.[0] || null;
}

function match(context) {
  const text = String(context?.text || '');
  let score = institution(text) ? 0.85 : 0;
  if (/\b(?:DEBIT|CREDIT|DR|CR)\b/i.test(text)) score += 0.1;
  if (/\bBSB\b|\bACCOUNT (?:NO|NUMBER)\b/i.test(text)) score += 0.05;
  return Math.min(1, score);
}

function parseLines(lines, options = {}) {
  return generic.parseLines(lines, { ...options, dateFormat: options.dateFormat || 'DMY' });
}

module.exports = { VERSION, institution, match, parseLines };
