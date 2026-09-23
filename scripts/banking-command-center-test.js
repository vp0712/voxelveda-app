'use strict';
const fs=require('node:fs');
function read(p){return fs.readFileSync(p,'utf8')}
function assert(v,m){if(!v){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}
const controller=read('controllers/bankingOperatingSystemController.js');
const routes=read('routes/financeRoutes.js');
const ui=read('public/finance-master.js');
const css=read('public/finance-master.css');

for(const term of ['getCommandCenter','getApprovalInbox','getCashflowCalendar','getAccountDetail','cancelPayment','archiveSpace'])assert(controller.includes(term),term+' exists');
assert(controller.includes('LIQUIDITY_30D_NEGATIVE'),'30-day liquidity risk signal exists');
assert(controller.includes('MERCHANT_CONCENTRATION'),'merchant concentration risk exists');
assert(controller.includes('SHORT_RUNWAY'),'cash runway warning exists');
assert(controller.includes('paymentVisibleTo'),'payment visibility is scoped');
assert(controller.includes('assertAccountVisible(req,accountId'),'account detail enforces visibility');

for(const p of ['/banking-os/command-center','/banking-os/approval-inbox','/banking-os/cashflow-calendar','/banking-os/accounts/:id'])assert(routes.includes(p),p+' route exists');
assert(routes.includes("'/banking-os/payments/:uid/cancel'"),'payment cancel route exists');
assert(routes.includes("'/banking-os/spaces/:uid/archive'"),'space archive route exists');

for(const term of ['Banking Command Centre','Approval Inbox','30d projected','runway ','Banking attention','Overdue obligations','openAccountDetail'])assert(ui.includes(term),'unified Finance OS includes '+term);
assert(ui.includes("['os',OS+'/command-center']"),'Finance OS hydrates command-centre intelligence');
assert(ui.includes("['cashflowCalendar',OS+'/cashflow-calendar?days=90']"),'Finance OS hydrates 90-day cash-flow calendar');
assert(css.includes('.fm-command-centre')&&css.includes('.fm-kpi'),'unified command and KPI styling exists');
if(process.exitCode)process.exit(process.exitCode);
