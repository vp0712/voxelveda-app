const fs = require('node:fs');
const path = require('node:path');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const migration = read('migrations/20260915_finance_statement_staging_review.sql');
const controller = read('controllers/statementImportController.js');
const routes = read('routes/financeRoutes.js');
const client = read('public/finance-intelligence.js');
const wizard = read('public/finance-import-wizard.js');
const reviewFilter = read('public/finance-review-filter.js');

assert(migration.includes('CREATE TABLE statement_import_sessions'), 'statement review session table missing');
assert(migration.includes('CREATE TABLE statement_import_rows'), 'statement review row table missing');
assert(controller.includes("status !== 'PENDING_REVIEW'"), 'review lifecycle lock missing');
assert(controller.includes('INSERT IGNORE INTO bank_transactions'), 'commit duplicate protection missing');
assert(controller.includes("validation_status IN ('VALID','WARNING')"), 'commit validation gate missing');
assert(controller.includes('repairPendingReview'), 'stale pending review repair missing');
assert(controller.includes("validation_status='REJECTED'"), 'balance marker persistence repair missing');
assert(controller.includes('NO_IMPORTABLE_TRANSACTIONS'), 'clear no-importable-transactions response missing');
assert(controller.includes('await db.commit();\n      return res.status(422).json'), 'no-importable repair must commit before response instead of rolling back');
assert(controller.includes('repaired_balance_markers'), 'statement commit audit must record repaired balance markers');
assert(routes.includes('/statements/preview'), 'statement preview route missing');
assert(routes.includes('/statement-reviews/:uid/commit'), 'statement commit route missing');
assert(client.includes('parseOfx'), 'OFX parser missing');
assert(client.includes('parseQif'), 'QIF parser missing');
assert(client.includes('parsePdfLines'), 'PDF conservative parser missing');
assert(client.includes('parseXlsx'), 'XLSX parser missing');
assert(client.includes('/statements/preview'), 'client must stage statements before commit');
assert(wizard.includes('installCommitResponseGuard'), 'statement approval response guard missing');
assert(wizard.includes('No transactions available to import'), 'empty review must disable misleading approval action');
assert(wizard.includes('rowIsBalanceMarker'), 'client must defensively identify stale balance markers');
assert(wizard.includes('reviewActionStatus'), 'review modal needs visible in-place approval status');
assert(wizard.includes('response.clone().json()'), 'approval error response must be surfaced without consuming the primary response');
assert(wizard.includes('/finance-review-filter.js?v=20260918-rejected-hidden'), 'review filter asset loader missing');
assert(reviewFilter.includes("filter: 'IMPORTABLE'"), 'review must default to importable rows rather than rejected rows');
assert(reviewFilter.includes("filter === 'REJECTED'" ) || reviewFilter.includes("'REJECTED'"), 'rejected-row filter missing');
assert(reviewFilter.includes('Tap Rejected or Duplicates above'), 'empty importable view must explain how to inspect excluded rows');
assert(reviewFilter.includes('data-review-filter'), 'review summary counts must be interactive filters');

console.log('Finance statement review architecture checks passed.');
