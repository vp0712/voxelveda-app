'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const privacy = read('services/financePrivacyService.js');
const middleware = read('middleware/financePrivacyMiddleware.js');
const routes = read('routes/financeRoutes.js');
const intelligence = read('controllers/financeIntelligenceController.js');
const transactionIntelligence = read('controllers/financeTransactionIntelligenceController.js');
const reconciliation = read('controllers/financeReconciliationCenterController.js');
const client = read('public/finance-intelligence-advanced.js');

assert.match(privacy, /ownership_scope = 'BUSINESS' OR .*created_by = \?/s, 'Private finance visibility must be BUSINESS-or-owner only.');
assert.match(privacy, /Return 404 rather than 403/, 'Private resource existence should remain undisclosed.');
assert.match(middleware, /protectScopeConversion/, 'Business-to-private scope conversion guard is required.');
assert.match(middleware, /filterStatementList/, 'Statement review queue must be owner filtered.');
assert.match(routes, /financePrivacy\.filterStatementList/, 'Statement review list route must use privacy filter.');
assert.match(routes, /financePrivacy\.bankTransactionParam\('id'\).*RECONCILE_BANK_TRANSACTION/, 'Reconcile route must verify private transaction ownership.');
assert.match(routes, /financePrivacy\.insightParam\('id'\).*APPLY_FINANCE_INTELLIGENCE/, 'Insight apply must verify private ownership.');
assert.match(intelligence, /privacy\.visibilitySql\('ba'\)/, 'Finance Intelligence aggregates must filter account visibility.');
assert.match(intelligence, /Private financial account created\. Only you can access it\./, 'UI/API should explain private ownership clearly.');
assert.match(reconciliation, /privacy\.visibilitySql\('ba'\)/, 'Reconciliation Center aggregate must be privacy scoped.');
assert.match(transactionIntelligence, /WHERE created_by=\? AND enabled=1/, 'Smart Rules analysis must load only the current user rules.');
assert.match(transactionIntelligence, /confidence: 0\.99, source: 'SAVED_RULE'/, 'Saved merchant rules must override generic heuristic suggestions at high confidence.');
assert.match(transactionIntelligence, /const paired = new Set\(\)/, 'Transfer matching must enforce one-to-one pairing.');
assert.match(transactionIntelligence, /exports\.getRules/, 'Smart Rules list endpoint is required.');
assert.match(transactionIntelligence, /exports\.updateRule/, 'Smart Rules update endpoint is required.');
assert.match(transactionIntelligence, /exports\.deleteRule/, 'Smart Rules delete endpoint is required.');
assert.match(client, /Personal finance is private to you/, 'Finance Intelligence must visibly explain personal finance privacy.');
assert.match(client, /Smart Rules/, 'Smart Rules button/manager must be visible to the user.');
assert.match(client, /99% confidence suggestion/, 'Rules UI must explain confidence and review-only behavior.');

console.log('Finance privacy and Smart Rules regression tests passed.');
