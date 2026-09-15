const sanitizer = require('../middleware/statementPreviewSanitizer');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(sanitizer.normalizeStatementDate('16/09/2026') === '2026-09-16', 'Australian DD/MM/YYYY dates must normalize to ISO.');
assert(sanitizer.normalizeStatementDate('16 Sep 2026') === '2026-09-16', 'Text month dates must normalize to ISO.');
assert(sanitizer.normalizeStatementDate('2026-09-16') === '2026-09-16', 'ISO dates must remain ISO.');
assert(sanitizer.normalizeStatementDate('') === null, 'Missing dates must not be staged as empty SQL DATE values.');
assert(sanitizer.isBalanceOnlyRow({ description: 'OPENING BALANCE' }) === true, 'Opening-balance rows must be recognized as non-transactions.');
assert(sanitizer.isBalanceOnlyRow({ description: 'COLES SUPERMARKET' }) === false, 'Normal transactions must not be filtered as balance rows.');

const routeSource = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'routes', 'financeRoutes.js'), 'utf8');
assert(routeSource.includes('statementPreviewSanitizer, statementReview.preview'), 'Statement preview sanitizer must run before staging controller.');

console.log('Statement preview sanitizer regression checks passed.');