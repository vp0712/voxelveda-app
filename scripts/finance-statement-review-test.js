'use strict';

const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const assert=(ok,message)=>{if(!ok)throw new Error(message)};

const migration=read('migrations/20260915_finance_statement_staging_review.sql');
const controller=read('controllers/statementImportController.js');
const routes=read('routes/financeRoutes.js');
const client=read('public/finance-master.js');
const html=read('public/finance-intelligence.html');

assert(migration.includes('CREATE TABLE statement_import_sessions'),'statement review session table missing');
assert(migration.includes('CREATE TABLE statement_import_rows'),'statement review row table missing');
assert(controller.includes("status !== 'PENDING_REVIEW'"),'review lifecycle lock missing');
assert(controller.includes('INSERT IGNORE INTO bank_transactions'),'commit duplicate protection missing');
assert(controller.includes("validation_status IN ('VALID','WARNING')"),'commit validation gate missing');
assert(controller.includes('repairPendingReview'),'stale pending review repair missing');
assert(controller.includes("validation_status='REJECTED'"),'balance-marker repair missing');
assert(controller.includes('NO_IMPORTABLE_TRANSACTIONS'),'clear no-importable-transactions response missing');
assert(/await db\.commit\(\);\r?\n\s+return res\.status\(422\)\.json/.test(controller),'no-importable repair must commit before the 422 response');
assert(controller.includes('repaired_balance_markers'),'statement commit audit must record repaired balance markers');

assert(routes.includes('/statements/preview'),'statement preview route missing');
assert(routes.includes('/statement-reviews/:uid/commit'),'statement commit route missing');
assert(routes.includes('/statement-reviews/:uid/reject'),'statement reject route missing');

for(const marker of ['parseOfx','parseQif','parsePdfLines','parseXlsx','openStatementWizard','openHistoricalImport','openStatementReview'])assert(client.includes(marker),'canonical Finance statement workflow missing '+marker);
assert(client.includes('accept=".csv,.pdf,.ofx,.qfx,.qif,.xlsx"'),'supported statement file formats are incomplete');
assert(client.includes("crypto.subtle.digest('SHA-256'"),'statement source hashing is missing');
assert(client.includes('/statements/preview'),'statement rows must stage before commit');
assert(client.includes("['DUPLICATE','REJECTED'].includes(row.validation_status)"),'duplicate/rejected rows must not be selectable');
assert(client.includes('data-review-select'),'row-level review selection missing');
assert(client.includes('data-review-commit'),'explicit statement commit action missing');
assert(client.includes('data-review-reject'),'explicit statement reject action missing');
assert(client.includes('Nothing is committed automatically.')||client.includes('Nothing has been committed yet.'),'historical import must remain non-posting before review');
assert(client.includes('No imported row enters the canonical ledger until you review and commit it.'),'historical import safety explanation missing');
assert(client.includes('This PDF does not expose transaction direction safely enough for automatic import.'),'ambiguous PDF extraction must fail closed instead of guessing');
assert(!client.includes('opening balance is income'),'opening/closing balance markers must never be treated as income');
assert(html.includes('/finance-master.js')&&!html.includes('finance-import-wizard.js'),'statement review must live only in canonical Finance master');

assert(controller.includes("sis.status='PENDING_REVIEW'"),'preview must detect duplicate rows already staged in other pending statement files');
assert(controller.includes('already staged in'),'cross-file duplicate reason must identify the staged source');
assert(controller.includes('Excluded from import, totals and reports.'),'duplicate rows must be explicitly excluded from finance outputs');
assert(controller.includes('finalDuplicateRowIds'),'commit must reclassify race-time duplicates instead of silently skipping them');
assert(controller.includes("validation_status='DUPLICATE'"),'final commit duplicate rows must be persisted as duplicate and deselected');
assert(client.includes('validation_message'),'statement review must display the validation reason for duplicate/rejected rows');
assert(client.includes('showFinancePopup'),'statement import must show an in-app centred success/result message');
assert(controller.includes("code: 'STATEMENT_PREVIEW_BUSY'"),'transient DB contention must return a retryable statement-preview code');
assert(controller.includes("error?.code === 'ER_LOCK_WAIT_TIMEOUT'")&&controller.includes("error?.code === 'ER_LOCK_DEADLOCK'"),'lock timeout/deadlock handling must remain explicit');
assert(!controller.includes("content_hash=? ORDER BY id DESC LIMIT 1 FOR UPDATE"),'statement preview must not hold an unnecessary session-row lock while parsing/staging');
console.log('Finance statement review architecture checks passed.');
