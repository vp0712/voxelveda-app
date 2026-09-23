'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const assert=(ok,message)=>{if(!ok)throw new Error(message)};

const migration=read('migrations/20260918_advanced_au_banking_platform.sql');
const reparseMigration=read('migrations/20260918_statement_review_reparse_tracking.sql');
const reviewLedgerMigration=read('migrations/20260918_bank_grade_review_company_ledger.sql');
const cashBackfillMigration=read('migrations/20260918_cash_category_backfill.sql');
const budgetMigration=read('migrations/20260918_premium_banking_budgets.sql');
const provider=read('services/openBankingProviderService.js');
const sync=read('services/advancedBankingSyncService.js');
const scheduler=read('services/bankSyncScheduler.js');
const controller=read('controllers/advancedBankingController.js');
const statementController=read('controllers/statementImportController.js');
const financeIntelligence=read('controllers/financeIntelligenceController.js');
const financeRoutes=read('routes/financeRoutes.js');
const bankingRoutes=read('routes/bankingPortalRoutes.js');
const integrationRoutes=read('routes/integrationWebhookRoutes.js');
const sanitizer=read('middleware/statementPreviewSanitizer.js');
const ui=read('public/finance-master.js');
const pdf=ui;
const css=read('public/finance-master.css');
const html=read('public/finance-intelligence.html');
const renderer=read('services/globalBrandRenderer.js');
const permissions=read('config/permissionCatalog.js');
const databaseConfig=read('config/databaseConfig.js');
const adminPage=read('public/admin-dashboard.html');
const adminClient=read('public/admin-dashboard.js');
const staffPage=read('public/staff-dashboard.html');
const appServer=read('app.js');

for(const marker of ['bank_connection_accounts','bank_consent_receipts','bank_sync_events','canonical_fingerprint','provider_transaction_id','reconciliation_status','extraction_diagnostics_json'])assert(migration.includes(marker),`migration missing ${marker}`);
assert(reparseMigration.includes('updated_at'),'statement review reparse tracking must be additive');
for(const marker of ['manual_override','override_original_json','statement_import_uid','statement_row_id','review_source_status'])assert(reviewLedgerMigration.includes(marker),`bank-grade review migration missing ${marker}`);
for(const marker of ['finance_bank_budgets','ownership_scope','category','cycle','limit_amount'])assert(budgetMigration.includes(marker),`bank budget migration missing ${marker}`);

assert(provider.includes("adapter_status: 'READY'"),'Basiq adapter must be explicitly ready');
assert(provider.includes("scope: 'SERVER_ACCESS'")&&provider.includes("scope: 'CLIENT_ACCESS'"),'Basiq server/client consent token scopes missing');
assert(provider.includes('BANK_DATA_API_KEY')&&provider.includes('BASIQ_API_KEY'),'server-side Basiq secret configuration missing');
assert(!ui.includes('BANK_DATA_API_KEY')&&!ui.includes('BASIQ_API_KEY'),'provider secrets must never appear in unified Finance UI');
assert(sync.includes('canonicalFingerprint')&&sync.includes('findCrossSourceMatch'),'cross-source Open Banking dedupe missing');
assert(sync.includes('INSERT IGNORE INTO bank_transactions'),'idempotent canonical transaction insert missing');
assert(sync.includes('source_type,source_provider'),'bank_transactions must remain canonical source ledger');
assert(scheduler.includes('BANK_SYNC_SCHEDULE_ENABLED')||scheduler.includes('scheduledSyncEnabled'),'scheduled bank sync gate missing');
assert(controller.includes('bank_credentials_stored')||controller.includes('bank credentials'),'bank credential privacy boundary missing');
assert(controller.includes('does not claim independent CDR accreditation'),'CDR non-claim boundary missing');

for(const permission of ['VIEW_PERSONAL_BANKING','VIEW_BUSINESS_BANKING','CONNECT_BANK_ACCOUNT','SYNC_BANK_ACCOUNT','MANAGE_BANK_CONNECTION'])assert(permissions.includes(permission),`permission catalogue missing ${permission}`);
assert(integrationRoutes.includes("router.use('/banking', auth, advancedBankingRoutes)"),'authenticated advanced banking API mount missing');
assert(bankingRoutes.includes("requireAnyPermission('VIEW_BANKING','VIEW_PERSONAL_BANKING','VIEW_BUSINESS_BANKING')"),'Banking API view permission missing');
assert(bankingRoutes.includes("requireAnyPermission('APPROVE_PAYMENT')"),'Banking payment approval permission missing');

