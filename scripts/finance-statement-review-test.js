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
const pdfEnhancer = read('public/finance-pdf-import-enhancer.js');
const brandRenderer = read('services/globalBrandRenderer.js');

assert(migration.includes('CREATE TABLE statement_import_sessions'), 'statement review session table missing');
assert(migration.includes('CREATE TABLE statement_import_rows'), 'statement review row table missing');
assert(controller.includes("status !== 'PENDING_REVIEW'"), 'review lifecycle lock missing');
assert(controller.includes('INSERT IGNORE INTO bank_transactions'), 'commit duplicate protection missing');
assert(controller.includes("validation_status IN ('VALID','WARNING')"), 'commit validation gate missing');
assert(controller.includes('repairPendingReview'), 'stale pending review repair missing');
assert(controller.includes("validation_status='REJECTED'"), 'balance marker persistence repair missing');
assert(controller.includes('NO_IMPORTABLE_TRANSACTIONS'), 'clear no-importable-transactions response missing');
assert(/await db\.commit\(\);\r?\n\s+return res\.status\(422\)\.json/.test(controller), 'no-importable repair must commit before response instead of rolling back');
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
assert(reviewFilter.includes('#reviewRows tr[hidden]{display:none!important}'), 'mobile CSS must never override hidden review rows');
assert(reviewFilter.includes("row.style.display = visible ? '' : 'none'"), 'review filter must enforce hidden rows at inline style level');
assert(reviewFilter.includes('__vvFinanceReviewFilterInstalled'), 'review filter must be idempotent when loaded more than once');

assert(brandRenderer.includes('finance-pdf-import-enhancer.js?v=20260918-pdf-parser2'), 'enhanced PDF parser must be loaded on rendered app pages');
assert(pdfEnhancer.includes('detectColumns'), 'PDF parser must detect debit, credit and balance columns');
assert(pdfEnhancer.includes("['debit', 'debits', 'withdrawal', 'withdrawals', 'money out', 'paid out']"), 'PDF parser must understand debit/withdrawal/money-out headings');
assert(pdfEnhancer.includes("['credit', 'credits', 'deposit', 'deposits', 'money in', 'paid in']"), 'PDF parser must understand credit/deposit/money-in headings');
assert(pdfEnhancer.includes('inferDirections'), 'PDF parser must support balance-delta direction verification');
assert(pdfEnhancer.includes('balanceMarker'), 'PDF parser must exclude opening/closing balance markers');
assert(pdfEnhancer.includes('result.reused && importable === 0'), 'zero-row stale pending reviews must be superseded instead of endlessly reopened');
assert(pdfEnhancer.includes('Automatically superseded by improved PDF parser'), 'superseded review must leave an auditable reason');
assert(pdfEnhancer.includes('uncertain row(s) were left out instead of being guessed'), 'ambiguous PDF rows must fail safe instead of guessing');
assert(pdfEnhancer.includes('stopImmediatePropagation'), 'enhanced PDF submit must not race the legacy PDF parser');
assert(!pdfEnhancer.includes('opening balance is income'), 'balance markers must never be reclassified as transactions');

console.log('Finance statement review architecture checks passed.');
