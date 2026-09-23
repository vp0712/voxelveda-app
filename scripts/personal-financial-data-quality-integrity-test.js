'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert');
const root=path.join(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

const ui=read('public/finance-master.js');
const html=read('public/finance-intelligence.html');
const controller=read('controllers/personalFinancialDataQualityController.js');
const routes=read('routes/financeRoutes.js');
const app=read('app.js');

assert(html.includes('/finance-master.js'),'Canonical Finance OS must load the master frontend.');
assert(ui.includes("['review','!','Review Centre']"),'Canonical Finance OS must expose the Review Centre.');
assert(ui.includes('function reviewView()'),'Canonical Finance OS must integrate Data Quality Review.');
assert(ui.includes("['quality',I+'/data-quality'+base]"),'Canonical Finance OS must load protected data-quality metrics.');
for(const label of ['Uncategorised','Unreconciled','Ownership missing','Unknown history coverage','Transfer candidates','Category suggestions','Anomalies','Archived transactions']){
  assert(ui.includes(label),`Review Centre must surface ${label}.`);
}
assert(routes.includes("router.get('/personal-money/data-quality-integrity', requireAnyPermission('VIEW_BANKING'), personalFinancialDataQuality.getCenter)"),'Owner-private Personal Data Quality endpoint must remain VIEW_BANKING protected.');
assert(controller.includes("ownership_scope='PERSONAL'")&&controller.includes('created_by=?'),'Personal Data Quality bank queries must remain PERSONAL and owner-scoped.');
assert(controller.includes('user_id=?'),'Personal Money integrity queries must remain owner-scoped.');
assert(controller.includes('company accounting is excluded'),'Personal integrity response must explicitly exclude company accounting.');
for(const phrase of ['only a double-counting risk signal','may include legitimate repeated transactions','may be genuine','not automatically reclassified']){
  assert(controller.includes(phrase),`Integrity heuristics must disclose: ${phrase}`);
}
assert(!ui.includes('personal-finance-automation-approval-center.js'),'Canonical Finance OS must not load the retired Automation Approval frontend.');
assert(app.includes("name.startsWith('personal-finance-')"),'Retired Personal Finance frontend assets must remain server-gated.');
assert(app.includes('status(410)'),'Retired Finance frontend assets must fail closed with HTTP 410.');

console.log('Canonical Finance Data Quality Review and owner-private integrity regression checks passed.');
