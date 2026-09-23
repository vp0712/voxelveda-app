'use strict';

const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const assert=(ok,message)=>{if(!ok)throw new Error(message)};

const app=read('app.js');
const html=read('public/finance-intelligence.html');
const ui=read('public/finance-master.js');
const css=read('public/finance-master.css');
const financeRoutes=read('routes/financeRoutes.js');
const report=read('controllers/financeReportBuilderController.js');
const transactionLifecycle=read('controllers/financeTransactionLifecycleController.js');

assert(html.includes('/finance-master.js')&&html.includes('/finance-master.css'),'one canonical Finance frontend must be loaded');
for(const old of ['premium-banking-app.js','finance-bank-app-v3.js','finance-bank-app-v4.js','finance-intelligence.js']){
  assert(!html.includes(old),'canonical Finance page must not load retired '+old);
}
assert(app.includes("app.get('/banking',noIndex,pageAuth(),redirectPreservingQuery('/finance-intelligence'))"),'legacy Banking page must redirect to Finance OS');

const requiredViews=[
 ['overview','Overview'],['personal','My Money'],['company','Company Finance'],['consolidated','Consolidated'],
 ['accounts','Accounts'],['transactions','Transactions'],['cash','Cash'],['currency','Currency Centre'],
 ['transfers','Transfers'],['refunds','Refunds'],['reimbursements','Reimbursements'],['debt','Borrow & Lend'],
 ['recurring','Recurring'],['history','History Import'],['statements','Statements'],['receipts','Receipts'],
 ['budgets','Budgets'],['savings','Savings Goals'],['forecast','Forecast'],['calendar','Cash Flow Calendar'],
 ['insights','Insights'],['rules','Rules'],['review','Review Centre'],['reconciliation','Reconciliation'],
 ['reports','Reports'],['setupcentre','Setup Centre'],['notifications','Notifications'],['team','Team Access'],
 ['connections','Banking Connections'],['settings','Finance Settings']
];
for(const [view,label] of requiredViews)assert(ui.includes("'"+view+"'")&&ui.includes(label),'Finance OS missing '+label);

for(const marker of [
 'function openAccountForm(','function openHistoricalImport(','function openStatementReview(','function saveManualMovement(',
 'function openSplitEditor(','function openReimbursementForm(','function openRefundLink(','function debtDetail(',
 'function currencyView(','function managementConversionCard(','function reportView(','function connectionsView(',
 'function setupCentreView(','function requestFinanceStepUp('
]) assert(ui.includes(marker),'Finance OS workflow missing '+marker);

assert(ui.includes('multiple required'),'historical import must allow multiple files for one account');
for(const ext of ['.csv','.pdf','.ofx','.qfx','.qif','.xlsx'])assert(ui.includes(ext),'historical import missing '+ext);
assert(ui.includes('Nothing is committed automatically.'),'statement history must be review-before-commit');
assert(ui.includes('Delete wrong entry')&&ui.includes('Deleted / Archived Transactions'),'wrong entries must be recoverably removable');
assert(transactionLifecycle.includes('archived_at=NOW()')&&!transactionLifecycle.includes('DELETE FROM bank_transactions'),'canonical transaction history must use recoverable logical deletion');

assert(ui.includes('Personal Banking')&&ui.includes('Company Banking'),'personal and company bank ledgers must be explicitly separated');
assert(ui.includes('Consolidated')&&ui.includes('ownership'),'consolidated view must retain ownership context');
assert(ui.includes('Personal wallet')||ui.includes('Personal planning & cash'),'owner-only personal cash planning must be distinct');

assert(ui.includes('Finance will not invent an exchange rate.'),'missing FX must fail closed');
assert(ui.includes('Never enter a bank password, bank PIN or bank OTP'),'Open Banking/security boundary must be visible');
assert(ui.includes('const MOBILE_NAV')&&ui.includes("'more','☰','More'"),'mobile must expose the complete module launcher');
assert(css.includes('.fm-mobile-nav')&&css.includes('@media(max-width:700px)'),'Finance OS must have a mobile layout');

for(const type of ['TRANSACTION_REGISTER','INCOME_VS_EXPENSE','CASH_FLOW','ACCOUNT_STATEMENT','CATEGORY','MERCHANT','CASH','TRANSFER','REFUND','REIMBURSEMENT','GST_SUMMARY','RECONCILIATION','DATA_QUALITY','PERSONAL_MONTHLY_SUMMARY','COMPANY_MONTHLY_SUMMARY']){
  assert(report.includes(type),'report backend missing '+type);
}
assert(report.includes('doc.switchToPage(index)'),'branded PDF header/footer must be applied across report pages');
assert(ui.includes('id="reportPdf"')&&ui.includes('id="reportCsv"')&&ui.includes('id="reportXlsx"'),'PDF CSV XLSX report actions are required');

assert(financeRoutes.includes("requireStepUp('IMPORT_BANK_TRANSACTIONS')"),'statement import must remain step-up protected');
assert(financeRoutes.includes("'/bank-transactions/:id/receipts'"),'receipt workflow route missing');
assert(financeRoutes.includes("'/bank-transactions/:id/splits'"),'split workflow route missing');
assert(financeRoutes.includes("'/bank-transactions/:id/transfer-links'"),'transfer workflow route missing');
assert(financeRoutes.includes("'/bank-transactions/:id/refund-links'"),'refund workflow route missing');
assert(financeRoutes.includes("'/reimbursements'"),'reimbursement workflow route missing');
assert(financeRoutes.includes("'/fx-rates'"),'FX evidence workflow route missing');
assert(financeRoutes.includes("'/personal-money/debts/:id'"),'Borrow/Lend detail route missing');

console.log('VOXEL_VEDA_FINANCE_ORIGINAL_REQUIREMENTS_ACCEPTANCE_OK');
