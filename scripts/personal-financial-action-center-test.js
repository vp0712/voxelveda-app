const fs=require('fs');
const assert=require('assert');
const actionCenter=fs.readFileSync('public/personal-financial-action-center.js','utf8');
const assistant=fs.readFileSync('public/financial-decision-assistant.js','utf8');
const subscriptions=fs.readFileSync('public/personal-subscription-intelligence.js','utf8');
const forecast=fs.readFileSync('public/personal-cashflow-forecast.js','utf8');

assert(assistant.includes('/personal-financial-action-center.js?v=20260916-action-center'),'Decision Assistant chain must load Personal Financial Action Center.');
for(const endpoint of ['/api/finance/personal-money/smart','/api/finance/personal-money/attention','/api/finance/personal-money/health','/api/finance/personal-money/roadmaps'])assert(actionCenter.includes(endpoint),`Action Center must reuse protected read API: ${endpoint}`);
assert(actionCenter.includes("credentials:'same-origin'"),'Action Center must preserve authenticated same-origin requests.');
assert(!/method\s*:\s*['\"](?:POST|PUT|PATCH|DELETE)/i.test(actionCenter),'Action Center must remain API read-only.');
for(const label of ['Do now','This week','Later','Mark done','Snooze 7 days','Dismiss','Why:','Next step:'])assert(actionCenter.includes(label),`Action Center must provide ${label}.`);
assert(actionCenter.includes('localStorage'),'Action Center organisational state must remain local-only.');
assert(actionCenter.includes('local organisational controls only'),'Action Center must explain local-only state.');
assert(actionCenter.includes('must require explicit approval'),'Any future record-changing action must require explicit approval.');
for(const prohibited of ['finance_transactions','journal_entries','createJournal','/payments','/reconcile','/apply','POST_TRANSACTION','RECONCILE_BANK_TRANSACTION'])assert(!actionCenter.includes(prohibited),`Action Center must not contain financial mutation path: ${prohibited}`);

assert(actionCenter.includes('/personal-subscription-intelligence.js?v=20260916-subscription-intelligence'),'Action Center chain must load Subscription & Recurring Payment Intelligence.');
assert(subscriptions.includes('/api/finance/personal-money/attention'),'Subscription Intelligence must reuse protected Money Attention recurring data.');
assert(subscriptions.includes("credentials:'same-origin'"),'Subscription Intelligence must preserve authenticated same-origin requests.');
assert(!/method\s*:\s*['\"](?:POST|PUT|PATCH|DELETE)/i.test(subscriptions),'Subscription Intelligence must remain API read-only.');
for(const label of ['SUBSCRIPTION & RECURRING PAYMENT INTELLIGENCE','Monthly equivalent','Annual equivalent','Next renewal/due','Price check:','Review checklist:','Subscriptions only','Other recurring bills'])assert(subscriptions.includes(label),`Subscription Intelligence must explain ${label}.`);
assert(subscriptions.includes('possible increase')||subscriptions.includes('Possible increase'),'Subscription Intelligence must support transparent price-increase signalling.');
assert(subscriptions.includes('No comparable prior amount available'),'Subscription Intelligence must disclose when price history is unavailable instead of guessing.');
assert(subscriptions.includes('currencies are never combined'),'Subscription Intelligence must keep currencies separate.');
assert(subscriptions.includes('never cancels a service')&&subscriptions.includes('stops a payment')&&subscriptions.includes('writes accounting records'),'Subscription Intelligence must disclose read-only behaviour.');
for(const prohibited of ['finance_transactions','journal_entries','createJournal','/payments','/reconcile','/apply','method:\'POST\'','POST_TRANSACTION','RECONCILE_BANK_TRANSACTION'])assert(!subscriptions.includes(prohibited),`Subscription Intelligence must not contain financial mutation path: ${prohibited}`);

assert(forecast.includes('a.d===dim(a.y,a.m)')&&forecast.includes('Math.min(a.d,dim(y,m))'),'Cash-flow forecast recurrence must clamp month-end dates rather than relying on JavaScript month rollover.');
assert(forecast.includes("r.frequency==='MONTHLY')s=shiftMonth(start,i)")&&forecast.includes("r.frequency==='QUARTERLY')s=shiftMonth(start,i*3)")&&forecast.includes("r.frequency==='YEARLY')s=shiftYear(start,i)"),'Cash-flow forecast must use month-end-safe recurrence for monthly, quarterly and yearly items.');

console.log('Personal Financial Action Center, Subscription Intelligence and forecast recurrence regression checks passed.');
