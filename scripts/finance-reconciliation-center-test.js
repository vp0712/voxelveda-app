'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const expect=(source,needle,message)=>{if(!source.includes(needle))throw new Error(message||`Expected ${needle}`)};
const reject=(source,needle,message)=>{if(source.includes(needle))throw new Error(message||`Unexpected ${needle}`)};

const controller=read('controllers/financeReconciliationCenterController.js');
const routes=read('routes/financeRoutes.js');
const ui=read('public/finance-master.js');
const css=read('public/finance-master.css');
const app=read('app.js');

expect(controller,"if (reconciliation === 'RECONCILED') return 'RECONCILED'",'Actual reconciliation status must remain authoritative.');
expect(controller,"return 'READY'",'Classified transactions need a Ready workflow state.');
expect(controller,"ft.status='POSTED'",'Match candidates must be posted finance transactions.');
expect(controller,"ft.reconciliation_status <> 'RECONCILED'",'Already reconciled finance records must not be suggested.');
expect(controller,"classification_status='CLASSIFIED'",'Classification must mark the bank transaction classified.');
reject(controller,"SET reconciliation_status='RECONCILED'",'Classification must never directly mark a bank transaction reconciled.');

expect(routes,"router.get('/intelligence/reconciliation'",'Reconciliation list route is missing.');
expect(routes,"router.get('/intelligence/reconciliation/:id/candidates'",'Reconciliation candidate route is missing.');
expect(routes,"requireStepUp('APPLY_FINANCE_INTELLIGENCE')",'Classification changes must retain step-up verification.');

expect(ui,'function reconciliationView()','Canonical Finance OS must integrate reconciliation.');
for(const label of ['Needs action','Ready','Partial','Reconciled'])expect(ui,label,`Reconciliation view missing ${label}`);
expect(ui,"['reconciliation','✓','Reconciliation']", 'Canonical navigation must expose Reconciliation.');
expect(ui,"I+'/reconciliation'+filterQuery()", 'Canonical Finance OS must load the protected reconciliation API.');
expect(css,'.fm-mobile-nav','Reconciliation must remain reachable in the responsive Finance shell.');
expect(app,"app.get('/finance-reconciliation'",'Legacy reconciliation route must redirect to Finance OS.');
expect(app,"/finance-intelligence#reconciliation",'Legacy reconciliation route must target the integrated reconciliation view.');

console.log('Finance reconciliation center regression checks passed.');
