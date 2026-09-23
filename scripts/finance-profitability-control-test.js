'use strict';
const assert=require('assert');
const fs=require('fs');
const controller=fs.readFileSync('controllers/financeProfitabilityController.js','utf8');
const routes=fs.readFileSync('routes/financeRoutes.js','utf8');
const migration=fs.readFileSync('migrations/20260924_finance_profitability_control.sql','utf8');
const schema=fs.readFileSync('services/financeSchema.js','utf8');
const master=fs.readFileSync('public/finance-master.js','utf8');
const asset=fs.readFileSync('public/finance-profitability-control.js','utf8');
const app=fs.readFileSync('app.js','utf8');

for(const table of ['finance_profitability_entities','finance_profitability_allocations','finance_profitability_invoice_links']){
 assert(migration.includes('CREATE TABLE IF NOT EXISTS '+table),table+' migration missing.');
 assert(schema.includes('CREATE TABLE IF NOT EXISTS '+table),table+' bootstrap missing.');
}
assert(!/\b(?:DROP|TRUNCATE)\b/i.test(migration),'Profitability migration must be additive.');
assert(controller.includes('PROFITABILITY_FULL_BUSINESS_ACCESS_REQUIRED'),'Profitability must require full Company Finance visibility.');
assert(controller.includes('PROFITABILITY_OVERALLOCATION'),'Profitability must prevent over-allocation.');
assert(controller.includes('PROFITABILITY_INTERNAL_TRANSFER_EXCLUDED'),'Internal transfers must be excluded.');
assert(controller.includes('Invoice value, payments and receivables are billing context only'),'Invoice billing/cash margin separation rule missing.');
assert(controller.includes('Currencies remain separate'),'Profitability must preserve native-currency separation.');
assert(controller.includes("status='REVERSED'"),'Profitability evidence must support non-destructive reversal.');
assert(!controller.includes('DELETE FROM finance_profitability_allocations'),'Profitability allocations must not be hard-deleted.');
assert(!controller.includes('DELETE FROM finance_profitability_invoice_links'),'Invoice links must not be hard-deleted.');

for(const route of ["router.get('/profitability-control'","router.post('/profitability-control/entities'","router.put('/profitability-control/entities/:uid'","router.post('/profitability-control/allocations'","router.post('/profitability-control/invoice-links'"])
 assert(routes.includes(route),'Missing route '+route);
assert(routes.includes("requireStepUp('REVERSE_PROFITABILITY_ALLOCATION')"),'Allocation reversal must require step-up.');
assert(routes.includes("requireStepUp('REVERSE_PROFITABILITY_INVOICE_LINK')"),'Invoice unlink must require step-up.');
assert(master.includes("['profitability','◩','Profitability & Margin']"),'Profitability must be a first-class Finance module.');
assert(master.includes('function profitabilityControlView()'),'Profitability canonical view loader missing.');
assert(master.includes('/finance-profitability-control.js?v=20260924-profitability-v1'),'Profitability asset version missing.');
assert(asset.includes("VERSION='20260924-profitability-v1'"),'Profitability asset release id missing.');
for(const marker of ['PROFITABILITY & MARGIN CONTROL','Dimensions & margin','Unallocated business transactions','Unlinked invoices','Cash margin comes only from explicit BUSINESS bank allocations'])
 assert(asset.includes(marker),'Profitability UI missing '+marker);
assert(app.includes("'finance-profitability-control.js'"),'Profitability asset must be canonical/allowlisted.');
console.log('FINANCE_PROFITABILITY_CONTROL_OK');
