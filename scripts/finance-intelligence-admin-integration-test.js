const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { injectFinanceIntelligence } = require('../services/adminPageRenderer');

const root = path.join(__dirname, '..');
const adminHtml = fs.readFileSync(path.join(root, 'public', 'admin-dashboard.html'), 'utf8');
const rendered = injectFinanceIntelligence(adminHtml);
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const financeHtml = fs.readFileSync(path.join(root, 'public', 'finance-intelligence.html'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'routes', 'financeRoutes.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations', '20260915_finance_transaction_intelligence.sql'), 'utf8');

assert(rendered.includes('data-title="Finance Intelligence"'), 'admin sidebar must expose Finance Intelligence');
assert(rendered.includes('Open Finance Intelligence'), 'admin banking tab must expose Finance Intelligence launch button');
assert(appSource.includes("app.get('/finance-intelligence',noIndex,pageAuth({workspaceOnly:true})"), 'Finance Intelligence page must use workspace page authentication');
assert(appSource.includes("app.get('/finance-intelligence.html',redirectPreservingQuery('/finance-intelligence'))"), 'direct .html route must redirect to protected route');
assert(financeHtml.includes('FINANCE OPERATING SYSTEM'), 'master Finance OS must be visible');
const masterFinance = fs.readFileSync(path.join(root, 'public', 'finance-master.js'), 'utf8');\nassert(masterFinance.includes('Analyse Transactions'), 'analysis action must be visible in the Master OS review center');
assert(financeHtml.includes('finance-master.js'), 'master finance UI script must be loaded');
assert(routes.includes("'/intelligence/analyse'"), 'analysis API route must exist');
assert(routes.includes("'/intelligence/insights/:id/apply'"), 'insight apply API route must exist');
assert(migration.includes('finance_transaction_insights'), 'transaction insight schema must exist');
assert(migration.includes('finance_category_rules'), 'merchant rule schema must exist');
console.log('Finance Intelligence admin integration test passed.');
