const fs=require('node:fs');
function read(p){return fs.readFileSync(p,'utf8')}
function assert(v,m){if(!v){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}
const html=read('public/finance-intelligence.html');
const css=read('public/finance-bank-app-v3.css');
const js=read('public/finance-bank-app-v3.js');
const premium=read('public/premium-banking-app.js');

assert(html.includes('fi-bank-sidebar'),'Finance Intelligence keeps bank-style navigation shell');
for(const view of ['home','accounts','activity','payments','plan','insights','statements','reports','team','settings']){
  assert(html.includes('data-bank-view="'+view+'"'),'bank app navigation contains '+view);
}
assert(html.includes('id="bankAppV3"'),'V3 bank application root exists');
assert(html.includes('id="bankV3Drawer"'),'detail drawer exists');
assert(html.includes('id="bankV3Modal"'),'banking workflow modal exists');
assert(html.includes('/finance-bank-app-v3.css?v=20260921-bank-v3'),'V3 banking CSS is cache-versioned');
assert(html.includes('/finance-bank-app-v3.js?v=20260921-bank-v3'),'V3 banking JS is cache-versioned');
assert(!html.includes('/finance-dashboard-v2.js?v=20260921-bank-dashboard'),'V2 renderer is not loaded');

assert(css.includes('.bank-balance-hero'),'bank-style balance hero exists');
assert(css.includes('.bank-table'),'bank transaction table styling exists');
assert(css.includes('.bank-v3-drawer'),'account/transaction drawer styling exists');
assert(css.includes('@media(max-width:700px)'),'mobile bank layout exists');

for(const fn of ['renderHome','renderAccounts','renderActivity','renderPayments','renderPlan','renderInsights','renderStatements','renderReports','renderTeam','renderSettings']){
  assert(js.includes('function '+fn),'V3 renders '+fn);
}
assert(js.includes("api(OS+'/command-center')"),'bank app reads command centre data');
assert(js.includes("api(FIN+'/transactions?scope='"),'bank app reads real transaction ledger');
assert(js.includes("api(FIN+'/statements?scope='"),'bank app reads statement library');
assert(js.includes("api(OS+'/team')"),'bank app reads delegated access data');
assert(js.includes("api(OS+'/capabilities')"),'bank app reads provider capabilities');
assert(js.includes("No money moves here."),'payment workflow is explicitly non-executing without provider rail');
assert(!js.includes('$125,430.20'),'reference-image sample balances are not hard-coded');
assert(!js.includes('$24,530.00'),'reference-image sample income is not hard-coded');
assert(premium.includes("document.getElementById('bankAppV3')"),'legacy Banking client yields to unified V3 UI');
if(process.exitCode)process.exit(process.exitCode);
