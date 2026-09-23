'use strict';
const assert=require('assert');
const fs=require('fs');
const routes=fs.readFileSync('routes/financeRoutes.js','utf8');
const service=fs.readFileSync('services/financeCloseAssuranceService.js','utf8');
const controller=fs.readFileSync('controllers/financeCloseAssuranceController.js','utf8');
const ops=fs.readFileSync('controllers/financeOperationsController.js','utf8');
const schema=fs.readFileSync('services/financeSchema.js','utf8');
const migration=fs.readFileSync('migrations/20260924_finance_close_assurance.sql','utf8');
const master=fs.readFileSync('public/finance-master.js','utf8');
const advanced=fs.readFileSync('public/finance-advanced-control.js','utf8');

for(const route of ["router.get('/close-assurance'","/close-assurance/:periodId/snapshot","/close-assurance/:periodId/certify","/close-assurance/:periodId/reopen"])
  assert(routes.includes(route),'Close Assurance route missing: '+route);
assert(routes.includes("requireStepUp('CHANGE_ACCOUNTING_PERIOD')"),'Close certification and reopen must use step-up.');

for(const id of ['DRAFT_LEDGER','LEDGER_RECONCILIATION','TAX_CODE_COMPLETENESS','DRAFT_JOURNALS','BALANCED_JOURNALS','BANK_CLASSIFICATION','BANK_OWNERSHIP','BANK_RECONCILIATION','RECEIPT_EVIDENCE','CASH_VARIANCE','SUPPLIER_APPROVALS','ACCOUNTANT_QUERIES','HIGH_FINANCE_ISSUES','CASH_COUNT_COVERAGE','BANK_ACTIVITY_COVERAGE'])
  assert(service.includes("id:'"+id+"'"),'Missing close control '+id);
assert(service.includes("fingerprint = hash(JSON.stringify(evidence))"),'Close evidence must have a deterministic fingerprint.');
assert(service.includes("blockerCount===0?'READY_TO_CERTIFY':'NOT_READY'"),'Close readiness must be blocker driven.');

assert(controller.includes('FINANCE_PERIOD_CLOSE_CERTIFIED'),'Close certification must be audit logged.');
assert(controller.includes("status='CERTIFIED'"),'Certified close-run state missing.');
assert(controller.includes("status='READY'"),'Certification may mark a clean accounting period READY.');
assert(!controller.includes("status='LOCKED'"),'Certification must never automatically lock an accounting period.');
assert(controller.includes('Historical snapshots were retained'),'Reopening certification must retain close snapshots.');

assert(ops.includes('FINANCE_CLOSE_CERTIFICATION_REQUIRED'),'Period lock must require close certification.');
assert(ops.includes('FINANCE_CLOSE_CERTIFICATION_STALE'),'Period lock must reject stale certification.');
assert(ops.includes('computePeriodCloseReadiness'),'Period lock must recompute current close evidence.');
assert(ops.includes('closeRun.certified_fingerprint!==closeReadiness.fingerprint'),'Period lock must compare the certified evidence fingerprint.');

assert(schema.includes('CREATE TABLE IF NOT EXISTS finance_period_close_runs'),'Close run schema bootstrap missing.');
assert(schema.includes('CREATE TABLE IF NOT EXISTS finance_period_close_snapshots'),'Close snapshot schema bootstrap missing.');
assert(migration.includes('CREATE TABLE IF NOT EXISTS finance_period_close_runs'),'Close run migration missing.');
assert(migration.includes('CREATE TABLE IF NOT EXISTS finance_period_close_snapshots'),'Close snapshot migration missing.');
assert(!/\b(?:DROP|TRUNCATE)\b/i.test(migration),'Close Assurance migration must be additive.');

for(const marker of ['MONTH-END CLOSE & ASSURANCE','Immutable close evidence history','function closeAssuranceView()',"if(v==='closeassurance')return closeAssuranceView();","['closeassurance','✓','Close & Assurance']"])
  assert(master.includes(marker),'Close Assurance UI missing '+marker);
assert(master.includes("['closeAssurance',API+'/close-assurance']"),'Close Assurance must hydrate inside canonical Finance OS.');
assert(master.includes('data-viewjump="receipts"')||master.includes("action_view:'receipts'"),'Close controls must drill into evidence workflows.');

assert(advanced.includes("['closeAssurance','/api/finance/close-assurance']"),'Advanced Control must surface Close Assurance evidence.');
assert(advanced.includes('Month-end close readiness'),'Advanced Control must show close readiness.');
assert(advanced.includes('data-fac-open="closeassurance"'),'Advanced Control must drill into Close Assurance.');
console.log('FINANCE_CLOSE_ASSURANCE_OK');
