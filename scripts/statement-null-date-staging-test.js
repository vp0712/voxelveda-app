const { dateOnly } = require('../services/financeDomain');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(dateOnly('') === null, 'Missing dates must normalize to null for SQL DATE columns.');
assert(dateOnly('not-a-date') === null, 'Invalid dates must normalize to null for SQL DATE columns.');
assert(dateOnly('2026-09-16') === '2026-09-16', 'Valid ISO dates must remain unchanged.');
assert(dateOnly('2026-09-16T08:00:00Z') === '2026-09-16', 'ISO datetimes must normalize to date-only values.');

console.log('Statement null-date staging regression checks passed.');
