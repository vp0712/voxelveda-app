'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const expect=(source,needle,message)=>{if(!source.includes(needle))throw new Error(message||('Expected '+needle))};
const reject=(source,needle,message)=>{if(source.includes(needle))throw new Error(message||('Unexpected '+needle))};

const controller=read('controllers/financeReconciliationCenterController.js');
const operations=read('controllers/financeOperationsController.js');
const routes=read('routes/financeRoutes.js');
const ui=read('public/finance-master.js');
const css=read('public/finance-master.css');

expect(controller,"if (reconciliation === 'RECONCILED') return 'RECONCILED'",'Actual reconciliation status must remain authoritative.');
expect(controller,"return 'READY'",'Classified transactions need a Ready workflow state.');
expect(controller,"ft.status='POSTED'",'Match candidates must be posted finance transactions.');
expect(controller,"ft.reconciliation_status <> 'RECONCILED'",'Already reconciled finance records must not be suggested.');
expect(controller,"classification_status='CLASSIFIED'",'Classification must mark the bank transaction classified.');
reject(controller,"SET reconciliation_status='RECONCILED'",'Classification must never directly mark a bank transaction reconciled.');
expect(routes,"router.get('/intelligence/reconciliation'",'Reconciliation list route is missing.');
expect(routes,"router.get('/intelligence/reconciliation/:id/candidates'",'Reconciliation candidate route is missing.');
expect(routes,"requireStepUp('APPLY_FINANCE_INTELLIGENCE')",'Classification changes must retain step-up verification.');
expect(routes,"requireStepUp('RECONCILE_BANK_TRANSACTION')",'Actual matching must retain step-up verification.');
expect(operations,'matchedTotal > absoluteBank','Reconciliation must prevent over-matching.');
expect(operations,"completed ? 'RECONCILED' : 'PARTIAL'",'Partial matches must remain explicitly partial.');

for(const text of ['Needs action','Ready','Partial','Reconciled','RECONCILIATION CONTROL'])expect(ui,text,'Unified reconciliation UI missing '+text);
expect(ui,'function openReconciliationDetail(id)','Reconciliation row detail workflow missing.');
expect(ui,"I+'/reconciliation/'+encodeURIComponent(id)+'/candidates'",'UI must load posted match candidates.');
expect(ui,"API+'/bank-transactions/'+encodeURIComponent(id)+'/reconcile'",'UI must use the audited reconciliation engine.');
expect(ui,"API+'/bank-transactions/'+encodeURIComponent(id)+'/ignore'",'UI must use the audited ignore endpoint.');
expect(ui,'data-reconcile-candidate','Candidate match action missing.');
expect(ui,'data-reconciliation-ignore','Audited ignore action missing.');
expect(ui,'data-reconciliation','Reconciliation rows must open in context.');
expect(css,'.fm-table-wrap','Reconciliation table must use the master responsive table container.');

console.log('Finance reconciliation center regression checks passed.');
