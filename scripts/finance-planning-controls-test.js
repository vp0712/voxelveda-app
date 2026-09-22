'use strict';

const fs=require('node:fs');
const path=require('node:path');
function read(file){return fs.readFileSync(path.join(__dirname,'..',file),'utf8')}
function assert(value,message){if(!value)throw new Error(message)}

const client=read('public/finance-master.js');
const routes=read('routes/financeRoutes.js');
const banking=read('controllers/bankingOperatingSystemController.js');
const ops=read('controllers/financeOperationsController.js');

assert(client.includes("['forecast','◷','Forecast']"),'Forecast navigation is missing');
assert(client.includes("OS+'/cashflow-calendar?days=90'"),'90-day cash-flow calendar is not loaded');
assert(client.includes("API+'/accounting-periods'"),'accounting periods are not loaded');
assert(client.includes('function forecastView()'),'cash-flow calendar UI is missing');
assert(client.includes('internal payment instruction'),'forecast must not claim bank execution');
assert(client.includes('function accountingPeriodsCard()'),'accounting period control UI is missing');
assert(client.includes("confirmation=prompt('Type exactly: LOCK '+key)"),'exact accounting-period lock confirmation is missing');
assert(client.includes("API+'/accounting-periods/'+encodeURIComponent(id)+'/status"),'period status workflow is not wired');

assert(routes.includes("router.get('/banking-os/cashflow-calendar'"),'cash-flow calendar backend route is missing');
assert(routes.includes("router.get('/accounting-periods'"),'accounting-period list route is missing');
assert(routes.includes("router.post('/accounting-periods/:id/status'"),'accounting-period status route is missing');
assert(routes.includes("requireStepUp('CHANGE_ACCOUNTING_PERIOD')"),'accounting-period status change must remain step-up protected');

assert(banking.includes('exports.getCashflowCalendar'),'existing Banking OS cashflow calendar backend must be reused');
assert(banking.includes("!['COMPLETED','REJECTED','CANCELLED'].includes(p.status)"),'forecast must exclude terminal payment instruction states');
assert(ops.includes("const PERIOD_STATUSES = new Set(['OPEN', 'REVIEWING', 'READY', 'LOCKED'])"),'accounting period status contract changed unexpectedly');
assert(ops.includes('confirmation !== `LOCK ${period.period_key}`'),'server lock confirmation must remain exact');
assert(ops.includes('PERIOD_NOT_READY'),'server must block locking periods with unreconciled posted transactions');

console.log('FINANCE_PLANNING_CONTROLS_TEST_OK');
