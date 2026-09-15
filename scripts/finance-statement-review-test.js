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

assert(migration.includes('CREATE TABLE statement_import_sessions'), 'statement review session table missing');
assert(migration.includes('CREATE TABLE statement_import_rows'), 'statement review row table missing');
assert(controller.includes("status !== 'PENDING_REVIEW'"), 'review lifecycle lock missing');
assert(controller.includes('INSERT IGNORE INTO bank_transactions'), 'commit duplicate protection missing');
assert(controller.includes("validation_status IN ('VALID','WARNING')"), 'commit validation gate missing');
assert(routes.includes('/statements/preview'), 'statement preview route missing');
assert(routes.includes('/statement-reviews/:uid/commit'), 'statement commit route missing');
assert(client.includes('parseOfx'), 'OFX parser missing');
assert(client.includes('parseQif'), 'QIF parser missing');
assert(client.includes('parsePdfLines'), 'PDF conservative parser missing');
assert(client.includes('parseXlsx'), 'XLSX parser missing');
assert(client.includes('/statements/preview'), 'client must stage statements before commit');

console.log('Finance statement review architecture checks passed.');
