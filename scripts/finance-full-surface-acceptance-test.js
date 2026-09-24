'use strict';
const assert=require('assert');
const fs=require('fs');

const master=fs.readFileSync('public/finance-master.js','utf8');
const advanced=fs.readFileSync('public/finance-advanced-control.js','utf8');
const routes=fs.readFileSync('routes/financeRoutes.js','utf8');
const html=fs.readFileSync('public/finance-intelligence.html','utf8');
const suite=fs.readFileSync('scripts/finance-production-regression-suite.js','utf8');

assert(master.includes("view:'advanced',scope:'ALL'"),'Finance must open on the Control Centre.');
assert(html.includes('/finance-master.js?v=20260924-counterparty-v1'),'Canonical Finance release cache id is stale.');
assert(advanced.includes("VERSION='20260924-advanced-control-v10'"),'Advanced Control release id is stale.');

const navBlock=master.slice(master.indexOf('const NAV_GROUPS=['),master.indexOf('];',master.indexOf('const NAV_GROUPS=['))+2);
const navKeys=[...navBlock.matchAll(/\['([a-z0-9]+)','[^']*','[^']+'\]/g)].map(m=>m[1]);
assert(navKeys.length>=40,'Finance navigation unexpectedly lost major modules.');
assert.equal(new Set(navKeys).size,navKeys.length,'Finance navigation contains duplicate module keys.');

const directRender={
  advanced:'advancedControlView()',personal:'personalView()',company:'companyView()',consolidated:'consolidatedView()',
  bankops:'bankingOperationsView()',cash:'cashView()',currency:'currencyView()',transfers:'transfersView()',refunds:'refundsView()',
  reimbursements:'reimbursementsView()',counterparties:'counterpartyControlView()',debt:'debtControlView()',recurring:'recurringControlView()',history:'historyImportView()',
  receipts:'receiptsView()',planning:'planningControlView()',budgets:'budgetsView()',savings:'savingsControlView()',networth:'netWorthView()',
  forecast:'forecastView()',calendar:'calendarView()',treasury:'treasuryControlView()',performance:'performanceRiskView()',
  profitability:'jobProfitabilityView()',insights:'insightsView()',anomaly:'anomalyExplainView()',rules:'rulesView()',review:'reviewView()',
  controlactions:'controlActionsView()',reconciliation:'reconciliationView()',reports:'reportView()',handover:'accountantHandoverView()',
  taxcontrol:'taxEvidenceControlView()',evidenceaudit:'evidenceAuditView()',closeassurance:'closeAssuranceView()',protection:'protectionControlView()',
  securityprivacy:'securityPrivacyView()',setupcentre:'setupCentreView()',notifications:'notificationsView()',team:'teamView()',connections:'connectionsView()'
};
for(const [key,renderer] of Object.entries(directRender)){
  assert(navKeys.includes(key),`Finance navigation missing ${key}`);
  assert(master.includes("if(v==='"+key+"')return "+renderer+";"),`Finance view ${key} is not bound to ${renderer}`);
}
for(const core of ['overview','accounts','transactions','statements','settings'])assert(navKeys.includes(core),`Core Finance navigation missing ${core}`);
const simpleViewBlock=master.slice(master.indexOf('function simpleView(v){'),master.indexOf('window.__financeOpenTransaction',master.indexOf('function simpleView(v){')));
const explicitlyBound=new Set([...simpleViewBlock.matchAll(/v==='([^']+)'/g)].map(m=>m[1]));
const coreRendered=new Set(['overview','accounts','transactions','statements','settings']);
for(const key of navKeys){
  assert(coreRendered.has(key)||explicitlyBound.has(key),`every Finance navigation module must resolve explicitly: ${key}`);
}


for(const source of [
 "['cashControl',API+'/cash-control']","['debtPlanner',API+'/personal-money/debt-planner']","['commitments',API+'/personal-money/commitments-control']",
 "['closeAssurance',API+'/close-assurance']","['treasuryControl',API+'/treasury-control']",
 "['performanceRisk',API+'/performance-risk-control']","['anomalyExplain',API+'/anomaly-explain-control']",
 "['planningControl',API+'/planning-control']","['jobProfitability',API+'/job-profitability'","['counterpartyControl',API+'/counterparty-control']",
 "['handover',API+'/accountant-handover']","['personalIntegrity',API+'/personal-money/data-quality-integrity']","['personalTaxControl',API+'/personal-money/tax-control']"
]) assert(master.includes(source),`Finance hydration source missing ${source}`);

for(const route of [
 "router.get('/job-profitability'","router.get('/counterparty-control'","router.get('/cash-control'","router.get('/personal-money/debt-planner'","router.get('/personal-money/commitments-control'",
 "router.get('/close-assurance'","router.get('/treasury-control'","router.get('/performance-risk-control'",
 "router.get('/anomaly-explain-control'","router.get('/planning-control'","router.get('/accountant-handover'",
 "router.get('/reports/builder'","router.get('/personal-money/data-quality-integrity'","router.get('/personal-money/tax-control'"
]) assert(routes.includes(route),`Critical Finance API route missing ${route}`);

for(const phrase of ['TODO','COMING SOON','NOT IMPLEMENTED','PLACEHOLDER ONLY']){
  assert(!master.toUpperCase().includes(phrase),`Canonical Finance UI still contains ${phrase}`);
}
assert(master.includes('FINANCE_REQUEST_TIMEOUT_MS=12000'),'Finance requests must remain bounded.');
assert(master.includes('FINANCE_HYDRATION_BATCH_SIZE=5'),'Finance hydration must remain batched.');
assert(suite.includes('"finance-job-profitability-test.js"'),'Job Profitability must remain in the production regression suite.');
assert(suite.includes('"finance-counterparty-control-test.js"'),'Counterparty Control must remain in the production regression suite.');
assert(suite.includes('"personal-recurring-commitment-control-test.js"'),'Recurring Commitment Control must remain in the production regression suite.');
assert(suite.includes('"personal-tax-evidence-control-test.js"'),'Personal Tax Evidence Control must remain in the production regression suite.');
assert(suite.includes('"finance-full-surface-acceptance-test.js"'),'Full-surface acceptance must gate production.');
console.log('FINANCE_FULL_SURFACE_ACCEPTANCE_OK '+navKeys.length+' modules');
