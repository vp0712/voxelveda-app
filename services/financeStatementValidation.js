'use strict';

const money = require('../utils/money');

function result(check, status, expected, actual, difference, detail) {
  return { check, status, expected: expected ?? null, actual: actual ?? null, difference: difference ?? null, detail: detail || null };
}

function abs(value) { return value < 0n ? -value : value; }
function safeCents(value) { try { return money.toCents(value || 0); } catch { return null; } }
function isBalanceMarker(row) { return /^(?:opening|closing)\s+balance\b|^balance\s+(?:b\/f|c\/f|brought\s+forward|carried\s+forward)\b/i.test(String(row.description || '').trim()); }

function hasVerifiedNoActivity(classification = {}, rows = []) {
  const keys = ['opening_balance', 'closing_balance', 'summary_total_credits', 'summary_total_debits'];
  if (keys.some(key => classification[key] === null || classification[key] === undefined || classification[key] === '')) return false;
  if (classification.document_type !== 'BANK_STATEMENT' || classification.multiple_accounts || classification.multiple_currencies || classification.appears_incomplete) return false;
  const start = classification.statement_start_date, end = classification.statement_end_date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '') || start > end) return false;
  if (rows.some(row => !isBalanceMarker(row))) return false;
  try {
    return money.toCents(classification.summary_total_credits) === 0n && money.toCents(classification.summary_total_debits) === 0n
      && money.toCents(classification.opening_balance) === money.toCents(classification.closing_balance);
  } catch { return false; }
}

function checkContinuity(rows, opening, liability) {
  let previous = opening;
  let checked = 0;
  const mismatches = [];
  for (const row of rows) {
    const debit = safeCents(row.debit), credit = safeCents(row.credit);
    const running = row.running_balance === null || row.running_balance === undefined || row.running_balance === '' ? null : safeCents(row.running_balance);
    const expected = previous === null || debit === null || credit === null ? null : previous + (liability ? debit - credit : credit - debit);
    if (running !== null && expected !== null) {
      checked += 1;
      if (abs(running - expected) > 1n) mismatches.push({ row, difference: running - expected });
    }
    previous = running !== null ? running : expected;
  }
  return { checked, mismatches };
}

