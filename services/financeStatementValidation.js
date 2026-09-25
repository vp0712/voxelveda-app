'use strict';

const money = require('../utils/money');

function result(check, status, expected, actual, difference, detail) {
  return { check, status, expected: expected ?? null, actual: actual ?? null, difference: difference ?? null, detail: detail || null };
}

function abs(value) { return value < 0n ? -value : value; }

function evaluateStatement({ rows = [], classification = {}, account = {} }) {
  const validations = [];
  const credits = rows.reduce((sum, row) => sum + money.toCents(row.credit || 0), 0n);
  const debits = rows.reduce((sum, row) => sum + money.toCents(row.debit || 0), 0n);
  const openingSupplied = classification.opening_balance !== null && classification.opening_balance !== undefined;
  const closingSupplied = classification.closing_balance !== null && classification.closing_balance !== undefined;
  const opening = openingSupplied ? money.toCents(classification.opening_balance) : null;
  const closing = closingSupplied ? money.toCents(classification.closing_balance) : null;
  const liabilityConvention = /CREDIT.?CARD|LOAN|LIABILITY/i.test(String(account.account_type || classification.document_type || ''));
  const expectedClosing = opening === null ? null : (liabilityConvention ? opening + debits - credits : opening + credits - debits);
  const difference = expectedClosing === null || closing === null ? null : closing - expectedClosing;

  validations.push(result('SUM_CREDITS', 'PASS', null, money.fromCents(credits), null));
  validations.push(result('SUM_DEBITS', 'PASS', null, money.fromCents(debits), null));
  validations.push(result('OPENING_BALANCE', openingSupplied ? 'PASS' : 'REVIEW', null, openingSupplied ? money.fromCents(opening) : null, null, openingSupplied ? null : 'Opening balance was not explicitly detected.'));
  validations.push(result('CLOSING_BALANCE', closingSupplied ? 'PASS' : 'REVIEW', expectedClosing === null ? null : money.fromCents(expectedClosing), closingSupplied ? money.fromCents(closing) : null, difference === null ? null : money.fromCents(difference), closingSupplied ? null : 'Closing balance was not explicitly detected.'));

  let continuityFailures = 0;
  let previous = opening;
  for (const row of rows) {
    const running = row.running_balance === null || row.running_balance === undefined || row.running_balance === '' ? null : money.toCents(row.running_balance);
    const expected = previous === null ? null : (liabilityConvention
      ? previous + money.toCents(row.debit || 0) - money.toCents(row.credit || 0)
      : previous + money.toCents(row.credit || 0) - money.toCents(row.debit || 0));
    if (running !== null && expected !== null && abs(running - expected) > 1n) {
      continuityFailures += 1;
      row.validation_hint = [row.validation_hint, `Running balance differs by ${money.fromCents(running - expected)}`].filter(Boolean).join('; ');
    }
    if (running !== null) previous = running;
    else if (expected !== null) previous = expected;
  }
  validations.push(result('RUNNING_BALANCE_CONTINUITY', continuityFailures ? 'FAIL' : rows.some((row) => row.running_balance !== null && row.running_balance !== undefined) ? 'PASS' : 'REVIEW', 'continuous', continuityFailures ? `${continuityFailures} mismatch(es)` : 'continuous', null, continuityFailures ? 'Each mismatch remains attached to its source row for review.' : null));

  const currencies = [...new Set(rows.map((row) => String(row.currency || '').toUpperCase()).filter(Boolean))];
  const accountCurrency = String(account.currency || '').toUpperCase();
  const currencyMismatch = accountCurrency && currencies.some((currency) => currency !== accountCurrency);
  validations.push(result('CURRENCY_CONSISTENCY', currencyMismatch || currencies.length > 1 ? 'REVIEW' : 'PASS', accountCurrency || null, currencies.join(', ') || null, null, currencyMismatch ? 'Transaction currency differs from the selected account; explicit FX evidence is required.' : null));

  const missingDates = rows.filter((row) => !row.transaction_date).length;
  const invalidAmounts = rows.filter((row) => {
    try { return (money.toCents(row.debit || 0) > 0n) === (money.toCents(row.credit || 0) > 0n); } catch { return true; }
  }).length;
  validations.push(result('TRANSACTION_DATES', missingDates ? 'FAIL' : 'PASS', 'all rows dated', missingDates ? `${missingDates} missing` : 'all rows dated'));
  validations.push(result('DEBIT_CREDIT_DIRECTION', invalidAmounts ? 'FAIL' : 'PASS', 'exactly one positive side', invalidAmounts ? `${invalidAmounts} invalid` : 'all rows directed'));

  const hardFailure = validations.some((item) => item.status === 'FAIL');
  const exactBalance = difference !== null && difference === 0n;
  const reconciliationStatus = exactBalance && !hardFailure ? 'BALANCED' : difference === null ? 'INCOMPLETE' : 'MISMATCH';
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

module.exports = { evaluateStatement };
