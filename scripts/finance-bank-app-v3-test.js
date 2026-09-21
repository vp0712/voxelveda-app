const fs=require('node:fs');
function read(p){return fs.readFileSync(p,'utf8')}
function assert(v,m){if(!v){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}
const html=read('public/finance-intelligence.html');
const css=read('public/finance-bank-app-v3.css');
const js=read('public/finance-bank-app-v3.js');

assert(html.includes('/finance-bank-app-v3.css?v=20260921-bank-v3'),'Finance Intelligence loads V3 banking theme');
assert(html.includes('/finance-bank-app-v3.js?v=20260921-bank-v3'),'Finance Intelligence loads V3 banking client');
assert(!html.includes('/finance-dashboard-v2.js?v=20260921-bank-dashboard'),'old dashboard renderer is not loaded');
for(const view of ['home','accounts','activity','payments','plan','insights','statements','reports','team','settings']){
  assert(html.includes('data-bank-view="'+view+'"'),'navigation contains '+view);
}
assert(html.includes('id="bankV3Drawer"'),'banking detail drawer exists');
assert(html.includes('id="bankV3Modal"'),'banking workflow modal exists');

for(const fn of ['renderHome','renderAccounts','renderActivity','renderPayments','renderPlan','renderInsights','renderStatements','renderReports','renderTeam','renderSettings']){
  assert(js.includes('function '+fn),'V3 contains '+fn);
}
assert(js.includes("api(OS+'/accounts/'+id)"),'account detail uses Banking OS account API');
assert(js.includes("api(FIN+'/transactions/'+id)"),'transaction detail uses finance transaction detail API');
assert(js.includes("api(FIN+'/statements/'+encodeURIComponent(uid)+'/report')"),'statement detail uses statement report API');
assert(js.includes("api(OS+'/payments'"),'payment drafts use Banking OS workflow API');
assert(js.includes("api(OS+'/spaces'"),'Money Spaces use Banking OS API');
assert(js.includes("api(OS+'/alerts'"),'bank alert preferences use Banking OS API');
assert(js.includes("api(OS+'/team')"),'team access data comes from Banking OS');
assert(js.includes("const STANDALONE = location.pathname === '/banking'"),'V3 supports standalone Banking route');
assert(js.includes("'/api/banking/intelligence'"),'standalone route uses delegated intelligence API');
assert(js.includes("'/api/banking/os'"),'standalone route uses delegated Banking OS API');
assert(js.includes("api(OS+'/capabilities')"),'provider capabilities are loaded from server');
assert(js.includes("payment_rails"),'payment rail capability is explicitly surfaced');
assert(js.includes('No money moves here.'),'payment draft UI states that workflow does not move funds');
assert(js.includes('filter(a=>a.currency===c)')||js.includes('filter(x=>x.currency===c)'),'currency-scoped banking views are enforced');
assert(!js.includes('$125,430.20'),'sample bank balance is not hard-coded');
assert(!js.includes('$24,530.00'),'sample income is not hard-coded');
assert(css.includes('.bank-v3-drawer'),'bank-style detail drawer is styled');
assert(css.includes('.bank-table'),'bank transaction table is styled');
assert(css.includes('@media(max-width:700px)'),'mobile bank navigation is supported');
if(process.exitCode)process.exit(process.exitCode);
console.log('Finance Bank App V3 regression contract passed.');