assert(sanitizer.includes('unreadable_date_rows'),'row-level unreadable-date diagnostics missing');
assert(!sanitizer.includes('STATEMENT_DATES_UNREADABLE'),'one unreadable row must not fail the whole statement');
for(const marker of ['loadPdfJs','pdfLines','parsePdfLines','parseStatement'])assert(pdf.includes(marker),`canonical PDF parser missing ${marker}`);
assert(pdf.includes('PDF parser timed out'),'PDF parser download must have a bounded failure path');
assert(pdf.includes('This PDF does not expose transaction direction safely enough for automatic import.'),'ambiguous PDF direction must fail closed');
assert(pdf.includes('/\\bDR\\b/i')&&pdf.includes('/\\bCR\\b/i'),'canonical PDF parsing must recognize explicit debit/credit evidence');
assert(!pdf.includes('opening balance is income'),'balance markers must never be reclassified as income');
for(const marker of ['STATEMENT_PREVIEW_REPARSED','existingImportable === 0','parserChanged','STATEMENT_REJECTED_ROW_OVERRIDDEN','CORRECTED_ROW_DUPLICATE','BALANCE_MARKER_LOCKED','override_original_json'])assert(statementController.includes(marker),`statement control missing ${marker}`);
assert(statementController.includes('statement_import_uid, statement_row_id, review_source_status, manual_override'),'statement provenance must flow into canonical bank transactions');

assert(financeIntelligence.includes('exports.getTransactions'),'company/personal transaction API missing');
assert(financeIntelligence.includes('exports.getBankingDashboard'),'unified Banking dashboard API missing');
assert(financeIntelligence.includes('balances_by_currency')&&financeIntelligence.includes('currency_rule'),'multi-currency dashboard must preserve currencies');
assert(financeIntelligence.includes('exports.getBankingBudgets')&&financeIntelligence.includes('exports.saveBankingBudget'),'bank budget APIs missing');
assert(financeRoutes.includes('/intelligence/banking-dashboard')&&financeRoutes.includes('/intelligence/budgets'),'Banking dashboard/budget routes missing');
assert(financeRoutes.includes('/intelligence/transactions/:id'),'transaction management route missing');
assert(financeRoutes.includes("requireStepUp('IMPORT_BANK_TRANSACTIONS')"),'statement import/correction must retain step-up protection');

assert(html.includes('/finance-master.js')&&html.includes('FINANCE OPERATING SYSTEM'),'single Finance OS page/client contract missing');
for(const marker of ['FINANCE COMMAND CENTRE','Statement Import Wizard','Statement Vault','SPENDING & COST INTELLIGENCE','BANKING OPERATIONS','Money Spaces','Beneficiaries','Payment workflow','Banking Connections','CURRENT CLASSIFICATION','ORIGINAL BANK DATA'])assert(ui.includes(marker),`unified Finance OS missing ${marker}`);
assert(ui.includes('const MOBILE_NAV')&&ui.includes("'more','☰','More'"),'unified Finance mobile navigation incomplete');
assert(ui.includes('External bank payment execution is not enabled')||ui.includes('provider-capability gated'),'external bank execution boundary missing');
assert(css.includes('.fm-mobile-nav')&&css.includes('.fm-command-centre')&&css.includes('.fm-intelligence-grid'),'unified Finance mobile/intelligence styles missing');
assert(!ui.includes('window.alert('),'Finance OS must not use blocking browser alerts');
assert(ui.includes('function notice(')&&ui.includes('fmNotice'),'Finance OS inline feedback missing');

assert(cashBackfillMigration.includes("category='Cash'"),'historical cash backfill must set Cash category');
assert(cashBackfillMigration.includes('ATM|CASH WITHDRAWAL'),'cash backfill must remain limited to obvious patterns');
assert(databaseConfig.includes("dateStrings: ['DATE']")&&databaseConfig.includes("date_transport: 'YYYY-MM-DD_STRING'"),'MySQL DATE transport boundary missing');
const {buildDatabaseConfig}=require('../config/databaseConfig');
const dateBoundary=buildDatabaseConfig({DB_HOST:'db.example',DB_USER:'app',DB_PASSWORD:'x',DB_NAME:'voxelveda'});
assert(Array.isArray(dateBoundary.options.dateStrings)&&dateBoundary.options.dateStrings[0]==='DATE','DATE-only mysql transport guard inactive');
assert(!dateBoundary.options.dateStrings.includes('DATETIME'),'DATETIME transport must remain unchanged');

assert(adminPage.includes('Finance OS')&&adminPage.includes('Open Finance OS'),'admin shell must point users to the unified Finance OS');
assert(adminClient.includes("'/finance-intelligence?source=app'"),'installed app must open canonical Finance OS');
assert(staffPage.includes('href="/finance-intelligence#bankops"'),'staff Banking permission entry must open Finance OS Banking Operations');
assert(appServer.includes("app.get('/banking',noIndex,pageAuth(),redirectPreservingQuery('/finance-intelligence'))"),'/banking must be compatibility redirect only');
assert(!appServer.includes('premium-banking-app.js')&&!appServer.includes('finance-intelligence.js'),'retired Finance/Banking frontend assets must not be active server assets');
assert(!renderer.includes('premium-banking-app')&&!renderer.includes('ADVANCED_BANKING_JS'),'global renderer must not reference retired premium Banking frontend');
assert(!renderer.includes('rendered.includes(FINANCE_PDF_ENHANCER_JS)'),'legacy PDF enhancer must remain uninjected');
assert(renderer.includes("const CANONICAL_LOGO = '/logo.png'"),'canonical original logo contract changed');

console.log('Advanced Australian banking platform unified Finance OS checks passed.');
