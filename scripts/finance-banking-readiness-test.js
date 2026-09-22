const fs = require('node:fs');
const path = require('node:path');
function read(file){return fs.readFileSync(path.join(__dirname,'..',file),'utf8')}
function assert(condition,message){if(!condition)throw new Error(message)}
const routes=read('routes/financeRoutes.js');
const controller=read('controllers/financeBankingReadinessController.js');
const providerService=read('services/openBankingProviderService.js');
const html=read('public/finance-intelligence.html');
const client=read('public/finance-master.js');
const css=read('public/finance-master.css');
assert(routes.includes("router.get('/intelligence/banking-readiness'"),'Banking readiness API route is missing.');
assert(routes.includes("requireAnyPermission('VIEW_BANKING')"),'Banking readiness route must remain permission protected.');
assert(providerService.includes("BANK_DATA_CLIENT_SECRET"),'Provider registry must support provider-secret presence checks.');
assert(providerService.includes("BANK_DATA_API_KEY"),'Provider registry must support Basiq API-key presence checks.');
assert(!controller.includes('process.env.BANK_DATA_CLIENT_SECRET,'),'Controller must not return provider secret.');
assert(!providerService.includes('client_secret: process.env.BANK_DATA_CLIENT_SECRET'),'Provider service must not expose provider secrets.');
assert(controller.includes('internet-banking passwords, PINs or bank OTPs'),'Bank credential safety rule is missing.');
assert(controller.includes('productionBankFeedReady'),'Open Banking must calculate a fail-closed production readiness gate.');
assert(controller.includes("bankEnvironment === 'PRODUCTION' && liveEnabled"),'Production Open Banking must require explicit production mode and live sync.');
assert(html.includes('finance-master.js'),'Master Finance OS must be loaded.');
assert(client.includes('Banking Setup & Safety'),'Finance OS safety entry is missing.');
assert(client.includes('bankingSafetyControls'),'Finance OS safety controls are missing.');
assert(client.includes("I+'/banking-readiness'"),'Finance OS must load the readiness endpoint.');
assert(client.includes("dataset.readinessBlocked==='true'"),'Connect Bank readiness guard is missing.');
assert(client.includes('Open Banking is locked'),'Blocked Open Banking must explain the safety gate.');
assert(css.includes('.fm-badge.good'),'Master OS readiness status styling is missing.');
console.log('Finance banking readiness regression checks passed.');
