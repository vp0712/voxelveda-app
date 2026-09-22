'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const migration = read('migrations/20260923_finance_original_bank_data.sql');
const controller = read('controllers/statementImportController.js');
const routes = read('routes/financeRoutes.js');

assert.match(migration, /CREATE TABLE IF NOT EXISTS bank_transaction_original_data/, 'Immutable original bank-data table is required.');
assert.match(migration, /UNIQUE KEY uq_bank_transaction_original \(bank_transaction_id\)/, 'Original data must remain one-to-one with a committed bank transaction.');
assert.match(migration, /COALESCE\(sr\.override_original_json/, 'Backfill must preserve pre-correction payload for manually corrected statement rows.');
assert.match(controller, /function originalStatementPayload\(row\)/, 'Statement importer must derive immutable source payload.');
assert.match(controller, /INSERT IGNORE INTO bank_transaction_original_data/, 'Commit must capture original statement data.');
assert.match(controller, /exports\.getOriginalBankTransaction/, 'Original transaction API is required.');
assert.match(routes, /bank-transactions\/:id\/original/, 'View Original route is required.');
assert.match(routes, /financePrivacy\.bankTransactionParam\('id'\)/, 'Original-data access must retain bank-transaction privacy enforcement.');

console.log('Finance original bank-data preservation regression checks passed.');
