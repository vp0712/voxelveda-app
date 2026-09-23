'use strict';
const { spawnSync }=require('node:child_process');
const path=require('node:path');

const tests=[
  "finance-original-requirements-acceptance-test.js",
  "finance-bootstrap-resilience-test.js",
  "finance-unified-runtime-regression-test.js",
  "finance-master-os-test.js",
  "finance-control-centre-completion-test.js",
  "finance-advanced-control-test.js",
  "finance-cash-control-test.js",
  "personal-debt-control-test.js",
  "finance-personal-control-surfaces-test.js",
  "finance-close-assurance-test.js",
  "finance-treasury-control-test.js",
  "finance-performance-risk-control-test.js",
  "finance-control-actions-test.js",
  "finance-governance-controls-test.js",
  "finance-accountant-handover-test.js",
  "finance-privacy-rules-test.js",
  "finance-trusted-totals-test.js",
  "finance-filter-consistency-test.js",
  "finance-original-bank-data-test.js",
  "finance-statement-review-test.js",
  "finance-import-wizard-test.js",
  "finance-reconciliation-center-test.js",
  "finance-action-reliability-test.js",
  "finance-intelligence-admin-integration-test.js",
  "finance-relationship-workflows-test.js",
  "finance-reimbursement-settlement-test.js",
  "finance-receipt-audit-center-test.js",
  "finance-report-builder-v2-test.js",
  "finance-xlsx-export-test.js",
  "finance-transaction-lifecycle-test.js",
  "finance-planning-controls-test.js",
  "finance-global-search-company-security-test.js",
  "finance-bulk-review-rules-v2-test.js",
  "finance-fx-rates-test.js",
  "finance-unified-net-worth-test.js",
  "finance-unified-roadmap-test.js",
  "finance-legacy-ui-gate-test.js"
];

for(const file of tests){
  const full=path.join(__dirname,file);
  const result=spawnSync(process.execPath,[full],{stdio:'inherit',env:{...process.env,NODE_ENV:'test'}});
  if(result.status!==0){
    console.error('FINANCE_PRODUCTION_REGRESSION_FAILED '+file);
    process.exit(result.status||1);
  }
}
console.log('FINANCE_PRODUCTION_REGRESSION_SUITE_OK '+tests.length+' checks');
