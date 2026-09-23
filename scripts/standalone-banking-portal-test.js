const fs=require('node:fs');
function read(p){return fs.readFileSync(p,'utf8')}
function assert(v,m){if(!v){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}
const app=read('app.js');
const routes=read('routes/bankingPortalRoutes.js');
const ui=read('public/premium-banking-app.js');
const financeHtml=read('public/finance-intelligence.html');
const staff=read('public/staff.js');
const html=read('public/staff-dashboard.html');

assert(app.includes("app.get('/banking',noIndex,pageAuth(),redirectPreservingQuery('/finance-intelligence'))"),'legacy /banking entry must redirect into the unified Finance OS');
assert(app.includes("app.use('/api/banking',auth,bankingPortalRoutes)"),'standalone banking API is mounted independently');
assert(!routes.includes("requirePermission('VIEW_FINANCE')"),'standalone banking router does not require VIEW_FINANCE');
assert(routes.includes("requireAnyPermission('VIEW_BANKING','VIEW_PERSONAL_BANKING','VIEW_BUSINESS_BANKING')"),'banking view permission is required');
assert(routes.includes("requireAnyPermission('EDIT_BANK_DETAILS','CONNECT_BANK_ACCOUNT','MANAGE_BANK_CONNECTION')"),'bank consent remains privileged');
assert(routes.includes("requireAnyPermission('APPROVE_PAYMENT')"),'payment approval remains explicitly permission-gated');
assert(financeHtml.includes('/finance-master.js'),'canonical Finance route must use the unified Finance OS frontend');
assert(financeHtml.includes('FINANCE OPERATING SYSTEM'),'standalone /banking route must not render a duplicate Banking dashboard');
assert(!financeHtml.includes('finance-bank-app-v5'),'retired V5 frontend must not be reintroduced');
assert(ui.includes("const STANDALONE = location.pathname === '/banking'"),'standalone API mode is explicit');
assert(ui.includes("'/api/banking/intelligence'"),'standalone intelligence API is used');
assert(ui.includes("'/api/banking/os'"),'standalone Banking OS API is used');
assert(html.includes('permission-banking hidden-section'), 'staff portal contains permission-gated Banking entry');
assert(html.includes('href="/banking"'), 'staff portal Banking entry points to standalone page');
assert(staff.includes("hasPermission('VIEW_BANKING')"),'staff Banking visibility honours canonical banking permission');
assert(staff.includes("setPermissionVisibility('.permission-banking', canUseBanking)"),'staff Banking UI visibility is enforced');
if(process.exitCode)process.exit(process.exitCode);
