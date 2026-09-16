const fs=require('fs');
const assert=require('assert');
const wealth=fs.readFileSync('public/personal-wealth-position-intelligence.js','utf8');
const risk=fs.readFileSync('public/personal-financial-risk-intelligence.js','utf8');

assert(wealth.includes('/personal-financial-risk-intelligence.js?v=20260916-financial-risk'),'Wealth Position Intelligence must load Financial Risk & Protection Intelligence.');
assert(risk.includes('/personal-insurance-protection-register.js?v=20260916-insurance-register'),'Risk Intelligence must load the Personal Insurance & Protection Register.');
for(const endpoint of ['/api/finance/personal-money/health','/api/finance/personal-money/net-worth','/api/finance/personal-money/attention','/api/finance/personal-money/smart'])assert(risk.includes(endpoint),`Risk Intelligence must reuse protected read API: ${endpoint}`);
assert(risk.includes("credentials:'same-origin'"),'Risk Intelligence must preserve authenticated same-origin requests.');
assert(!/method\s*:\s*['\"](?:POST|PUT|PATCH|DELETE)/i.test(risk),'Risk Intelligence itself must remain API read-only.');
for(const label of ['FINANCIAL RISK & PROTECTION INTELLIGENCE','High attention','Watch items','30-day obligations','Risk signals','Resilience view','Protection information'])assert(risk.includes(label),`Risk Intelligence must explain ${label}.`);
for(const concept of ['Emergency coverage','Liabilities are high relative to recorded assets','Large 30-day obligations','Current-month imported income','Recorded asset values are concentrated','Safe-to-spend'])assert(risk.includes(concept),`Risk Intelligence must cover ${concept}.`);
assert(risk.includes('Protection register ready below'),'Risk Intelligence must direct users to recorded protection data.');
assert(risk.includes('Missing records are <b>not</b> treated as proof that you have no insurance'),'Risk Intelligence must not infer absent coverage from missing records.');
assert(risk.includes('Currencies are never combined'),'Risk Intelligence must keep currencies separate.');
assert(risk.includes('never buys or cancels insurance')&&risk.includes('must require explicit user approval'),'Risk Intelligence must disclose non-action behaviour and approval requirement.');
for(const prohibited of ['finance_transactions','journal_entries','createJournal','/payments','/reconcile','/apply','method:\'POST\'','POST_TRANSACTION','RECONCILE_BANK_TRANSACTION'])assert(!risk.includes(prohibited),`Risk Intelligence must not contain mutation path: ${prohibited}`);
require('./personal-insurance-protection-register-test');
console.log('Personal Financial Risk & Protection Intelligence regression checks passed.');
