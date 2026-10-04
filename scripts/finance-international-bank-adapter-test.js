'use strict';

const assert = require('node:assert/strict');
const { selectAdapter } = require('../services/financeStatementAdapters');
const { normaliseDate } = require('../services/financeStatementAdapters/generic');

const cases = [
  { text: 'STATE BANK OF INDIA account statement', institution: 'State Bank of India', format: 'DMY', raw: '04/05/2026', expected: '2026-05-04' },
  { text: 'ICICI BANK savings account statement', institution: 'ICICI Bank', format: 'DMY', raw: '04/05/2026', expected: '2026-05-04' },
  { text: 'CHASE BANK checking account statement', institution: 'Chase', format: 'MDY', raw: '04/05/2026', expected: '2026-04-05' },
  { text: 'BANK OF AMERICA account statement', institution: 'Bank of America', format: 'MDY', raw: '04/05/2026', expected: '2026-04-05' },
  { text: 'HSBC account statement', institution: 'HSBC', format: 'DMY', raw: '04/05/2026', expected: '2026-05-04' }
];

for (const item of cases) {
  const selected = selectAdapter({ text: item.text });
  assert.equal(selected.adapter.findBank(item.text).name, item.institution);
  const format = selected.adapter.dateFormatFor(item.text);
  assert.equal(format, item.format);
  assert.equal(normaliseDate(item.raw, { dateFormat: format }).value, item.expected);
}
assert.equal(selectAdapter({ text: 'ordinary statement with no known institution' }).adapter.VERSION, 'generic-statement-v3');
console.log('FINANCE_INTERNATIONAL_BANK_ADAPTER_TEST_OK');
