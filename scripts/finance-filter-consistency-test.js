'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const intelligence=require('../controllers/financeIntelligenceController')._test;
const reports=require('../controllers/financeReportBuilderController')._test;

const dashboardReq={user:{id:17},query:{scope:'BUSINESS',account_id:'42',from:'2026-08-01',to:'2026-08-31',currency:'AUD'}};
const reportReq={user:{id:17},query:{scope:'BUSINESS',account_ids:'42',from:'2026-08-01',to:'2026-08-31',currency:'AUD'}};
const dashboard=intelligence.spendingWhere(dashboardReq);
const report=reports.buildFilters(reportReq);

assert.equal(report.where,dashboard.where,'dashboard, explorer and reports must share the same core Finance filter SQL');
assert.deepEqual(report.params,dashboard.params,'dashboard, explorer and reports must bind identical core Finance filter values');
assert.equal(report.scope,dashboard.scope);
assert.equal(report.from,dashboard.from);
assert.equal(report.to,dashboard.to);
assert.equal(report.currency,dashboard.currency);
assert.deepEqual(report.account_ids,dashboard.account_ids);

const controller=fs.readFileSync(path.join(__dirname,'..','controllers','financeIntelligenceController.js'),'utf8');
const reportController=fs.readFileSync(path.join(__dirname,'..','controllers','financeReportBuilderController.js'),'utf8');
assert.match(controller,/const filters = spendingWhere\(req\);[\s\S]{0,500}const txWhere = filters\.where/,'dashboard must consume the canonical core filter');
assert.match(controller,/const core = spendingWhere\(req\);/,'transaction explorer must consume the canonical core filter');
assert.match(controller,/exports\.getStatementLibrary[\s\S]{0,900}sif\.parse_status='IMPORTED'/,'Statement Vault must return only active imported statements so soft-removed statements stay out after refresh.');
assert.match(reportController,/buildCoreBankTransactionFilter\(req/,'report builder must consume the canonical core filter');

console.log('FINANCE_FILTER_CONSISTENCY_TEST_OK');
