'use strict';
const assert=require('assert');
const fs=require('fs');
const routes=fs.readFileSync('routes/financeRoutes.js','utf8');
const controller=fs.readFileSync('controllers/financeJobProfitabilityController.js','utf8');
const master=fs.readFileSync('public/finance-master.js','utf8');
const html=fs.readFileSync('public/finance-intelligence.html','utf8');
const advanced=fs.readFileSync('public/finance-advanced-control.js','utf8');

assert(routes.includes("router.get('/job-profitability'"),'Job Profitability route missing.');
assert(routes.includes("requireAnyPermission('VIEW_BUSINESS_BANKING')"),'Job Profitability must require business banking visibility.');
assert(controller.includes("REVENUE_TYPES=['SALE']"),'Job Profitability must use SALE as recognized revenue.');
assert(controller.includes("DIRECT_COST_TYPES=['EXPENSE','SUPPLIER_BILL','PAYROLL']"),'Job Profitability direct-cost types are incomplete.');
assert(controller.includes("EXCLUDED_TYPES=['CUSTOMER_PAYMENT','SUPPLIER_PAYMENT','TRANSFER','ASSET_PURCHASE','OWNER_CONTRIBUTION','OWNER_DRAWING','JOURNAL_ADJUSTMENT','OTHER']"),'Settlement/balance-sheet exclusions are incomplete.');
assert(controller.includes("REVIEW_TYPES=['REFUND']"),'Refunds must remain a separate review amount.');
assert(controller.includes("status='POSTED'"),'Profitability must use posted accounting evidence.');
assert(controller.includes("allocation_coverage_percent"),'Cost allocation coverage control missing.');
assert(controller.includes("unallocated_evidence"),'Unallocated economic evidence missing.');
assert(controller.includes("not statutory net profit"),'Profitability boundary must explicitly avoid statutory-profit claims.');
assert(!/\b(?:INSERT|UPDATE|DELETE)\s+/i.test(controller),'Job Profitability endpoint must remain read-only.');

for(const marker of ["['profitability','◈','Job Profitability']","function jobProfitabilityView()","JOB PROFITABILITY & COST ALLOCATION","Allocation coverage","Unallocated economic evidence","if(v==='profitability')return jobProfitabilityView();","['jobProfitability',API+'/job-profitability'"])
 assert(master.includes(marker),'Job Profitability UI missing '+marker);
assert(html.includes('/finance-master.js?v=20260924-control-v11'),'Finance master release must be cache-busted for Job Profitability.');
console.log('FINANCE_JOB_PROFITABILITY_OK');

assert(advanced.includes("['jobProfitability','/api/finance/job-profitability']"),'Job Profitability must hydrate in Advanced Control.');
assert(advanced.includes('function jobProfitabilityControl()'),'Job Profitability must be surfaced in Advanced Control.');
assert(advanced.includes('Job Profitability & Cost Allocation'),'Advanced Job Profitability section missing.');
assert(advanced.includes('data-fac-open="profitability"'),'Advanced Job Profitability must drill into the canonical workspace.');
