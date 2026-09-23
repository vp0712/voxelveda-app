'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const assert=(ok,message)=>{if(!ok)throw new Error(message)};

const migration=read('migrations/20260915_finance_statement_staging_review.sql');
const controller=read('controllers/statementImportController.js');
const routes=read('routes/financeRoutes.js');
const ui=read('public/finance-master.js');
const html=read('public/finance-intelligence.html');

assert(migration.includes('CREATE TABLE statement_import_sessions'),'statement review session table missing');
assert(migration.includes('CREATE TABLE statement_import_rows'),'statement review row table missing');
assert(controller.includes("status !== 'PENDING_REVIEW'"),'review lifecycle lock missing');
assert(controller.includes('INSERT IGNORE INTO bank_transactions'),'commit duplicate protection missing');
assert(controller.includes("validation_status IN ('VALID','WARNING')"),'commit validation gate missing');
assert(controller.includes('repairPendingReview'),'stale pending review repair missing');
assert(controller.includes("validation_status='REJECTED'"),'rejected-row persistence repair missing');
assert(controller.includes('NO_IMPORTABLE_TRANSACTIONS'),'clear no-importable-transactions response missing');
assert(/await db\.commit\(\);\r?\n\s+return res\.status\(422\)\.json/.test(controller),'no-importable repair must commit before response instead of rolling back');
assert(controller.includes('repaired_balance_markers'),'statement commit audit must record repaired balance markers');
assert(controller.includes('statement_import_uid, statement_row_id, review_source_status, manual_override'),'statement provenance must flow into canonical bank transactions');

assert(routes.includes('/statements/preview'),'statement preview route missing');
assert(routes.includes('/statement-reviews/:uid/commit'),'statement commit route missing');
assert(routes.includes("requireStepUp('IMPORT_BANK_TRANSACTIONS')"),'statement commit/import must retain step-up protection');

for(const marker of ['parseOfx','parseQif','parsePdfLines','parseXlsx','openStatementReview','Statement Import Wizard','Statement Vault','data-import-review']){
  assert(ui.includes(marker),`integrated statement workflow missing ${marker}`);
}
assert(ui.includes('/statements/preview'),'canonical Finance OS must stage statement rows before commit');
assert(ui.includes('Nothing is committed automatically'),'statement wizard must explain its non-posting staging boundary');
assert(ui.includes('staged for review. Nothing has been committed yet.'),'historical import must keep review-before-commit semantics');
assert(ui.includes('duplicates ·')&&ui.includes('rejected'),'review list must surface duplicate and rejected counts');
assert(ui.includes('function loadPdfJs()'),'PDF parser must be loaded lazily inside the canonical Finance OS');
assert(ui.includes('PDF parser timed out'),'PDF parser download must have a bounded timeout');
assert(ui.includes('This PDF does not expose transaction direction safely enough for automatic import'),'ambiguous PDF direction must fail closed');
assert(ui.includes('Nothing was imported.'),'failed-safe PDF parsing must explicitly confirm that nothing was imported');
assert(!html.includes('finance-import-wizard.js')&&!html.includes('finance-review-filter.js')&&!html.includes('finance-pdf-import-enhancer.js'),'canonical page must not reload retired statement frontend bundles');

console.log('Finance statement review architecture checks passed.');
