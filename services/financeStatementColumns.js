'use strict';

// Work with the source table's coordinates. A currency token in a merchant's
// description is not a debit, credit or running balance column.
const LABEL = /\b(withdrawals?|debits?|money\s+out|paid\s+out|deposits?|credits?|money\s+in|paid\s+in|amount|(?:running\s+)?balance)\b/gi;
function kind(label) {
  if (/withdraw|debit|out/i.test(label)) return 'debit';
  if (/deposit|credit|\bin\b/i.test(label)) return 'credit';
  return /balance/i.test(label) ? 'balance' : 'amount';
}

function isTableHeaderLine(line) {
  const text = String(line?.text || '');
  const keys = new Set([...text.matchAll(LABEL)].map(match => kind(match[0])));
  return keys.size >= 2 && /\b(date|transaction|particulars|narration|description|details)\b/i.test(text);
}

function tokenCenter(line, start, length) {
  let cursor = 0;
  const positions = [];
  for (const word of line?.words || []) {
    const text = String(word.text || '');
    const x = Number(word.x), width = Number(word.width);
    const left = Math.max(start, cursor), right = Math.min(start + length, cursor + text.length);
    if (right > left && Number.isFinite(x) && Number.isFinite(width) && width > 0 && text.length) {
      positions.push({ left: x + width * (left - cursor) / text.length, right: x + width * (right - cursor) / text.length });
    }
    cursor += text.length + 1;
  }
  return positions.length ? (Math.min(...positions.map(p => p.left)) + Math.max(...positions.map(p => p.right))) / 2 : null;
}

function columnLayouts(lines) {
  const layouts = new Map();
  for (const line of lines || []) {
    if (!isTableHeaderLine(line)) continue;
    const anchors = {};
    for (const match of String(line.text).matchAll(LABEL)) {
      const center = tokenCenter(line, match.index, match[0].length);
      if (center !== null) anchors[kind(match[0])] = center;
    }
    if (Object.keys(anchors).length >= 2) layouts.set(String(line.page || 1), anchors);
  }
  return layouts;
}

function nearestColumn(center, anchors) {
  if (center === null) return null;
  const ranked = Object.entries(anchors).map(([key, x]) => ({ key, distance: Math.abs(center - x), x })).sort((a, b) => a.distance - b.distance);
  if (ranked.length < 2) return null;
  const gap = Math.abs(ranked[0].x - ranked[1].x);
  if (gap < 8 || ranked[0].distance > gap * 0.85 || ranked[1].distance - ranked[0].distance < gap * 0.15) return null;
  return ranked[0].key;
}

function createAmountColumnResolver(lines) {
  const layouts = columnLayouts(lines);
  return ({ line, amounts }) => {
    const anchors = layouts.get(String(line?.page || 1));
    if (!anchors) return null;
    const fields = {};
    for (const amount of amounts) {
      const column = nearestColumn(tokenCenter(line, amount.index, amount.raw.length), anchors);
      if (!column) continue;
      // More than one value aligned to a column is ambiguous; never silently choose one.
      if (fields[column]) return { ambiguous: true };
      fields[column] = amount;
    }
    return { ...fields, hasBalanceColumn: anchors.balance !== undefined };
  };
}

module.exports = { isTableHeaderLine, tokenCenter, columnLayouts, nearestColumn, createAmountColumnResolver };
