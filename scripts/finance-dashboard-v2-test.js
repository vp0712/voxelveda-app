const fs=require('node:fs');
function read(p){return fs.readFileSync(p,'utf8')}
function assert(v,m){if(!v){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}
const html=read('public/finance-intelligence.html');
const css=read('public/finance-bank-app-v4.css');
const js=read('public/finance-bank-app-v4.js');
const premium=read('public/premium-banking-app.js');
assert(html.includes('id="bankAppV4"'),'V4 bank application root exists');
assert(html.includes('/finance-bank-app-v4.css?v=20260921-bank-v4'),'V4 CSS is loaded');
assert(html.includes('/finance-bank-app-v4.js?v=20260921-bank-v4'),'V4 JS is loaded');
assert(!html.includes('/finance-bank-app-v3.js?v=20260921-bank-v3'),'V3 renderer is retired from Finance Intelligence');
for(const v of ['home','accounts','activity','payments','plan','wealth','statements','insights','team','settings'])assert(html.includes('data-bank-view="'+v+'"'),'V4 navigation contains '+v);
assert(html.includes('id="bankV4Drawer"'),'V4 detail drawer exists');
assert(html.includes('id="bankV4Modal"'),'V4 workflow modal exists');
assert(css.includes('.v4-account-carousel'),'account-first banking carousel exists');
assert(css.includes('.v4-tabs'),'banking tabs are styled');
assert(css.includes('.v4-table'),'ledger table is styled');
assert(css.includes('@media(max-width:700px)'),'mobile bank navigation exists');
assert(js.includes("api(OS+'/command-center')"),'V4 loads command centre');
assert(js.includes("api(FIN+'/transactions?scope='"),'V4 loads real transaction ledger');
assert(js.includes("api(FIN+'/statements?scope='"),'V4 loads statement vault');
assert(js.includes("api(OS+'/team')"),'V4 loads delegated banking access');
assert(js.includes("api(OS+'/capabilities')"),'V4 loads provider capabilities');
assert(js.includes('Workflow, not fake money movement.')||js.includes('No funds move here.'),'payment UI clearly distinguishes workflow from money movement');
assert(!js.includes('$125,430.20'),'reference sample balance is not hard-coded');
assert(!js.includes('$24,530.00'),'reference sample income is not hard-coded');
assert(premium.includes("document.getElementById('bankAppV4')"),'legacy Banking client yields to V4');
if(process.exitCode)process.exit(process.exitCode);
