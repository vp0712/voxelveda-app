'use strict';

const { MONEY_TOKEN } = require('./financeStatementAdapters/generic');
const { normaliseMoneyToken } = require('./financeStatementMoney');
const { createAmountColumnResolver, tokenCenter } = require('./financeStatementColumns');

function extractStatementEvidence(lines = []) {
  const resolveColumns = createAmountColumnResolver(lines);
  const totals = [];
  const summary = {};
  const summaryEvidence = [];
  const summaryLabels = /\b(opening\s+balance|closing\s+balance|total\s+(?:deposits?|credits?|withdrawals?|debits?))\b/gi;
  const summaryKey = label => /opening/i.test(label) ? 'opening_balance' : /closing/i.test(label) ? 'closing_balance' : /deposit|credit/i.test(label) ? 'summary_total_credits' : 'summary_total_debits';
  let reportedBalance = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const text = String(line.text || '').trim();
    const amounts = [...text.matchAll(MONEY_TOKEN)].map(match => ({ raw: match[0].trim(), index: match.index + match[0].length - match[0].trimStart().length }));
    for (const label of text.matchAll(summaryLabels)) {
      const anchor = tokenCenter(line, label.index, label[0].length);
      const nextLabel = text.slice(label.index + label[0].length).search(summaryLabels);
      const boundary = nextLabel < 0 ? text.length : label.index + label[0].length + nextLabel;
      let candidates = amounts.filter(amount => amount.index >= label.index + label[0].length && amount.index < boundary);
      let valueLine = line;
      // ANZ's overview prints the currency symbol and amount on separate lines.
      // Match the amount to the label's physical column, never an unrelated ID.
      if (!candidates.length && anchor !== null) {
        for (const next of lines.slice(index + 1, index + 6)) {
          if (Number(next.page || 1) !== Number(line.page || 1) || new RegExp(summaryLabels.source, 'i').test(String(next.text || ''))) break;
          candidates = [...String(next.text || '').matchAll(MONEY_TOKEN)].map(match => ({ raw: match[0].trim(), index: match.index + match[0].length - match[0].trimStart().length })).filter(amount => {
            const center = tokenCenter(next, amount.index, amount.raw.length);
            return center !== null && Math.abs(center - anchor) < 60;
          });
          if (candidates.length) { valueLine = next; break; }
        }
      }
      if (candidates.length !== 1) continue;
      const value = normaliseMoneyToken(candidates[0].raw)?.decimal;
      if (value === undefined || value === null) continue;
      const key = summaryKey(label[0]);
      summary[key] = key in summary && summary[key] !== value ? null : value;
      summaryEvidence.push({ key, value, source_page: Number(line.page || 1), source_snippet: `${text} ${valueLine === line ? '' : valueLine.text}`.trim().slice(0, 500) });
    }
    if (/^(?:(?:page|grand)\s+)?(?:sub)?totals?\b/i.test(text) && amounts.length) {
      const fields = resolveColumns({ line, amounts });
      const debitLabel = /\b(withdrawals?|debits?|money\s+out|paid\s+out)\b/i.test(text);
      const creditLabel = /\b(deposits?|credits?|money\s+in|paid\s+in)\b/i.test(text);
      const decimal = field => field ? normaliseMoneyToken(field.raw)?.decimal || null : null;
      const debit = decimal(fields?.debit) || (debitLabel && !creditLabel && amounts.length === 1 ? decimal(amounts[0]) : null);
      const credit = decimal(fields?.credit) || (creditLabel && !debitLabel && amounts.length === 1 ? decimal(amounts[0]) : null);
      if (debit !== null || credit !== null) totals.push({ source_page: Number(line.page || 1), debit, credit, scope: /\bpage\b|subtotal/i.test(text) ? 'PAGE' : 'DOCUMENT', source_snippet: text.slice(0, 500) });
    }
    const balanceLabel = text.match(/\bbalance\s+as\s+(?:of|at)\b[^$€£₹]*/i);
    if (balanceLabel) {
      const anchor = tokenCenter(line, balanceLabel.index, balanceLabel[0].trim().length);
      const sameLine = amounts.find(amount => amount.index > balanceLabel.index);
      if (sameLine) reportedBalance = normaliseMoneyToken(sameLine.raw)?.decimal || null;
      if (!sameLine && anchor !== null) {
        for (const next of lines.slice(index + 1, index + 4)) {
          if (Number(next.page || 1) !== Number(line.page || 1)) break;
          for (const match of String(next.text || '').matchAll(MONEY_TOKEN)) {
            const raw = match[0].trim(), start = match.index + match[0].length - match[0].trimStart().length;
            const center = tokenCenter(next, start, raw.length);
            if (center !== null && Math.abs(center - anchor) < 85) reportedBalance = normaliseMoneyToken(raw)?.decimal || null;
          }
          if (reportedBalance !== null) break;
        }
      }
    }
  }
  return { reported_totals: totals, reported_balance_as_of: reportedBalance, ...summary, statement_summary_evidence: summaryEvidence };
}

module.exports = { extractStatementEvidence };
