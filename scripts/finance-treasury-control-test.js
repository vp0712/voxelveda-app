'use strict';
const assert=require('assert');
const fs=require('fs');
const routes=fs.readFileSync('routes/financeRoutes.js','utf8');
const controller=fs.readFileSync('controllers/financeTreasuryController.js','utf8');
const master=fs.readFileSync('public/finance-master.js','utf8');
const advanced=fs.readFileSync('public/finance-advanced-control.js','utf8');

assert(routes.includes("router.get('/treasury-control'"),'Treasury Control route missing.');
assert(routes.includes("requireAnyPermission('VIEW_BUSINESS_BANKING')"),'Treasury Control must require business banking visibility.');
for(const marker of ['bank_cash_by_currency','operating_flow_by_currency','working_capital','payable_aging','receivable_aging','supplier_obligations_due_30d','weighted_receivable_age_days'])
  assert(controller.includes(marker),'Treasury engine missing '+marker);
assert(controller.includes('No silent FX conversion is performed'),'Treasury must prohibit silent FX aggregation.');
assert(controller.includes('are not assumed as forecast cash inflows'),'Treasury must not invent receivable collection dates.');
assert(controller.includes('never executes supplier payments, bank transfers or automatic collections'),'Treasury must remain read-only.');
assert(!/UPDATE\s+bank_|INSERT\s+INTO\s+bank_transactions|DELETE\s+FROM\s+bank_/i.test(controller),'Treasury read model must not mutate bank ledger.');
assert(!controller.includes('recordSupplierPayment'),'Treasury read model must not execute supplier payments.');

for(const marker of ['Treasury & Working Capital','function treasuryControlView()',"if(v==='treasury')return treasuryControlView();","['treasury','▥','Treasury']"])
  assert(master.includes(marker),'Treasury UI missing '+marker);
assert(master.includes("['treasuryControl',API+'/treasury-control']"),'Treasury must hydrate in canonical Finance OS.');
assert(advanced.includes("['treasury','/api/finance/treasury-control']"),'Advanced Control must hydrate Treasury evidence.');
assert(advanced.includes('function treasuryControl()'),'Advanced Treasury section missing.');
assert(advanced.includes('data-fac-open="treasury"'),'Advanced Control must drill into Treasury.');
console.log('FINANCE_TREASURY_CONTROL_OK');

assert(controller.includes("bt.ownership_scope='BUSINESS'"),'Treasury operating flow must exclude non-business transaction ownership.');

assert(controller.includes('SELECT default_currency FROM finance_settings'),'Treasury base currency must follow Finance settings when no explicit app override exists.');
