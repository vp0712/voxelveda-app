'use strict';
const assert=require('assert');
const fs=require('fs');
const routes=fs.readFileSync('routes/financeRoutes.js','utf8');
const controller=fs.readFileSync('controllers/financeAccountantHandoverController.js','utf8');
const master=fs.readFileSync('public/finance-master.js','utf8');
const advanced=fs.readFileSync('public/finance-advanced-control.js','utf8');

for(const route of [
  "router.get('/accountant-handover'",
  "router.post('/accountant-handover/:financialYearId/snapshot'",
  "router.get('/accountant-handover/:financialYearId.pdf'"
]) assert(routes.includes(route),'Accountant Handover route missing: '+route);

assert(routes.includes("requirePermission('EXPORT_FINANCIAL_DATA')"),'Handover PDF must require export permission.');
assert(routes.includes("requireStepUp('EXPORT_ACCOUNTANT_PACK')"),'Handover PDF must require step-up.');
assert(routes.includes("requireSensitiveExportApproval('ACCOUNTANT_PACK')"),'Handover PDF must require sensitive export approval.');

assert(controller.includes("bt.ownership_scope='BUSINESS'"),'Handover bank evidence must be BUSINESS-only.');
assert(controller.includes("ba.ownership_scope IN ('BUSINESS','MIXED')"),'Handover may inspect business/mixed account containers only.');
assert(!controller.includes('personal_money_'),'Business handover controller must not query Personal Money tables.');
assert(controller.includes('accountant_exports'),'Handover must use the versioned accountant export ledger.');
assert(controller.includes("crypto.createHash('sha256')"),'Handover snapshot must create a SHA-256 manifest checksum.');
assert(controller.includes('ACCOUNTANT_HANDOVER_SNAPSHOT_CAPTURED'),'Handover snapshot must be audit logged.');
assert(controller.includes('ACCOUNTANT_HANDOVER_PDF_EXPORTED'),'Handover PDF export must be audit logged.');
assert(controller.includes('Frame 1.png'),'Handover PDF must use the original company logo asset when available.');
assert(controller.includes('Page ${i+1} of ${pages.count}'),'Handover PDF must paginate every page.');
assert(controller.includes('does not replace accountant review'),'Handover pack must state its accountant/tax boundary.');
assert(controller.includes('No financial record was changed.'),'Evidence snapshot must be non-mutating to financial records.');

for(const marker of [
  'ACCOUNTANT HANDOVER & AUDIT PACK','Versioned evidence history','Business bank coverage',
  'Period close evidence','function accountantHandoverView()',
  "if(v==='handover')return accountantHandoverView();",
  "['handover','▣','Accountant Handover']"
]) assert(master.includes(marker),'Accountant Handover UI missing '+marker);

assert(master.includes("['handover',API+'/accountant-handover']"),'Handover must hydrate in canonical Finance OS.');
assert(master.includes('handoverSnapshot'),'Handover snapshot action missing.');
assert(master.includes('handoverPdf'),'Handover PDF action missing.');
assert(master.includes('requestFinanceStepUp()'),'Sensitive handover download must request step-up.');

assert(advanced.includes("['handover','/api/finance/accountant-handover']"),'Advanced Control must source Handover evidence.');
assert(advanced.includes('Accountant Handover Readiness'),'Advanced Control handover status missing.');
assert(advanced.includes('data-fac-open="handover"'),'Advanced Control must drill into Handover.');
console.log('FINANCE_ACCOUNTANT_HANDOVER_OK');

assert((routes.match(/VIEW_BUSINESS_BANKING/g)||[]).length>=3,'Handover snapshot/PDF must require Company Finance visibility in addition to edit/export permissions.');
