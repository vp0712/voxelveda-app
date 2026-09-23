'use strict';
const fs=require('node:fs');
const assert=require('node:assert');
const routes=fs.readFileSync('routes/financeRoutes.js','utf8');
const controller=fs.readFileSync('controllers/financeCounterpartyController.js','utf8');
const master=fs.readFileSync('public/finance-master.js','utf8');

assert(routes.includes("router.get('/counterparty-control'"),'Counterparty Control route missing.');
assert(routes.includes("financeCounterparty.getCenter"),'Counterparty Control controller not wired.');
for(const marker of ['receivables','payables','customer_invoices','supplier_bills','counterparties','concentration'])
  assert(controller.includes(marker),`Counterparty engine missing ${marker}.`);
assert(controller.includes("invoice creation age"),'Customer aging limitation must be explicit.');
assert(controller.includes("configured Company base currency"),'Legacy company-document currency boundary must be explicit.');
assert(!/\b(?:INSERT|UPDATE|DELETE)\b/.test(controller.replace(/console\.error[\s\S]*$/,'')),'Counterparty Control must remain read-only.');
assert(master.includes("['counterparties','♧','Customers & Suppliers']"),'Customers & Suppliers must be first-class Finance navigation.');
assert(master.includes('function counterpartyControlView()'),'Counterparty Control UI missing.');
assert(master.includes("['counterpartyControl',API+'/counterparty-control']"),'Counterparty Control must hydrate in the canonical Finance OS.');
assert(master.includes("if(v==='counterparties')return counterpartyControlView();"),'Counterparty navigation must render the native workspace.');
for(const marker of ['AR / AP & COUNTERPARTY CONTROL','Customer collection queue','Supplier payment queue','Counterparty exposure','data-customer-statement-name'])
  assert(master.includes(marker),`Counterparty UI missing ${marker}.`);
console.log('FINANCE_COUNTERPARTY_CONTROL_OK');
