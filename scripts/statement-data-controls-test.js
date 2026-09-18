const fs=require('node:fs');
function read(p){return fs.readFileSync(p,'utf8')}
function assert(v,m){if(!v){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}
const controller=read('controllers/statementDataManagementController.js');
const financeRoutes=read('routes/financeRoutes.js');
const bankingRoutes=read('routes/bankingPortalRoutes.js');
const report=read('public/finance-statement-report-center.js');
const app=read('public/finance-intelligence.js');
const html=read('public/finance-intelligence.html');

for(const name of ['exports.listRemoved','exports.remove','exports.restore','exports.clearAccountStatements','exports.purge']) assert(controller.includes(name),name+' exists');
assert(controller.includes('STATEMENT_REMOVED::'),'removed transactions preserve restoration metadata');
assert(controller.includes('previous=parseMarker'),'restore reads previous transaction state');
assert(controller.includes('reconciliation_status="IGNORED"'),'removed statement transactions are excluded from active analysis');
assert(controller.includes('parse_status="REMOVED"'),'removed statement file is excluded from imported-statement reports');
assert(controller.includes('parse_status="IMPORTED"'),'restore returns statement to imported history');
assert(controller.includes("PURGE ${uid}"),'permanent purge requires exact confirmation');
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

assert(report.includes('Removed Statements'),'Removed Statements UI exists');
assert(report.includes('data-remove-statement'),'statement cards expose remove action');
assert(report.includes('data-restore-statement'),'removed statement can be restored');
assert(report.includes('data-purge-statement'),'removed statement can be permanently deleted');
assert(report.includes('Permanent deletion cannot be undone'),'purge UI warns clearly');
assert(app.includes('data-clear-account-history'),'account history can be cleared from warehouse');
assert(app.includes('data-archive-account'),'account can be archived from warehouse');
assert(app.includes("typed!=='CLEAR'"),'clear-history requires explicit typed confirmation');
assert(html.includes('20260919-data-controls'),'new data-control assets are cache-busted');
if(process.exitCode)process.exit(process.exitCode);
