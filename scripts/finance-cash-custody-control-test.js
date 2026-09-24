'use strict';
const assert=require('assert');
const fs=require('fs');
const routes=fs.readFileSync('routes/financeRoutes.js','utf8');
const controller=fs.readFileSync('controllers/financeCashCustodyController.js','utf8');
const service=fs.readFileSync('services/financeCashCustodyService.js','utf8');
const cash=fs.readFileSync('controllers/financeCashControlController.js','utf8');
const migration=fs.readFileSync('migrations/20260924_finance_cash_custody_control.sql','utf8');
const schema=fs.readFileSync('services/financeSchema.js','utf8');
const master=fs.readFileSync('public/finance-master.js','utf8');
const advanced=fs.readFileSync('public/finance-advanced-control.js','utf8');

for(const route of [
  "router.get('/cash-control/custody'","router.post('/cash-control/custody'",
  "router.post('/cash-control/custody/:uid/return'","router.get('/cash-control/custody/:uid/expense-candidates'",
  "router.post('/cash-control/custody/:uid/clear-expense'","router.post('/cash-control/custody/:uid/cancel'",
  "router.post('/cash-control/custody/events/:eventUid/reverse'"
]) assert(routes.includes(route),'Cash Custody route missing: '+route);
for(const step of ['ISSUE_CASH_CUSTODY','CLEAR_CASH_CUSTODY','CANCEL_CASH_CUSTODY','REVERSE_CASH_CUSTODY_EVENT'])
  assert(routes.includes("requireStepUp('"+step+"')"),'Sensitive Cash Custody action must require step-up: '+step);

assert(migration.includes('CREATE TABLE IF NOT EXISTS finance_cash_custody_cases'),'Cash Custody case migration missing.');
assert(migration.includes('CREATE TABLE IF NOT EXISTS finance_cash_custody_events'),'Cash Custody event migration missing.');
assert(schema.includes('CREATE TABLE IF NOT EXISTS finance_cash_custody_cases'),'Cash Custody schema bootstrap missing.');
assert(schema.includes('CREATE TABLE IF NOT EXISTS finance_cash_custody_events'),'Cash Custody event bootstrap missing.');
assert(!/\b(?:DROP|TRUNCATE)\b/i.test(migration),'Cash Custody migration must be additive.');

assert(service.includes('outstandingForSource'),'Cash count integration requires custody outstanding calculation.');
assert(cash.includes('cashCustody.outstandingForSource'),'Physical cash count must deduct active custody from expected on-site cash.');
assert(controller.includes('ledger_balance_unchanged:true'),'Custody actions must document that ledger balance is unchanged.');
assert(controller.includes('duplicate_expense_created:false'),'Expense clearance must explicitly avoid duplicate spending.');
assert(controller.includes("event_type='EXPENSE_CLEARANCE'"),'Cash Custody must link posted expense clearance.');
assert(controller.includes("active_link_key=NULL"),'Reversal must release an expense link without deleting history.');
assert(!controller.includes('DELETE FROM finance_cash_custody'),'Cash Custody history must never be hard deleted.');

for(const marker of ['Cash Custody & Petty Cash Register','Issue cash to custodian','Clear posted expense','data-cash-custody-event-reverse'])
  assert(master.includes(marker),'Cash Custody UI missing: '+marker);
assert(master.includes("['cashCustody',API+'/cash-control/custody']"),'Canonical Finance OS must hydrate Cash Custody.');
assert(advanced.includes('/api/finance/cash-control/custody'),'Advanced Control must hydrate Cash Custody.');
assert(advanced.includes('function cashCustodyControl()'),'Advanced Cash Custody control is missing.');
console.log('FINANCE_CASH_CUSTODY_CONTROL_OK');
