'use strict';

const assert = require('node:assert/strict');
const adapter = require('../services/financeStatementAdapters/australianCrDr');

function word(text, x, width) { return { text, x, y: 100, width, height: 10, confidence: 100 }; }
const header = {
  page: 1,
  text: 'Date Transaction Details Withdrawals Deposits',
  words: [
    word('Date', 20, 25),
    word('Transaction', 90, 60),
    word('Details', 160, 40),
    word('Withdrawals', 440, 61),
    word('Deposits', 520, 53)
  ]
};

function transaction(date, description, amount, center, suffix = '') {
  const amountText = suffix ? amount + ' ' + suffix : amount;
  const words = [
    word(date, 20, date.length * 6),
    word(description, 100, description.length * 5),
    word(amountText, center - amountText.length * 3, amountText.length * 6)
  ].sort((a, b) => a.x - b.x);
  return { page: 1, text: words.map((item) => item.text).join(' '), words };
}

const parsed = adapter.parseLines([
  header,
  transaction('10/08/2026', 'Grocery', '45.20', 481, ''),
  transaction('11/08/2026', 'Salary', '250.00', 548, '')
]);
assert.equal(parsed.length, 2, 'ANZ withdrawal/deposit rows should be extracted');
assert.equal(parsed[0].transaction_date, '2026-08-10');
assert.equal(parsed[0].debit, '45.20', 'amount under Withdrawals must be a debit');
assert.equal(parsed[0].credit, '0.00');
assert.equal(parsed[0].force_rejected, false);
assert.equal(parsed[1].debit, '0.00');
assert.equal(parsed[1].credit, '250.00', 'amount under Deposits must be a credit');
assert.equal(parsed[1].force_rejected, false);

const ambiguous = adapter.parseLines([
  header,
  transaction('12/08/2026', 'Unclear', '9.99', 509, '')
])[0];
assert.equal(ambiguous.force_rejected, true, 'column-boundary amounts must stay rejected for review');
assert.equal(ambiguous.debit, '0.00');
assert.equal(ambiguous.credit, '0.00');

const noCoordinates = adapter.parseLines([{
  page: 1,
  text: '13/08/2026 Grocery 9.99',
  words: [{ text: '13/08/2026' }, { text: 'Grocery' }, { text: '9.99' }]
}])[0];
assert.equal(noCoordinates.force_rejected, true, 'missing column coordinates must not trigger a guess');

const explicit = adapter.parseLines([
  header,
  transaction('14/08/2026', 'Refund', '12.00', 481, 'CR')
])[0];
assert.equal(explicit.credit, '12.00', 'explicit CR/DR evidence must keep precedence over column inference');
assert.equal(explicit.force_rejected, false);

const multipleAmounts = adapter.parseLines([
  header,
  {
    page: 1,
    text: '15/08/2026 Transfer 25.00 100.00',
    words: [
      word('15/08/2026', 20, 60),
      word('Transfer', 100, 45),
      word('25.00', 440, 34),
      word('100.00', 520, 40)
    ]
  }
])[0];
assert.equal(multipleAmounts.force_rejected, true, 'multiple monetary values require independent running-balance proof');

console.log('FINANCE_AUSTRALIAN_CRDR_ADAPTER_TEST_OK');
