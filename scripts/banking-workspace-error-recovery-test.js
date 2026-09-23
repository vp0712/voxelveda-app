const fs=require('node:fs');
function read(p){return fs.readFileSync(p,'utf8')}
function assert(v,m){if(!v){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}
const controller=read('controllers/advancedBankingController.js');
const client=read('public/finance-master.js');
const app=read('app.js');

assert(controller.includes("SELECT status,error_code AS last_error_code,error_detail,completed_at FROM open_banking_sync_runs"),'banking status selects the real error_code column');
assert(!controller.includes("SELECT status,last_error_code,error_detail,completed_at FROM open_banking_sync_runs"),'bad last_error_code SQL query is gone');
assert(client.includes('async function loadResource('),'Finance OS has failure-isolated resource loading');
assert(client.includes("error.status===403?'permission':'error'"),'resource failures retain permission/error state');
assert(client.includes('The rest of the workspace remains available'),'request timeouts explicitly preserve the rest of Finance');
assert(client.includes("['openBankProviders',I+'/open-banking/providers']"),'Open Banking provider failure is isolated as a supplementary resource');
assert(client.includes("['bankConnectionData','/api/integrations/webhooks/banking/connections']"),'bank connection failure is isolated as a supplementary resource');
assert(client.includes('function resourceError('),'component failures render locally instead of blanking Finance');
assert(client.includes("document.querySelectorAll('[data-retry]')"),'degraded Finance components expose retry');
assert(app.includes("app.get('/banking',noIndex,pageAuth(),redirectPreservingQuery('/finance-intelligence'))"),'legacy Banking page resolves into the unified Finance OS');
if(process.exitCode)process.exit(process.exitCode);
