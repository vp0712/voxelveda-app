'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const migration = read('migrations/20260925_finance_ingestion_pipeline.sql');
const routes = read('routes/financeRoutes.js');
const bankingRoutes = read('routes/bankingPortalRoutes.js');
const ingestion = read('controllers/financeStatementIngestionController.js');
const worker = read('services/financeStatementIngestionWorker.js');
const parser = read('services/financeStatementParser.js');
const review = read('controllers/statementImportController.js');
const client = read('public/finance-master.js');
const server = read('server.js');

for (const table of ['finance_statement_import_jobs','statement_import_pages','statement_validation_results','statement_duplicate_candidates','processing_errors']) {
  assert(new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? ${table}`).test(migration), `durable ingestion table missing: ${table}`);
}
assert(!migration.includes('ADD COLUMN IF NOT EXISTS'), 'ingestion migration must avoid MySQL-incompatible ADD COLUMN IF NOT EXISTS syntax');
assert(migration.includes('information_schema.columns') && migration.includes('information_schema.statistics'), 'additive ingestion migration must be restart-safe after partial DDL');
assert(migration.includes("IF(@vv_col_sql='', 'SELECT 1', CONCAT('ALTER TABLE"), 'column additions must execute only when schema inspection finds missing columns');
for (const field of ['secure_document_id','source_bbox_json','source_snippet','confidence_score','final_posted_transaction_id']) {
  assert(migration.includes(field), `source lineage field missing: ${field}`);
}
assert(routes.includes("'/intelligence/accounts/:id/statement-imports'"), 'multipart ingestion endpoint missing');
assert(bankingRoutes.includes("'/intelligence/accounts/:id/statement-imports'"), 'standalone banking ingestion endpoint missing');
assert(bankingRoutes.includes("'/intelligence/statement-imports/mappings'"), 'standalone banking mapping-template endpoints missing');
assert(routes.includes('...financeStatementUpload'), 'ingestion endpoint must use bounded secure multipart middleware');
assert(ingestion.includes('detectStatementFile(body'), 'server must inspect file content');
assert(ingestion.includes("classification: 'RESTRICTED'"), 'original statement must be stored as restricted evidence');
assert(ingestion.includes('DUPLICATE_STATEMENT_FILE'), 'file-level idempotency is missing');
assert(ingestion.includes('legacyDisabled'), 'client-supplied row route must fail closed');
assert(worker.includes('FOR UPDATE SKIP LOCKED'), 'durable worker row claiming is missing');
assert(worker.includes('STALE_JOB_RECOVERY') && worker.includes('heartbeat_at'), 'worker heartbeat/stale recovery is missing');
assert(worker.includes('readDocumentBodyInternal'), 'worker must parse the stored original bytes');
assert(parser.includes("import('pdfjs-dist/legacy/build/pdf.mjs')"), 'server PDF parser is missing');
assert(parser.includes('createWorker') && parser.includes('ocrImage'), 'local OCR pipeline is missing');
assert(parser.includes('ExcelJS.Workbook') && !parser.includes('eval('), 'safe XLSX parser is missing');
assert(review.includes('source_statement_row_id') && review.includes('final_posted_transaction_id'), 'posted row lineage is incomplete');
assert(client.includes('uploadStatementFile') && client.includes('new FormData()'), 'UI must upload the original file');
assert(client.includes('/statement-imports/${encodeURIComponent(uid)}/status'), 'UI job polling is missing');
assert(client.includes("['ALL','All'") && client.includes("['UNCERTAIN','Uncertain'"), 'review counters must be filterable');
assert(client.includes('data-review-edit') && client.includes('/override'), 'rejected-row correction workflow is missing');
assert(server.includes('FINANCE_STATEMENT_DURABLE_STORAGE_REQUIRED'), 'production durable-storage gate is missing');
assert(server.includes('finance_ingestion_worker'), 'Finance worker readiness state is missing');

console.log('FINANCE_STATEMENT_INGESTION_ARCHITECTURE_OK');
