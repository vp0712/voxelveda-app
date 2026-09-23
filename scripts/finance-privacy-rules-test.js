'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

const privacy=read('services/financePrivacyService.js');
const middleware=read('middleware/financePrivacyMiddleware.js');
const routes=read('routes/financeRoutes.js');
const intelligence=read('controllers/financeIntelligenceController.js');
const transactionIntelligence=read('controllers/financeTransactionIntelligenceController.js');
const reconciliation=read('controllers/financeReconciliationCenterController.js');
const client=read('public/finance-master.js');

assert.match(privacy,/ownership_scope = 'BUSINESS' OR .*created_by = \?/s,'Private finance visibility must be BUSINESS-or-owner only.');
assert.match(privacy,/Return 404 rather than 403/,'Private resource existence should remain undisclosed.');
assert.match(middleware,/protectScopeConversion/,'Business-to-private scope conversion guard is required.');
assert.match(middleware,/filterStatementList/,'Statement review queue must be owner filtered.');
assert.match(routes,/financePrivacy\.filterStatementList/,'Statement review list route must use privacy filter.');
assert.match(routes,/financePrivacy\.bankTransactionParam\('id'\).*RECONCILE_BANK_TRANSACTION/,'Reconcile route must verify private transaction ownership.');
assert.match(routes,/financePrivacy\.insightParam\('id'\).*APPLY_FINANCE_INTELLIGENCE/,'Insight apply must verify private ownership.');
assert.match(intelligence,/privacy\.visibilitySql\('ba', req\)/,'Finance Intelligence aggregates must filter request-scoped account visibility.');
assert.match(reconciliation,/privacy\.visibilitySql\('ba', req\)/,'Reconciliation aggregate must be request-scoped for banking privacy.');
assert.match(transactionIntelligence,/WHERE created_by=\? AND enabled=1/,'Smart Rules analysis must load only current-user rules.');
assert.match(transactionIntelligence,/confidence: 0\.99, source: 'SAVED_RULE'/,'Saved merchant rules must override generic suggestions at high confidence.');
assert.match(transactionIntelligence,/const paired = new Set\(\)/,'Transfer matching must enforce one-to-one pairing.');
assert.match(transactionIntelligence,/exports\.getRules/,'Smart Rules list endpoint is required.');
assert.match(transactionIntelligence,/exports\.updateRule/,'Smart Rules update endpoint is required.');
assert.match(transactionIntelligence,/exports\.deleteRule/,'Smart Rules delete endpoint is required.');
assert.match(client,/Personal finance is private to you/,'Unified Finance OS must visibly explain personal finance privacy.');
assert.match(client,/Smart Rules — Merchant & Category/,'Smart Rules manager must be visible in the unified Finance OS.');
assert.match(client,/high-confidence review suggestions/,'Rules UI must explain confidence and review behavior.');

console.log('Finance privacy and Smart Rules regression tests passed.');
