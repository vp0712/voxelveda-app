const fs=require('node:fs');
function read(p){return fs.readFileSync(p,'utf8')}
function assert(v,m){if(!v){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}
const controller=read('controllers/bankingOperatingSystemController.js');
const routes=read('routes/financeRoutes.js');
const ui=read('public/premium-banking-app.js');
const css=read('public/premium-banking-app.css');

for(const term of ['getCommandCenter','getApprovalInbox','getCashflowCalendar','getAccountDetail','cancelPayment','archiveSpace']) assert(controller.includes(term),term+' exists');
assert(controller.includes('LIQUIDITY_30D_NEGATIVE'),'30-day liquidity risk signal exists');
assert(controller.includes('MERCHANT_CONCENTRATION'),'merchant concentration risk exists');
assert(controller.includes('SHORT_RUNWAY'),'cash runway warning exists');
assert(controller.includes('paymentVisibleTo'),'payment visibility is scoped');
assert(controller.includes('assertAccountVisible(req,accountId'), 'account detail enforces visibility');

for(const path of ['/banking-os/command-center','/banking-os/approval-inbox','/banking-os/cashflow-calendar','/banking-os/accounts/:id']) assert(routes.includes(path),path+' route exists');
assert(routes.includes("'/banking-os/payments/:uid/cancel'"),'payment cancel route exists');
assert(routes.includes("'/banking-os/spaces/:uid/archive'"),'space archive route exists');

for(const term of ['COMMAND CENTRE','90-day cash-flow calendar','openAccountDetail','data-pb-account-detail','Projected liquidity · 30d','Approval inbox']) assert(ui.includes(term),'UI includes '+term);
assert(ui.includes('20260919-banking-command-v1'),'banking CSS cache version advanced');
assert(css.includes('.vv-pb-command'),'command centre styling exists');
assert(css.includes('.vv-pb-calendar'),'cashflow calendar styling exists');
assert(css.includes('.vv-pb-account-modal'),'account drilldown styling exists');
if(process.exitCode)process.exit(process.exitCode);
