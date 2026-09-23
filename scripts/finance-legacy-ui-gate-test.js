'use strict';

const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const assert=(ok,message)=>{if(!ok)throw new Error(message)};

const app=read('app.js');
const html=read('public/finance-intelligence.html');

assert(app.includes('canonicalFinanceUiAssets'),'canonical Finance frontend allowlist missing.');
assert(app.includes('isRetiredFinanceUiAsset'),'legacy Finance asset gate missing.');
assert(app.includes("name.startsWith('finance-')"),'finance-* legacy assets must be gated.');
assert(app.includes("name.startsWith('personal-finance-')"),'personal-finance-* legacy assets must be gated.');
assert(app.includes("name.startsWith('advanced-banking-ui')"),'advanced Banking legacy assets must be gated.');
assert(app.includes("status(410)"),'retired Finance assets must return HTTP 410 instead of loading.');
assert(app.includes("Use /finance-intelligence."),'retired Finance response must point to the canonical Finance OS.');
assert(app.includes("app.get('/banking',noIndex,pageAuth(),redirectPreservingQuery('/finance-intelligence'))"),'legacy /banking must redirect into the canonical Finance OS.');
assert(app.includes("app.get('/finance-reconciliation'"),'legacy reconciliation route must redirect into Finance OS.');
assert(app.includes("app.get('/finance-reconciliation.html'"),'legacy reconciliation HTML route must redirect into Finance OS.');

for(const asset of ['finance-intelligence.html','finance-master.js','finance-master.css','finance-bootstrap-guard.js','finance-advanced-control.js']){
  assert(app.includes("'"+asset+"'"),'canonical Finance asset allowlist missing '+asset);
}
assert(html.includes('/finance-master.js')&&html.includes('/finance-master.css'),'canonical Finance page must load the master frontend.');
assert(app.includes("'finance-advanced-control.js'"),'canonical Advanced Finance Control asset missing from allowlist.');
for(const old of ['advanced-banking-ui.js','finance-dashboard-v2.js','finance-intelligence-advanced.js','finance-import-wizard.js','finance-reconciliation.js','personal-finance-command-center.js']){
  assert(!html.includes(old),'canonical Finance HTML must not load '+old);
}

console.log('FINANCE_LEGACY_UI_GATE_OK');
