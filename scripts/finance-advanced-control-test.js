'use strict';
const assert=require('assert');
const fs=require('fs');
const advanced=fs.readFileSync('public/finance-advanced-control.js','utf8');
const master=fs.readFileSync('public/finance-master.js','utf8');
const app=fs.readFileSync('app.js','utf8');
const html=fs.readFileSync('public/finance-intelligence.html','utf8');

const advancedVersion=(advanced.match(/VERSION='([^']+)'/)||[])[1];
assert(/^20260924-advanced-control-v\d+$/.test(advancedVersion||''),'Advanced Finance release id is missing or invalid.');
assert(master.includes("['advanced','⚡','Control Centre']"),'Advanced Control must be the canonical Finance home module.');
assert(master.includes('function advancedControlView()'),'Advanced Control must mount inside the master Finance OS.');
assert(master.includes("view:'advanced',scope:'ALL'"),'Advanced Control must be the default Finance landing.');
assert(master.includes("if(v==='advanced')return advancedControlView();"),'Advanced Control navigation must render the Advanced Control view instead of falling through to Finance Settings.');
assert(master.includes('/finance-advanced-control.js?v='+advancedVersion),'Master OS must load the exact Advanced Control release declared by the asset.');
assert(app.includes("'finance-advanced-control.js'"),'Advanced Control must be allowlisted as a canonical Finance asset.');
assert(/\/finance-master\.js\?v=20260924-control-v\d+/.test(html),'Canonical Finance HTML must use a versioned master release.');

for(const label of [
  'Executive Cockpit','Action Queue','7 / 30 / 90 / 365-day Forecast','Scenario Lab',
  'Commitments, Debt & Savings Reserve Intelligence','Risk, Integrity & Control Readiness',
  'Tax, Evidence & Year-End Readiness','Company CFO Control','Cash Custody & Petty Cash Control','AR / AP Counterparty Control','Accountant Handover Readiness','Automation & Approval Control','Decision Intelligence — Plan A vs Plan B','Performance & Stress Control','CFO Anomaly & Explainability','Control Actions','Evidence Source Health'
]) assert(advanced.includes(label),`Advanced Finance Control must expose ${label}.`);

for(const endpoint of [
  '/api/finance/personal-money','/api/finance/personal-money/attention','/api/finance/personal-money/smart',
  '/api/finance/personal-money/health','/api/finance/personal-money/commitments-control','/api/finance/personal-money/savings-control','/api/finance/personal-money/tax-control','/api/finance/personal-money/roadmaps',
  '/api/finance/personal-money/data-quality-integrity','/api/finance/personal-money/net-worth',
  '/api/finance/personal-money/net-worth/lifecycle','/api/finance/company-summary','/api/finance/counterparty-control',
  '/api/finance/banking-os/command-center','/api/finance/intelligence/data-quality',
  '/api/finance/receipts','/api/finance/cash-control/custody','/api/finance/reimbursements','/api/finance/accountant-handover','/api/finance/personal-money/review-inbox','/api/finance/intelligence/banking-readiness','/api/notifications','/api/finance/intelligence/rules','/api/finance/close-assurance','/api/finance/performance-risk-control','/api/finance/issues'
]) assert(advanced.includes(endpoint),`Advanced Control must use protected canonical source ${endpoint}.`);

for(const horizon of ['7,30,90,365','knownProjection','scenarioProjection'])
  assert(advanced.includes(horizon),`Advanced forecasting contract missing ${horizon}.`);

assert(advanced.includes("credentials:'same-origin'"),'Advanced Control requests must preserve authenticated same-origin credentials.');
assert(advanced.includes('ADVANCED_REQUEST_TIMEOUT_MS=12000'),'Advanced Control API calls must have a bounded per-source timeout.');
assert(advanced.includes('ADVANCED_LOAD_BUDGET_MS=15000'),'Advanced Control must have a hard module-wide loading budget.');
assert(advanced.includes('for(let i=0;i<SOURCES.length;i+=ADVANCED_BATCH_SIZE)'),'Advanced Control must hydrate protected sources in bounded batches.');
assert(advanced.includes('cycle!==loadCycle'),'Advanced Control must reject stale source responses.');
assert(advanced.includes('data-fac-retry'),'Advanced Control source failures must be independently retryable.');
assert(advanced.includes('The current control picture stays available while sources update.'),'Advanced Control refresh must preserve the current screen.');
assert(advanced.includes('does not create a second ledger'),'Advanced Control must explicitly preserve the one-ledger architecture.');
assert(advanced.includes('combine currencies silently'),'Advanced Control must prohibit silent cross-currency aggregation.');
assert(!/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)/i.test(advanced),'Advanced Control must remain read-only against finance APIs.');
assert(!advanced.includes('/api/finance/banking-os/payments'),'Advanced Control must not create or execute payment requests.');
assert(!advanced.includes('/reconcile'),'Advanced Control must not directly reconcile transactions.');
assert(!advanced.includes('/ignore'),'Advanced Control must not ignore transactions.');
console.log('ADVANCED_FINANCE_CONTROL_OK');

