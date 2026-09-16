const fs=require('fs');
const assert=require('assert');
const ui=fs.readFileSync('public/personal-financial-control-center.js','utf8');
const actionCenter=fs.readFileSync('public/personal-financial-action-center.js','utf8');

assert(actionCenter.includes('/personal-financial-control-center.js?v=20260916-control-center'),'Action Center chain must load Personal Financial Control Center.');
for(const endpoint of ['/api/finance/personal-money/daily-briefing?date=','/api/finance/personal-money/health?fy_start=','/api/finance/personal-money/smart','/api/finance/personal-money/attention','/api/finance/personal-money','/api/finance/personal-money/net-worth','/api/finance/personal-money/net-worth/lifecycle'])assert(ui.includes(endpoint),`Control Center must reuse protected PERSONAL read API: ${endpoint}`);
assert(ui.includes("credentials:'same-origin'"),'Control Center requests must preserve authenticated same-origin credentials.');
assert(!/method\s*:\s*['\"](?:POST|PUT|PATCH|DELETE)/i.test(ui),'Control Center must remain API read-only.');
for(const label of ['PERSONAL FINANCIAL CONTROL CENTER','Needs attention now','Watch / review','Cash & financial position by currency','Today','Priority actions','Savings, debt & money owed','Tax, evidence & year-end readiness','Executive overview'])assert(ui.includes(label),`Control Center must explain ${label}.`);
assert(ui.includes('Currencies')||ui.includes('currency'),'Control Center must present currency-scoped data.');
assert(ui.includes('does not move money')&&ui.includes('combine currencies'),'Control Center must disclose money-movement and currency safeguards.');
assert(ui.includes('Any future balance-changing action must require your explicit approval'),'Future balance-changing actions must require explicit user approval.');
assert(ui.includes('PERSONAL data only'),'Control Center must explicitly remain personal-only.');
assert(ui.includes('missing linked vault evidence'),'Control Center must surface missing evidence from the year-end/document workflow.');
assert(ui.includes('unresolved accountant question'),'Control Center must surface unresolved accountant questions.');
for(const prohibited of ['createJournal','POST_TRANSACTION','RECONCILE_BANK_TRANSACTION','/payments','method:\'POST\'','method:\'DELETE\''])assert(!ui.includes(prohibited),`Control Center must not contain mutation path: ${prohibited}`);
console.log('Personal Financial Control Center regression checks passed.');
