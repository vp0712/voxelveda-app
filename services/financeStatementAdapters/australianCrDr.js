'use strict';

const generic = require('./generic');

const VERSION = 'australian-crdr-v2-column-aware';
const MONEY_TOKEN = /(?:\\b(?:AUD|USD|NZD|EUR|GBP|INR|JPY|CAD|SGD)\\b\\s*)?(?:CR|DR)?\\s*[-+]?\\(?[$€£¥₹]?\\d[\\d.,]*[.,]\\d{2}\\)?(?:\\s*(?:CR|DR))?/gi;
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

function headerAnchors(lines) {
  const byPage = new Map();
  for (const line of Array.isArray(lines) ? lines : []) {
    const words = Array.isArray(line?.words) ? line.words : [];
    let withdrawals = null;
    let deposits = null;
    for (const word of words) {
      const label = String(word.text || '').toLowerCase().replace(/[^a-z]/g, '');
      const x = Number(word.x);
      const width = Number(word.width);
      if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0) continue;
      const center = x + width / 2;
      if (/^withdrawals?$/.test(label)) withdrawals = center;
      if (/^deposits?$/.test(label)) deposits = center;
    }
    if (withdrawals === null || deposits === null || withdrawals === deposits) continue;
    byPage.set(String(line.page || 1), { withdrawals, deposits });
  }
  return byPage;
}

function amountCenter(line, start, length) {
  const words = Array.isArray(line?.words) ? line.words : [];
  if (!words.length || !Number.isInteger(start) || !Number.isInteger(length) || length <= 0) return null;
  const end = start + length;
  let cursor = 0;
  const matched = [];
  for (const word of words) {
    const text = String(word.text || '');
    const wordStart = cursor;
    const wordEnd = wordStart + text.length;
    if (wordEnd > start && wordStart < end) {
      const x = Number(word.x);
      const width = Number(word.width);
      if (Number.isFinite(x) && Number.isFinite(width) && width > 0) matched.push({ left: x, right: x + width });
    }
    cursor = wordEnd + 1;
  }
  if (!matched.length) return null;
  return (Math.min(...matched.map((item) => item.left)) + Math.max(...matched.map((item) => item.right))) / 2;
}

function createColumnDirectionResolver(lines) {
  const anchors = headerAnchors(lines);
  if (!anchors.size) return () => null;
  return ({ line, amountIndex, amountLength, amountCount }) => {
    // Do not guess between multiple monetary tokens (for example, amount plus balance).
    if (amountCount !== 1) return null;
    const pageAnchors = anchors.get(String(line?.page || 1));
    if (!pageAnchors) return null;
    const gap = Math.abs(pageAnchors.deposits - pageAnchors.withdrawals);
    if (!Number.isFinite(gap) || gap < 8) return null;
    const center = amountCenter(line, amountIndex, amountLength);
    if (!Number.isFinite(center)) return null;
    const withdrawalDistance = Math.abs(center - pageAnchors.withdrawals);
    const depositDistance = Math.abs(center - pageAnchors.deposits);
    const nearestDistance = Math.min(withdrawalDistance, depositDistance);
    // Require clear alignment to one column; uncertain rows remain rejected for review.
    if (nearestDistance > gap * 0.85 || Math.abs(withdrawalDistance - depositDistance) < gap * 0.15) return null;
    return withdrawalDistance < depositDistance ? 'DEBIT' : 'CREDIT';
  };
}

function parseLines(lines, options = {}) {
  const source = Array.isArray(lines) ? lines : [];
  const inferUnsignedDirection = createColumnDirectionResolver(source);
  return generic.parseLines(source, {
    ...options,
    dateFormat: options.dateFormat || 'DMY',
    inferUnsignedDirection: (context) => inferUnsignedDirection(context) || options.inferUnsignedDirection?.(context) || null
  });
}

module.exports = { VERSION, institution, match, parseLines };
