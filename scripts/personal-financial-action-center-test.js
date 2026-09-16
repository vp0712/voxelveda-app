const fs=require('fs');
const assert=require('assert');
const actionCenter=fs.readFileSync('public/personal-financial-action-center.js','utf8');
const assistant=fs.readFileSync('public/financial-decision-assistant.js','utf8');

assert(assistant.includes('/personal-financial-action-center.js?v=20260916-action-center'),'Decision Assistant chain must load Personal Financial Action Center.');
for(const endpoint of ['/api/finance/personal-money/smart','/api/finance/personal-money/attention','/api/finance/personal-money/health','/api/finance/personal-money/roadmaps'])assert(actionCenter.includes(endpoint),`Action Center must reuse protected read API: ${endpoint}`);
assert(actionCenter.includes("credentials:'same-origin'"),'Action Center must preserve authenticated same-origin requests.');
assert(!/method\s*:\s*['\"](?:POST|PUT|PATCH|DELETE)/i.test(actionCenter),'Action Center must remain API read-only.');
for(const label of ['Do now','This week','Later','Mark done','Snooze 7 days','Dismiss','Why:','Next step:'])assert(actionCenter.includes(label),`Action Center must provide ${label}.`);
assert(actionCenter.includes('localStorage'),'Action Center organisational state must remain local-only.');
assert(actionCenter.includes('local organisational controls only'),'Action Center must explain local-only state.');
assert(actionCenter.includes('must require explicit approval'),'Any future record-changing action must require explicit approval.');
for(const prohibited of ['finance_transactions','journal_entries','createJournal','/payments','/reconcile','/apply','POST_TRANSACTION','RECONCILE_BANK_TRANSACTION'])assert(!actionCenter.includes(prohibited),`Action Center must not contain financial mutation path: ${prohibited}`);
console.log('Personal Financial Action Center regression checks passed.');
