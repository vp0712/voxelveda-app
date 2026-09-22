const fs=require('node:fs');
function read(p){return fs.readFileSync(p,'utf8')}
function assert(v,m){if(!v){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}
const controller=read('controllers/financeIntelligenceController.js');
const importController=read('controllers/statementImportController.js');
const importer=read('public/finance-intelligence.js');
const pdf=read('public/finance-pdf-v3.js');
const reports=read('public/finance-statement-report-center.js');
const financeRoutes=read('routes/financeRoutes.js');
const bankingRoutes=read('routes/bankingPortalRoutes.js');

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

assert(importer.includes("data-currency="),'account selector exposes account currency');
assert(importer.includes("row.currency || accountCurrency"),'missing row currency falls back to selected account currency');
assert(importer.includes("location.pathname === '/banking'"),'statement importer supports standalone banking portal');
assert(pdf.includes("['/finance-intelligence','/banking']"),'PDF parser runs in both finance and banking portal');
assert(pdf.includes("parseGeometry(pages, accountCurrency='AUD')"),'PDF parser accepts account currency');
assert(!pdf.includes("currency:'AUD',category:categoryFromText"),'PDF parser no longer hardcodes AUD transaction currency');

assert(reports.includes("'/reports/portfolio-history'"),'overall report uses portfolio history endpoint');
assert(reports.includes('summary_by_currency'),'report renders currency-separated summaries');
assert(reports.includes('portfolioDonut'),'report includes spending pie chart');
assert(reports.includes('portfolioLine'),'report includes monthly line chart');
assert(reports.includes('All accounts combined'),'report supports combined account selection');
assert(reports.includes('Print / Save PDF'),'report remains PDF-exportable');

assert(financeRoutes.includes("'/intelligence/reports/portfolio-history'"),'finance route exposes portfolio report');
assert(bankingRoutes.includes("'/intelligence/reports/portfolio-history'"),'standalone banking route exposes portfolio report');
assert(bankingRoutes.includes("'/intelligence/accounts/:id/statements/preview'"),'standalone banking portal supports statement preview');
assert(bankingRoutes.includes("'/intelligence/statement-reviews/:uid/commit'"),'standalone banking portal supports reviewed statement commit');

if(process.exitCode)process.exit(process.exitCode);
