'use strict';
const assert=require('assert');
const fs=require('fs');
const advanced=fs.readFileSync('public/finance-advanced-control.js','utf8');
const master=fs.readFileSync('public/finance-master.js','utf8');
const app=fs.readFileSync('app.js','utf8');
const html=fs.readFileSync('public/finance-intelligence.html','utf8');

assert(advanced.includes("VERSION='20260924-advanced-control-v1'"),'Advanced Finance release id is missing.');
assert(master.includes("['advanced','⚡','Control Centre']"),'Advanced Control must be the canonical Finance home module.');
assert(master.includes('function advancedControlView()'),'Advanced Control must mount inside the master Finance OS.');
assert(master.includes("view:'advanced',scope:'ALL'"),'Advanced Control must be the default Finance landing.');
assert(master.includes("if(v==='advanced')return advancedControlView();"),'Advanced Control navigation must render the Advanced Control view instead of falling through to Finance Settings.');
assert(master.includes('/finance-advanced-control.js?v=20260924-advanced-control-v1'),'Master OS must load the versioned Advanced Control asset.');
assert(app.includes("'finance-advanced-control.js'"),'Advanced Control must be allowlisted as a canonical Finance asset.');
assert(html.includes('/finance-master.js?v=20260924-advanced-control-v1'),'Canonical Finance HTML must cache-bust the Advanced Control release.');

for(const label of [
  'Executive Cockpit','Action Queue','7 / 30 / 90 / 365-day Forecast','Scenario Lab',
  'Subscription, Debt & Savings Intelligence','Risk, Integrity & Control Readiness',
  'Tax, Evidence & Year-End Readiness','Company CFO Control','Evidence Source Health'
]) assert(advanced.includes(label),`Advanced Finance Control must expose ${label}.`);

for(const endpoint of [
  '/api/finance/personal-money','/api/finance/personal-money/attention','/api/finance/personal-money/smart',
  '/api/finance/personal-money/health','/api/finance/personal-money/roadmaps',
  '/api/finance/personal-money/data-quality-integrity','/api/finance/personal-money/net-worth',
  '/api/finance/personal-money/net-worth/lifecycle','/api/finance/company-summary',
  '/api/finance/banking-os/command-center','/api/finance/intelligence/data-quality',
  '/api/finance/receipts','/api/finance/reimbursements'
]) assert(advanced.includes(endpoint),`Advanced Control must use protected canonical source ${endpoint}.`);

for(const horizon of ['7,30,90,365','knownProjection','scenarioProjection'])
  assert(advanced.includes(horizon),`Advanced forecasting contract missing ${horizon}.`);

assert(advanced.includes("credentials:'same-origin'"),'Advanced Control requests must preserve authenticated same-origin credentials.');
assert(advanced.includes('setTimeout(()=>controller.abort(),12000)'),'Advanced Control API calls must have a bounded timeout.');
assert(advanced.includes('for(let i=0;i<SOURCES.length;i+=4)'),'Advanced Control must hydrate protected sources in bounded batches.');
assert(advanced.includes('does not create a second ledger'),'Advanced Control must explicitly preserve the one-ledger architecture.');
assert(advanced.includes('combine currencies silently'),'Advanced Control must prohibit silent cross-currency aggregation.');
assert(!/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)/i.test(advanced),'Advanced Control must remain read-only against finance APIs.');
assert(!advanced.includes('/api/finance/banking-os/payments'),'Advanced Control must not create or execute payment requests.');
assert(!advanced.includes('/reconcile'),'Advanced Control must not directly reconcile transactions.');
assert(!advanced.includes('/ignore'),'Advanced Control must not ignore transactions.');
console.log('ADVANCED_FINANCE_CONTROL_OK');
