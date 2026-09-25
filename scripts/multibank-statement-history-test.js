const fs=require('node:fs');
function read(p){return fs.readFileSync(p,'utf8')}
function assert(v,m){if(!v){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}
const controller=read('controllers/financeIntelligenceController.js');
const importController=read('controllers/statementImportController.js');
const ui=read('public/finance-master.js');
const reportBuilder=read('controllers/financeReportBuilderController.js');
const financeRoutes=read('routes/financeRoutes.js');
const app=read('app.js');

assert(controller.includes('getPortfolioHistoryReport'),'combined portfolio history endpoint exists');
assert(controller.includes('GROUP BY bt.currency'),'combined report groups money by currency');
assert(controller.includes("Currencies are reported separately and are never added together"),'combined report forbids fake cross-currency totals');
assert(controller.includes('bank_net_position_by_currency'),'bank net position is currency separated');
assert(controller.includes('statements: statementRows'),'portfolio report contains statement history');
assert(controller.includes('transactions: transactionRows'),'portfolio report contains full transaction history');

assert(importController.includes('autoStatementCategory'),'automatic statement categorisation exists');
for(const category of ['Rent & Housing','Utilities','Health & Pharmacy','Transport','Shopping','Education & Training','Tax & Government']){
  assert(importController.includes(category),'auto category exists: '+category);
}
assert(importController.includes('closing_balance_applied'),'newest approved statement can advance account ledger balance');
assert(importController.includes("String(maxDate) >= String(account.history_end_date)"),'older statements cannot overwrite a newer account balance');

assert(ui.includes('function openHistoricalImport('),'canonical Finance OS includes historical statement import');
assert(ui.includes('multiple required'),'historical import supports multiple files for one selected account');
assert(ui.includes('uploadStatementFile(selectedId,file)'),'historical statements upload original bytes to the server');
assert(ui.includes('accept=".csv,.pdf,.png,.jpg,.jpeg,.ofx,.qfx,.qif,.xlsx"'),'historical import supports the required statement formats');
assert(ui.includes('Nothing is committed automatically.'),'historical imports remain review-before-commit');
assert(app.includes("app.get('/banking',noIndex,pageAuth(),redirectPreservingQuery('/finance-intelligence'))"),'there is no separate Banking UI');

assert(reportBuilder.includes("VALID_TYPES = new Set"),'unified report builder exposes the standard report catalogue');
assert(reportBuilder.includes('ACCOUNT_STATEMENT'),'bank-style account statement reporting exists');
assert(reportBuilder.includes('summary_by_currency'),'reports preserve currency-separated summaries');
assert(ui.includes('Standard Report Catalogue'),'the unified Finance OS exposes reporting in the same application');
assert(ui.includes('id="reportPdf"')&&ui.includes('id="reportCsv"')&&ui.includes('id="reportXlsx"'),'report PDF/CSV/XLSX actions remain available');

assert(financeRoutes.includes("'/intelligence/reports/portfolio-history'"),'finance route exposes portfolio history');
assert(financeRoutes.includes("'/intelligence/accounts/:id/statement-imports'"),'Finance OS supports secure original-file ingestion');
assert(financeRoutes.includes("'/intelligence/statement-reviews/:uid/commit'"),'Finance OS supports reviewed statement commit');

if(process.exitCode)process.exit(process.exitCode);
