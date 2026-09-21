const fs=require('node:fs');
function read(p){return fs.readFileSync(p,'utf8')}
function assert(v,m){if(!v){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}
const html=read('public/finance-intelligence.html');
const css=read('public/finance-dashboard-v2.css');
const js=read('public/finance-dashboard-v2.js');
const premium=read('public/premium-banking-app.js');

assert(html.includes('fi-bank-sidebar'),'Finance Intelligence has bank-style sidebar');
for(const label of ['Dashboard','Accounts','Statements','Transactions','Categories','Cash Flow','Reports','AI Insights','Team Access','Settings']){
  assert(html.includes('>'+label+'</button>'),'sidebar contains '+label);
}
for(const id of ['fiKpiGrid','fiIncomeExpenseChart','fiCategoryDonut','fiCashflowBars','fiAccountSummary','fiCurrencySummary','fiObligations','fiAiInsights','fiRecentTransactions','fiMonthlyComparison','fiReportShortcuts']){
  assert(html.includes('id="'+id+'"'),'dashboard surface exists: '+id);
}
assert(html.includes('/finance-dashboard-v2.css?v=20260921-bank-dashboard'),'new dashboard CSS is cache-versioned');
assert(html.includes('/finance-dashboard-v2.js?v=20260921-bank-dashboard'),'new dashboard JS is cache-versioned');
assert(css.includes('.fi-kpi-grid'),'premium KPI grid styling exists');
assert(css.includes('.fi-bank-sidebar'),'bank-style navigation styling exists');
assert(css.includes('@media(max-width:720px)'),'mobile navigation/layout exists');

assert(js.includes("api(dashboardUrl())"),'dashboard reads real banking dashboard API');
assert(js.includes("api(FIN+'/statement-warehouse?scope='"),'dashboard reads real statement warehouse');
assert(js.includes("api(FIN+'/insights?scope='"),'dashboard reads real finance insights');
assert(js.includes("api(OS+'/command-center')"),'dashboard reads real obligations/approval data');
assert(js.includes("Currencies")||js.includes("renderCurrencies"),'multi-currency surface is rendered');
assert(!js.includes('$125,430.20'),'reference-image sample balances are not hard-coded');
assert(!js.includes('$24,530.00'),'reference-image sample income is not hard-coded');
assert(js.includes("filter(r=>r.currency===state.currency)"),'analytics remain currency scoped');
assert(premium.includes("if (location.pathname !== '/banking'"),'standalone premium Banking app no longer competes with Finance Intelligence');
if(process.exitCode)process.exit(process.exitCode);
