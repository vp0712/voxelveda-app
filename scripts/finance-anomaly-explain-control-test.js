'use strict';
const assert=require('assert');
const fs=require('fs');
const routes=fs.readFileSync('routes/financeRoutes.js','utf8');
const controller=fs.readFileSync('controllers/financeAnomalyExplainController.js','utf8');
const master=fs.readFileSync('public/finance-master.js','utf8');
const advanced=fs.readFileSync('public/finance-advanced-control.js','utf8');

assert(routes.includes("router.get('/anomaly-explain-control'"),'Anomaly & Explainability route missing.');
assert(routes.includes('financeAnomalyExplain.getCenter'),'Anomaly & Explainability controller binding missing.');
for(const marker of ['current_30d','previous_30d','category_shifts','merchant_shifts','outliers','analysis_readiness','change_percent','current_transaction_ids'])
  assert(controller.includes(marker),'Anomaly engine missing '+marker);
assert(controller.includes('privacy.visibilitySql'),'Anomaly engine must enforce account visibility.');
assert(controller.includes('bank_transaction_splits'),'Category explainability must respect split allocations.');
assert(controller.includes('No silent FX conversion or cross-currency aggregation'),'Anomaly engine must prohibit silent FX aggregation.');
assert(controller.includes('deterministic share-and-change checks'),'Anomaly signals must state their deterministic boundary.');
assert(controller.includes('Anomaly & Explainability is read-only'),'Read-only boundary missing.');
assert(controller.includes('at least 90 observed days'),'Readiness threshold must be transparent.');
assert(!/UPDATE\s+bank_|INSERT\s+INTO\s+bank_transactions|DELETE\s+FROM\s+bank_/i.test(controller),'Anomaly read model must not mutate bank ledger.');

for(const marker of ['CFO ANOMALY & EXPLAINABILITY','30-day change explanation','Category shifts','Merchant shifts','Large transaction outliers','function anomalyExplainView()',"if(v==='anomaly')return anomalyExplainView();","['anomaly','≈','Anomaly & Explain']"])
  assert(master.includes(marker),'Anomaly UI missing '+marker);
assert(master.includes("['anomalyExplain',API+'/anomaly-explain-control']"),'Anomaly evidence must hydrate in master OS.');
assert(master.includes('window.__financeOpenTransaction=transactionDetail'),'Explainability must drill to preserved transaction evidence.');

assert(advanced.includes("['anomalyExplain','/api/finance/anomaly-explain-control']"),'Advanced Control must hydrate anomaly evidence.');
assert(advanced.includes('function anomalyExplainability()'),'Advanced anomaly section missing.');
assert(advanced.includes('data-fac-open="anomaly"'),'Advanced anomaly section must open the full workspace.');
assert(advanced.includes('data-fac-tx'),'Advanced anomaly section must provide source transaction drill-down.');
console.log('FINANCE_ANOMALY_EXPLAIN_CONTROL_OK');