function evaluateStatement({ rows = [], classification = {}, account = {} }) {
  const validations = [];
  const transactionRows = rows.filter(row => !isBalanceMarker(row));
  const credits = transactionRows.reduce((sum, row) => sum + (safeCents(row.credit) || 0n), 0n);
  const debits = transactionRows.reduce((sum, row) => sum + (safeCents(row.debit) || 0n), 0n);
  const openingSupplied = classification.opening_balance !== null && classification.opening_balance !== undefined;
  const closingSupplied = classification.closing_balance !== null && classification.closing_balance !== undefined;
  const opening = openingSupplied ? money.toCents(classification.opening_balance) : null;
  const closing = closingSupplied ? money.toCents(classification.closing_balance) : null;
  const liabilityConvention = /CREDIT.?CARD|LOAN|LIABILITY/i.test(String(account.account_type || classification.document_type || ''));
  const expectedClosing = opening === null ? null : (liabilityConvention ? opening + debits - credits : opening + credits - debits);
  const difference = expectedClosing === null || closing === null ? null : closing - expectedClosing;
  const noActivity = hasVerifiedNoActivity(classification, rows);
  if (!transactionRows.length) validations.push(result('NO_ACTIVITY_STATEMENT', noActivity ? 'PASS' : 'FAIL', 'explicit zero deposits/withdrawals and equal supplied balances', noActivity ? 'Verified no-activity statement' : 'No transaction rows without sufficient source evidence', null, 'A verified no-activity statement retains its original and period, but creates no ledger transactions. Manual acceptance is still required.'));

  validations.push(result('SUM_CREDITS', 'PASS', null, money.fromCents(credits), null));
  validations.push(result('SUM_DEBITS', 'PASS', null, money.fromCents(debits), null));
  validations.push(result('OPENING_BALANCE', openingSupplied ? 'PASS' : 'REVIEW', null, openingSupplied ? money.fromCents(opening) : null, null, openingSupplied ? null : 'Opening balance was not explicitly detected.'));
  validations.push(result('CLOSING_BALANCE', difference !== null && difference !== 0n ? 'FAIL' : closingSupplied ? 'PASS' : 'REVIEW', expectedClosing === null ? null : money.fromCents(expectedClosing), closingSupplied ? money.fromCents(closing) : null, difference === null ? null : money.fromCents(difference), closingSupplied ? null : 'Closing balance was not explicitly detected.'));

  let sourceOrder = null;
  for (let i = 0; i + 1 < transactionRows.length; i += 1) {
    const left = transactionRows[i].transaction_date, right = transactionRows[i + 1].transaction_date;
    if (left && right && left !== right) { sourceOrder = left < right ? 'ASC' : 'DESC'; break; }
  }
  let continuity = checkContinuity(sourceOrder === 'DESC' ? [...transactionRows].reverse() : transactionRows, opening, liabilityConvention);
  if (!sourceOrder) {
    const reversed = checkContinuity([...transactionRows].reverse(), opening, liabilityConvention);
    if (reversed.mismatches.length < continuity.mismatches.length) { continuity = reversed; sourceOrder = 'DESC'; }
  }
  for (const item of continuity.mismatches) item.row.validation_hint = [item.row.validation_hint, `Running balance differs by ${money.fromCents(item.difference)}`].filter(Boolean).join('; ');
  const continuityFailures = continuity.mismatches.length;
  validations.push(result('RUNNING_BALANCE_CONTINUITY', continuityFailures ? 'FAIL' : continuity.checked || noActivity ? 'PASS' : 'REVIEW', 'continuous', continuityFailures ? `${continuityFailures} mismatch(es)` : noActivity ? 'No activity; equal supplied balances' : continuity.checked ? 'continuous' : 'not supplied or insufficient evidence', null, continuityFailures ? 'Each mismatch remains attached to its source row for review.' : `Checked in ${sourceOrder === 'DESC' ? 'reverse source' : 'source'} order without changing the original statement rows.`));

  const printedTotals = classification.reported_totals || [];
  const pageSum = (page, key) => transactionRows.filter(row => Number(row.source_page || 1) === Number(page)).reduce((sum, row) => sum + (safeCents(row[key]) || 0n), 0n);
  const documentTotals = printedTotals.filter(item => item.scope !== 'PAGE');
  const totalsArePerPage = new Set(documentTotals.map(item => item.source_page)).size > 1 && documentTotals.every(item => ['debit','credit'].every(key => item[key] === null || item[key] === undefined || safeCents(item[key]) === pageSum(item.source_page, key)));
  const finalTotals = {};
  for (const item of printedTotals) {
    if (item.scope === 'PAGE' || totalsArePerPage) {
      for (const key of ['debit','credit']) {
        if (item[key] === null || item[key] === undefined) continue;
        const expected = safeCents(item[key]), actual = pageSum(item.source_page, key);
        validations.push(result(`PAGE_${item.source_page}_${key.toUpperCase()}S`, expected === actual ? 'PASS' : 'FAIL', item[key], money.fromCents(actual), expected === null ? null : money.fromCents(actual - expected), 'Printed page subtotal compared with source transaction rows; never added to cash flow.'));
      }
    } else {
      for (const key of ['debit','credit']) if (item[key] !== null && item[key] !== undefined) finalTotals[key] = item[key];
    }
  }
  for (const [key, actual] of [['debit',debits],['credit',credits]]) {
    if (finalTotals[key] === undefined) continue;
    const expected = safeCents(finalTotals[key]);
    validations.push(result(`PRINTED_TOTAL_${key.toUpperCase()}S`, expected === actual ? 'PASS' : 'FAIL', finalTotals[key], money.fromCents(actual), expected === null ? null : money.fromCents(actual - expected), 'Printed document total compared with extracted rows; headers, balances and subtotals are excluded.'));
  }

  const currencies = [...new Set(rows.map((row) => String(row.currency || '').toUpperCase()).filter(Boolean))];
  const accountCurrency = String(account.currency || '').toUpperCase();
  const currencyMismatch = accountCurrency && currencies.some((currency) => currency !== accountCurrency);
  validations.push(result('CURRENCY_CONSISTENCY', currencyMismatch || currencies.length > 1 ? 'REVIEW' : 'PASS', accountCurrency || null, currencies.join(', ') || null, null, currencyMismatch ? 'Transaction currency differs from the selected account; explicit FX evidence is required.' : null));

  const missingDates = transactionRows.filter((row) => !row.transaction_date).length;
  const invalidAmounts = transactionRows.filter((row) => {
    const debit = safeCents(row.debit), credit = safeCents(row.credit);
    return debit === null || credit === null || debit < 0n || credit < 0n || (debit > 0n) === (credit > 0n);
  }).length;
  validations.push(result('TRANSACTION_DATES', missingDates ? 'FAIL' : 'PASS', 'all rows dated', missingDates ? `${missingDates} missing` : 'all rows dated'));
  validations.push(result('DEBIT_CREDIT_DIRECTION', invalidAmounts ? 'FAIL' : 'PASS', 'exactly one positive side', invalidAmounts ? `${invalidAmounts} invalid` : 'all rows directed'));

  const hardFailure = validations.some((item) => item.status === 'FAIL');
  const exactBalance = difference !== null && difference === 0n;
  const reconciliationStatus = hardFailure ? 'MISMATCH' : exactBalance ? 'BALANCED' : difference === null ? 'INCOMPLETE' : 'MISMATCH';
  return {
    validations,
    totals: {
      opening_balance: opening === null ? null : money.fromCents(opening),
      total_credits: money.fromCents(credits),
      total_debits: money.fromCents(debits),
      expected_closing_balance: expectedClosing === null ? null : money.fromCents(expectedClosing),
      extracted_closing_balance: closing === null ? null : money.fromCents(closing),
      reconciliation_difference: difference === null ? null : money.fromCents(difference)
    },
    reconciliationStatus,
    validForAutomaticReview: reconciliationStatus === 'BALANCED' && !hardFailure && Number(classification.classification_confidence || 0) >= 0.7
  };
}

module.exports = { evaluateStatement, hasVerifiedNoActivity };
