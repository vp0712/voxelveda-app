const fs=require('fs');
const assert=require('assert');
const actionCenter=fs.readFileSync('public/personal-financial-action-center.js','utf8');
const assistant=fs.readFileSync('public/financial-decision-assistant.js','utf8');
const subscriptions=fs.readFileSync('public/personal-subscription-intelligence.js','utf8');
const debt=fs.readFileSync('public/personal-debt-intelligence.js','utf8');
const savings=fs.readFileSync('public/personal-savings-intelligence.js','utf8');
const wealth=fs.readFileSync('public/personal-wealth-position-intelligence.js','utf8');
const forecast=fs.readFileSync('public/personal-cashflow-forecast.js','utf8');

assert(assistant.includes('/personal-financial-action-center.js?v=20260916-action-center'),'Decision Assistant chain must load Personal Financial Action Center.');
for(const endpoint of ['/api/finance/personal-money/smart','/api/finance/personal-money/attention','/api/finance/personal-money/health','/api/finance/personal-money/roadmaps'])assert(actionCenter.includes(endpoint),`Action Center must reuse protected read API: ${endpoint}`);
assert(actionCenter.includes("credentials:'same-origin'"),'Action Center must preserve authenticated same-origin requests.');
assert(!/method\s*:\s*['\"](?:POST|PUT|PATCH|DELETE)/i.test(actionCenter),'Action Center must remain API read-only.');
for(const label of ['Do now','This week','Later','Mark done','Snooze 7 days','Dismiss','Why:','Next step:'])assert(actionCenter.includes(label),`Action Center must provide ${label}.`);
assert(actionCenter.includes('localStorage'),'Action Center organisational state must remain local-only.');
assert(actionCenter.includes('local organisational controls only'),'Action Center must explain local-only state.');
assert(actionCenter.includes('must require explicit approval'),'Any future record-changing action must require explicit approval.');

assert(actionCenter.includes('/personal-subscription-intelligence.js?v=20260916-subscription-intelligence'),'Action Center chain must load Subscription & Recurring Payment Intelligence.');
assert(subscriptions.includes('/api/finance/personal-money/attention'),'Subscription Intelligence must reuse protected Money Attention recurring data.');
assert(subscriptions.includes("credentials:'same-origin'"),'Subscription Intelligence must preserve authenticated same-origin requests.');
assert(!/method\s*:\s*['\"](?:POST|PUT|PATCH|DELETE)/i.test(subscriptions),'Subscription Intelligence must remain API read-only.');
for(const label of ['SUBSCRIPTION & RECURRING PAYMENT INTELLIGENCE','Monthly equivalent','Annual equivalent','Next renewal/due','Price check:','Review checklist:','Subscriptions only','Other recurring bills'])assert(subscriptions.includes(label),`Subscription Intelligence must explain ${label}.`);
assert(subscriptions.includes('No comparable prior amount available'),'Subscription Intelligence must disclose when price history is unavailable instead of guessing.');
assert(subscriptions.includes('currencies are never combined'),'Subscription Intelligence must keep currencies separate.');

assert(debt.includes('/personal-savings-intelligence.js?v=20260916-savings-intelligence'),'Debt Intelligence chain must load Savings Goal & Emergency Fund Intelligence.');
assert(savings.includes('/api/finance/personal-money/attention'),'Savings Intelligence must reuse protected savings-goal data.');
assert(savings.includes('/api/finance/personal-money/health'),'Savings Intelligence must reuse protected Financial Health data.');
assert(savings.includes('/api/finance/personal-money/smart'),'Savings Intelligence must reuse protected safe-to-spend data.');
assert(savings.includes("credentials:'same-origin'"),'Savings Intelligence must preserve authenticated same-origin requests.');
assert(!/method\s*:\s*['\"](?:POST|PUT|PATCH|DELETE)/i.test(savings),'Savings Intelligence must remain API read-only.');
for(const label of ['SAVINGS GOAL & EMERGENCY FUND INTELLIGENCE','Emergency-fund coverage','Configured safety buffer','Planning headroom','Active savings goals','What-if savings lab','Extra monthly contribution'])assert(savings.includes(label),`Savings Intelligence must explain ${label}.`);
assert(savings.includes('90-day average monthly spending'),'Emergency-fund coverage must disclose its spending basis.');
assert(savings.includes('positive monthly surplus capped by current safe-to-spend'),'Planning headroom must disclose its conservative rule.');
assert(savings.includes('only after the configured buffer is funded'),'Planning headroom must protect the configured buffer.');
assert(savings.includes('assumes no investment return, interest, fees or inflation'),'Savings scenario must disclose modelling limits.');
assert(savings.includes('currencies stay separate')||savings.includes('Currencies are never combined'),'Savings Intelligence must keep currencies separate.');
assert(savings.includes('never transfers money')&&savings.includes('does not move money'),'Savings Intelligence must disclose read-only planning behaviour.');
assert(savings.includes('must require explicit user approval'),'Any future balance-changing savings action must require explicit approval.');

assert(savings.includes('/personal-wealth-position-intelligence.js?v=20260916-wealth-position'),'Savings Intelligence chain must load Net Worth & Wealth Position Intelligence.');
for(const endpoint of ['/api/finance/personal-money/net-worth','/api/finance/personal-money/health'])assert(wealth.includes(endpoint),`Wealth Position Intelligence must reuse protected read API: ${endpoint}`);
assert(wealth.includes("credentials:'same-origin'"),'Wealth Position Intelligence must preserve authenticated same-origin requests.');
assert(!/method\s*:\s*['\"](?:POST|PUT|PATCH|DELETE)/i.test(wealth),'Wealth Position Intelligence must remain API read-only.');
for(const label of ['NET WORTH & WEALTH POSITION INTELLIGENCE','Net worth','Total assets','Total liabilities','Liquid position','Wealth composition','Liquidity-to-liabilities','Liabilities-to-assets','Snapshot trend','What-if wealth scenario'])assert(wealth.includes(label),`Wealth Position Intelligence must explain ${label}.`);
assert(wealth.includes('No FX conversion is applied')&&wealth.includes('Currencies are never combined'),'Wealth Position Intelligence must not silently convert or combine currencies.');
assert(wealth.includes('Bank balances and Personal Money wallets are already included automatically'),'Wealth Position Intelligence must warn against cash double-counting.');
assert(wealth.includes('Avoid entering the same borrowed money as both a debt and a Net Worth liability'),'Wealth Position Intelligence must warn against liability double-counting.');
assert(wealth.includes('never changes valuations, liabilities, cash, transactions, snapshots or accounting records'),'Wealth Position Intelligence must disclose read-only behaviour.');
assert(wealth.includes('must require explicit user approval'),'Any future record-changing wealth action must require explicit approval.');
for(const prohibited of ['finance_transactions','journal_entries','createJournal','/payments','/reconcile','method:\'POST\'','POST_TRANSACTION'])assert(!wealth.includes(prohibited),`Wealth Position Intelligence must not contain mutation path: ${prohibited}`);

assert(forecast.includes('a.d===dim(a.y,a.m)')&&forecast.includes('Math.min(a.d,dim(y,m))'),'Cash-flow forecast recurrence must clamp month-end dates rather than relying on JavaScript month rollover.');
assert(forecast.includes("r.frequency==='MONTHLY')s=shiftMonth(start,i)")&&forecast.includes("r.frequency==='QUARTERLY')s=shiftMonth(start,i*3)")&&forecast.includes("r.frequency==='YEARLY')s=shiftYear(start,i)"),'Cash-flow forecast must use month-end-safe recurrence for monthly, quarterly and yearly items.');

console.log('Personal Action Center, Subscription, Debt, Savings, Wealth Position Intelligence and forecast recurrence regression checks passed.');
