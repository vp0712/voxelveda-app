const fs=require('node:fs');
function read(p){return fs.readFileSync(p,'utf8')}
function assert(v,m){if(!v){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}
const html=read('public/finance-intelligence.html');
const css=read('public/finance-bank-app-v5.css');
const js=read('public/finance-bank-app-v5.js');
const premium=read('public/premium-banking-app.js');

assert(html.includes('id="bankAppV5"'),'V5 bank application root exists');
assert(html.includes('/finance-bank-app-v5.css?v=20260921-bank-v5'),'V5 CSS is loaded');
assert(html.includes('/finance-bank-app-v5.js?v=20260921-bank-v5'),'V5 JS is loaded');
for(const v of ['home','accounts','payments','activity','more'])assert(html.includes('data-bank-view="'+v+'"'),'V5 primary navigation contains '+v);
assert(html.includes('id="bankV5Drawer"'),'V5 detail drawer exists');
assert(html.includes('id="bankV5Modal"'),'V5 workflow modal exists');
assert(html.includes('id="bankNotificationButton"'),'V5 has notification centre button');

assert(css.includes('.v5-account-carousel'),'account carousel exists');
assert(css.includes('.v5-account-switcher'),'account switcher exists');
assert(css.includes('.v5-home-actions'),'daily banking quick actions exist');
assert(css.includes('.v5-more-grid'),'secondary More hub exists');
assert(css.includes('.v5-tabs'),'banking tabs are styled');
assert(css.includes('.v5-table'),'ledger table is styled');
assert(css.includes('@media(max-width:700px)'),'mobile banking navigation exists');

assert(js.includes("api(OS+'/command-center')"),'V5 loads command centre');
assert(js.includes("api(FIN+'/transactions?scope='"),'V5 loads real transaction ledger');
assert(js.includes("api(FIN+'/statements?scope='"),'V5 loads statement vault');
assert(js.includes("api(OS+'/team')"),'V5 loads delegated banking access');
assert(js.includes("api(OS+'/capabilities')"),'V5 loads provider capabilities');
assert(js.includes('function notificationCenter'),'V5 has notification centre behavior');
assert(js.includes('data-home-account'),'V5 home supports account switching');
assert(js.includes('No funds move here.')||js.includes('Workflow, not fake money movement.'),'payment UI does not pretend funds move without a rail');
assert(!js.includes('$125,430.20'),'reference sample balance is not hard-coded');
assert(!js.includes('$24,530.00'),'reference sample income is not hard-coded');
assert(premium.includes("document.getElementById('bankAppV5')"),'legacy Banking client yields to V5');
if(process.exitCode)process.exit(process.exitCode);
console.log('Finance Bank App V5 compatibility contract passed.');
