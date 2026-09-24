'use strict';
const assert=require('assert');
const fs=require('fs');
const master=fs.readFileSync('public/finance-master.js','utf8');

for(const fn of ['function recurringControlView()','function savingsControlView()','function taxEvidenceControlView()'])
  assert(master.includes(fn),'Missing dedicated personal control surface: '+fn);
for(const marker of [
  'SUBSCRIPTION & RECURRING COMMITMENT CONTROL','SAVINGS GOAL CONTROL','PERSONAL TAX & EVIDENCE CONTROL',
  "if(v==='savings')return savingsControlView();",
  "if(v==='recurring')return recurringControlView();",
  "if(v==='taxcontrol')return taxEvidenceControlView();",
  "['taxcontrol','§','Tax & Evidence']"
]) assert(master.includes(marker),'Missing canonical Finance control marker: '+marker);
assert(master.includes('data-recurring-complete'),'Recurring completion action missing.');
assert(master.includes('data-recurring-active'),'Recurring archive/restore action missing.');
assert(master.includes('data-recurring-control'),'Recurring lifecycle control action missing.');
assert(master.includes('data-goal-contribute'),'Savings contribution action missing.');
assert(master.includes('data-goal-status'),'Savings pause/resume action missing.');
assert(master.includes('data-personal-tax-review'),'Persistent Personal Tax review action missing.');
assert(master.includes("data-viewjump=\"receipts\""),'Tax/Evidence must link to Receipt Centre.');
assert(master.includes("data-viewjump=\"reports\""),'Tax/Evidence must link to Reports.');
assert(master.includes('does not decide deductibility')&&master.includes('tax payable'),'Tax workspace must remain preparation-only.');
assert(master.includes('never moves money'),'Savings workspace must state its no-money-movement boundary.');
assert(master.includes('Nothing is paid, repriced, renewed or cancelled automatically.'),'Recurring workspace must state its automation boundary.');
console.log('FINANCE_PERSONAL_CONTROL_SURFACES_OK');

assert(master.includes("['commitments',API+'/personal-money/commitments-control']"),'Recurring Commitment Control hydration missing.');
assert(master.includes("['personalTaxControl',API+'/personal-money/tax-control']"),'Personal Tax Control hydration missing.');
