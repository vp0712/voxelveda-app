const fs=require('node:fs');
function read(p){return fs.readFileSync(p,'utf8')}
function assert(v,m){if(!v){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}
const controller=read('controllers/statementDataManagementController.js');
const financeRoutes=read('routes/financeRoutes.js');
const bankingRoutes=read('routes/bankingPortalRoutes.js');
const master=read('public/finance-master.js');
const html=read('public/finance-intelligence.html');

for(const name of ['exports.listRemoved','exports.remove','exports.restore','exports.clearAccountStatements','exports.purge']) assert(controller.includes(name),name+' exists');
assert(controller.includes('STATEMENT_REMOVED::'),'removed transactions preserve restoration metadata');
assert(controller.includes('previous=parseMarker'),'restore reads previous transaction state');
assert(controller.includes('reconciliation_status="IGNORED"'),'removed statement transactions are excluded from active analysis');
assert(controller.includes('parse_status="REMOVED"'),'removed statement file is excluded from imported-statement reports');
assert(controller.includes('parse_status="IMPORTED"'),'restore returns statement to imported history');
assert(controller.includes('PURGE ${uid}'),'permanent purge requires exact confirmation');
assert(controller.includes('DELETE FROM reconciliation_matches'),'purge clears reconciliation dependencies before transaction deletion');
assert(controller.includes('recalcAccount'),'remove/restore/purge recalculates account history and balance');

for(const routes of [financeRoutes,bankingRoutes]){
  assert(routes.includes("'/intelligence/statements-removed'"),'removed statements route exists');
  assert(routes.includes("'/intelligence/statements/:uid/remove'"),'remove statement route exists');
  assert(routes.includes("'/intelligence/statements/:uid/restore'"),'restore statement route exists');
  assert(routes.includes("'/intelligence/statements/:uid/purge'"),'purge statement route exists');
  assert(routes.includes("'/intelligence/accounts/:id/clear-statements'"),'clear account statement history route exists');
}
assert(financeRoutes.includes("requireStepUp('PURGE_BANK_STATEMENT')"),'permanent purge is step-up protected');
assert(bankingRoutes.includes("bankAccountLifecycle.archive"),'standalone Banking exposes account archive');

assert(html.includes('/finance-master.js'),'unified Finance OS client is loaded');
assert(master.includes('Removed Statements'),'Removed Statements recovery UI exists in the master Finance OS');
assert(master.includes('data-statement-remove'),'statement vault exposes soft remove');
assert(master.includes('data-statement-restore'),'removed statements can be restored');
assert(master.includes('data-statement-purge'),'removed statements expose protected Danger Zone purge');
assert(master.includes('Permanent deletion cannot be undone'),'purge UI warns clearly');
assert(master.includes("typed!=='PURGE '+uid"),'purge requires exact typed confirmation in the client');
assert(master.includes("I+'/statements-removed'"),'master Finance OS loads removed statements from protected API');

if(process.exitCode)process.exit(process.exitCode);