assert(advanced.includes('data-fac-open'),'Advanced Control must drill into canonical actionable modules.');
assert(advanced.includes('function decisionIntelligence()'),'Plan A/B decision intelligence is missing.');
assert(advanced.includes('Arithmetic comparison, not a recommendation'),'Decision comparison must stay descriptive rather than prescriptive.');

assert(advanced.includes('Month-end close readiness'),'Advanced Control must surface period-close readiness.');
assert(advanced.includes('data-fac-open="closeassurance"'),'Advanced Control must drill into Close & Assurance.');

assert(advanced.includes('function accountantHandoverStatus()'),'Advanced Control must surface Accountant Handover readiness.');
assert(advanced.includes('data-fac-open="handover"'),'Advanced Control must drill into Accountant Handover.');

assert(advanced.includes('/api/finance/treasury-control'),'Advanced Finance Control must hydrate Treasury evidence.');
assert(advanced.includes('Treasury & Working Capital'),'Advanced Finance Control must surface Treasury & Working Capital.');

assert(advanced.includes('function performanceRiskControl()'),'Advanced Performance & Stress section is missing.');
assert(advanced.includes('data-fac-open="performance"'),'Advanced Control must drill into Performance & Stress.');

assert(advanced.includes('function controlActionsSummary()'),'Advanced Control Actions summary is missing.');
assert(advanced.includes('data-fac-open="controlactions"'),'Advanced Control must drill into Control Actions.');

assert(advanced.includes('/api/finance/anomaly-explain-control'),'Advanced Control must hydrate anomaly/explainability evidence.');
assert(advanced.includes('function anomalyExplainability()'),'Advanced anomaly/explainability section missing.');
assert(advanced.includes('data-fac-open="anomaly"'),'Advanced Control must drill into full anomaly/explainability workspace.');
assert(advanced.includes('data-fac-tx'),'Advanced Control must expose source transaction drill-down for explainability.');

assert(advanced.includes('function executiveReadinessBoard()'),'Executive readiness board function missing.');
assert(advanced.includes('Executive Control Readiness Board'),'Executive readiness board UI missing.');
assert(advanced.includes('CFO Daily Brief'),'CFO Daily Brief missing.');
assert(advanced.includes('No fake composite finance score'),'Readiness board must reject misleading composite scoring.');
assert(advanced.includes('data-fac-jump="facReadiness"'),'Readiness board must be directly navigable.');

assert(advanced.includes('Job Profitability & Cost Allocation'),'Advanced Control must expose Job Profitability.');
assert(advanced.includes('function jobProfitabilityControl()'),'Advanced Job Profitability function missing.');
assert(advanced.includes('Job allocation evidence'),'Executive readiness must include job allocation evidence.');

assert(advanced.includes('function counterpartyWorkingCapitalControl()'),'Advanced Counterparty Control section missing.');
assert(advanced.includes('data-fac-open="counterparties"'),'Advanced Control must drill into Customers & Suppliers.');

assert(advanced.includes('Savings & reserves'),'Advanced Control must expose Savings & Reserve intelligence.');
assert(advanced.includes("source:'Savings & Reserve'"),'Savings pace/emergency signals must feed the Advanced action queue.');
assert(advanced.includes('planning calculations from recorded Personal Money evidence')&&/do not move money automatically/i.test(advanced),'Advanced Savings intelligence must preserve its no-money-movement boundary.');

assert(advanced.includes('Emergency reserve coverage under 3.0 months'),'Advanced Control must surface savings reserve coverage signals.');
assert(advanced.includes('data-fac-open="savings"'),'Advanced Control must drill into canonical Savings & Reserve Control.');

assert(advanced.includes('function cashCustodyControl()'),'Advanced Cash Custody section missing.');
assert(advanced.includes('data-fac-open="cash"'),'Advanced Cash Custody must drill into canonical Cash Control.');
