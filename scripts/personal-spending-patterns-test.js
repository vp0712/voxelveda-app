const fs=require('fs');
const assert=require('assert');
const ui=fs.readFileSync('public/personal-spending-patterns.js','utf8');
const loader=fs.readFileSync('public/personal-roadmap-intelligence.js','utf8');
const controller=fs.readFileSync('controllers/personalSpendingChallengeController.js','utf8');

assert(loader.includes('/personal-spending-patterns.js?v=20260916-behaviour-patterns'),'Protected Personal Money chain must load Spending Behaviour Patterns.');
assert(ui.includes('/api/finance/personal-money/spending-challenges/progress'),'Behaviour Patterns must reuse the protected owner-private progress feed.');
assert(ui.includes("credentials:'same-origin'"),'Behaviour Patterns must preserve authenticated same-origin requests.');
assert(!/method\s*:\s*['\"](?:POST|PUT|PATCH|DELETE)/i.test(ui),'Behaviour Patterns UI must remain read-only.');
for(const prohibited of ['finance_transactions','createJournal','POST_TRANSACTION','/payments','/reconcile','/insights/${','/apply'])assert(!ui.includes(prohibited),`Behaviour Patterns must not contain financial mutation path: ${prohibited}`);
assert(controller.includes("ba.created_by=? AND ba.ownership_scope='PERSONAL' AND bt.ownership_scope='PERSONAL' AND bt.is_internal_transfer=0"),'Pattern source must remain signed-in-owner PERSONAL bank data and exclude internal transfers.');
assert(controller.includes("WHERE e.user_id=? AND e.entry_type IN ('EXPENSE','CASH_OUT')"),'Manual cash pattern data must remain owner scoped.');
for(const label of ['Weekend share','Frequent small purchases','Merchant concentration','Spending-day frequency','Highest-spend weekday','Category change'])assert(ui.includes(label),`Behaviour Patterns must explain ${label}.`);
assert(ui.includes('not trustworthy time-of-day')||ui.includes('not trustworthy time-of-day'.replace('not ',''))||ui.includes('not trustworthy time-of-day for every purchase'),'Behaviour Patterns must disclose time-of-day data limits.');
assert(ui.includes('payday correlation is not inferred without income-date evidence'),'Behaviour Patterns must not infer payday behaviour without income evidence.');
assert(ui.includes('currencies kept separate'),'Behaviour Patterns must keep currencies separate.');
assert(ui.includes('never saved as a behavioural profile'),'Behaviour Patterns must explain that inferred patterns are not persisted as a profile.');
console.log('Personal Spending Behaviour Patterns regression checks passed.');
