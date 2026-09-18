const fs=require('node:fs');
function read(p){return fs.readFileSync(p,'utf8')}
function assert(v,m){if(!v){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}
const controller=read('controllers/advancedBankingController.js');
const client=read('public/premium-banking-app.js');
const brand=read('services/globalBrandRenderer.js');

assert(controller.includes("SELECT status,error_code AS last_error_code,error_detail,completed_at FROM open_banking_sync_runs"),'banking status selects the real error_code column');
assert(!controller.includes("SELECT status,last_error_code,error_detail,completed_at FROM open_banking_sync_runs"),'bad last_error_code SQL query is gone');
assert(client.includes('async function safeApi('),'banking client has failure-isolated API helper');
assert(client.includes("state.partialErrors=[]"),'each refresh resets partial service errors');
assert(client.includes("safeApi(BANK+'/status'"),'Open Banking status failure is isolated');
assert(client.includes("safeApi(BANK+'/connections'"),'bank connection failure is isolated');
assert(client.includes("safeApi(BANK+'/data-quality'"),'data quality failure is isolated');
assert(client.includes("safeApi(FIN+'/banking-dashboard?"),'banking dashboard failure is isolated');
assert(client.includes("Banking loaded with limited services."),'degraded mode warns without blanking the workspace');
assert(client.includes("if(name==='refresh') return refresh();"),'degraded retry button is wired');
assert(brand.includes('20260919-access-fix'),'fixed premium Banking asset is cache-busted');
if(process.exitCode)process.exit(process.exitCode);
