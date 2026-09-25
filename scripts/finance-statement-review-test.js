'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const assert=(ok,message)=>{if(!ok)throw new Error(message)};

const migration=read('migrations/20260915_finance_statement_staging_review.sql');
const pipeline=read('migrations/20260925_finance_ingestion_pipeline.sql');
const controller=read('controllers/statementImportController.js');
const routes=read('routes/financeRoutes.js');
const client=read('public/finance-master.js');
const html=read('public/finance-intelligence.html');

assert(migration.includes('CREATE TABLE statement_import_sessions')&&migration.includes('CREATE TABLE statement_import_rows'),'review staging tables are missing');
assert(pipeline.includes('statement_validation_results')&&pipeline.includes('statement_duplicate_candidates'),'review evidence tables are missing');
assert(controller.includes("status !== 'PENDING_REVIEW'"),'review lifecycle lock missing');
assert(controller.includes('INSERT IGNORE INTO bank_transactions'),'commit duplicate protection missing');
assert(controller.includes("validation_status IN ('VALID','WARNING')"),'commit validation gate missing');
assert(controller.includes('repairPendingReview')&&controller.includes('NO_IMPORTABLE_TRANSACTIONS'),'stale review repair is missing');
assert(controller.includes('source_statement_row_id')&&controller.includes('final_posted_transaction_id'),'row-to-ledger traceability is missing');
assert(routes.includes('/statement-imports'),'secure statement upload route missing');
assert(routes.includes('/statement-reviews/:uid/commit')&&routes.includes('/statement-reviews/:uid/reject'),'review decision routes are missing');
for(const marker of ['openStatementWizard','openHistoricalImport','openStatementReview','openStatementRowCorrection'])assert(client.includes(marker),'canonical Finance workflow missing '+marker);
assert(client.includes('data-review-filter')&&client.includes('UNCERTAIN'),'clickable review filters are missing');
assert(client.includes('source_snippet')&&client.includes('confidence_score'),'source evidence is not visible in review');
assert(client.includes('secure_document_id')&&client.includes('Open original statement'),'original statement link is missing');
assert(client.includes('data-review-select')&&client.includes('data-review-commit'),'row review controls are missing');
assert(!client.includes('opening balance is income'),'opening/closing balance markers must never be treated as income');
assert(html.includes('/finance-master.js')&&!html.includes('finance-import-wizard.js'),'review must remain in the canonical Finance UI');

console.log('Finance statement review architecture checks passed.');
