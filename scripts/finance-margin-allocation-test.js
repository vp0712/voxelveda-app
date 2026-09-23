'use strict';
const assert=require('assert');
const fs=require('fs');
const controller=fs.readFileSync('controllers/financeMarginAllocationController.js','utf8');
const routes=fs.readFileSync('routes/financeRoutes.js','utf8');
const migration=fs.readFileSync('migrations/20260924_finance_margin_allocation.sql','utf8');
const schema=fs.readFileSync('services/financeSchema.js','utf8');
const master=fs.readFileSync('public/finance-master.js','utf8');
const asset=fs.readFileSync('public/finance-margin-allocation.js','utf8');
const app=fs.readFileSync('app.js','utf8');

for(const table of ['finance_margin_entities','finance_margin_allocations','finance_margin_invoice_links']){
 assert(migration.includes('CREATE TABLE IF NOT EXISTS '+table),table+' migration missing.');
 assert(schema.includes('CREATE TABLE IF NOT EXISTS '+table),table+' bootstrap missing.');
}
assert(!/\b(?:DROP|TRUNCATE)\b/i.test(migration),'Margin Allocation migration must be additive.');
assert(controller.includes('MARGIN_FULL_BUSINESS_ACCESS_REQUIRED'),'Margin Allocation must require full Company Finance visibility.');
assert(controller.includes('MARGIN_OVERALLOCATION'),'Margin Allocation must prevent over-allocation.');
assert(controller.includes('MARGIN_INTERNAL_TRANSFER_EXCLUDED'),'Internal transfers must be excluded.');
assert(controller.includes('Invoice value, payments and receivables are billing context only'),'Invoice billing/cash margin separation rule missing.');
assert(controller.includes('Currencies remain separate'),'Margin Allocation must preserve native-currency separation.');
assert(controller.includes("status='REVERSED'"),'Margin Allocation evidence must support non-destructive reversal.');
assert(!controller.includes('DELETE FROM finance_margin_allocations'),'Margin Allocation allocations must not be hard-deleted.');
assert(!controller.includes('DELETE FROM finance_margin_invoice_links'),'Invoice links must not be hard-deleted.');

for(const route of ["router.get('/margin-allocation'","router.post('/margin-allocation/entities'","router.put('/margin-allocation/entities/:uid'","router.post('/margin-allocation/allocations'","router.post('/margin-allocation/invoice-links'"])
 assert(routes.includes(route),'Missing route '+route);
assert(routes.includes("requireStepUp('REVERSE_MARGIN_ALLOCATION')"),'Allocation reversal must require step-up.');
assert(routes.includes("requireStepUp('REVERSE_MARGIN_INVOICE_LINK')"),'Invoice unlink must require step-up.');
assert(master.includes("['marginallocation','◩','Margin Allocation']"),'Margin Allocation must be a first-class Finance module.');
assert(master.includes('function marginAllocationView()'),'Margin Allocation canonical view loader missing.');
assert(master.includes('/finance-margin-allocation.js?v=20260924-margin-allocation-v1'),'Margin Allocation asset version missing.');
assert(asset.includes("VERSION='20260924-margin-allocation-v1'"),'Margin Allocation asset release id missing.');
for(const marker of ['MARGIN ALLOCATION CONTROL','Dimensions & margin','Unallocated business transactions','Unlinked invoices','Cash margin comes only from explicit BUSINESS bank allocations'])
 assert(asset.includes(marker),'Margin Allocation UI missing '+marker);
assert(app.includes("'finance-margin-allocation.js'"),'Margin Allocation asset must be canonical/allowlisted.');
console.log('FINANCE_MARGIN_ALLOCATION_OK');
