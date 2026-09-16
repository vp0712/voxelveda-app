const fs=require('fs');
const assert=require('assert');
const ui=fs.readFileSync('public/personal-finance-disaster-recovery-restore-approval.js','utf8');
const step=fs.readFileSync('public/step-up.js','utf8');

assert(step.includes('/personal-finance-disaster-recovery-restore-approval.js?v=20260916-disaster-recovery'),'Authenticated shell must load Disaster Recovery & Restore Approval Center.');
for(const endpoint of ['/api/finance/personal-money','/api/finance/personal-money/attention','/api/finance/personal-money/smart','/api/finance/personal-money/health?fy_start=','/api/finance/personal-money/data-quality-integrity','/api/finance/personal-money/saved-views','/api/finance/personal-money/spending-challenges','/api/finance/personal-money/net-worth','/api/finance/personal-money/net-worth/lifecycle','/api/finance/personal-money/roadmaps'])assert(ui.includes(endpoint),`Recovery Center must compare against protected PERSONAL source: ${endpoint}`);
assert(ui.includes("credentials:'same-origin'"),'Recovery Center must preserve authenticated same-origin credentials.');
for(const label of ['PERSONAL FINANCE DISASTER RECOVERY & RESTORE APPROVAL CENTER','KEEP_CURRENT','ADD','REPLACE','SKIP','Before','Backup','Proposed result','Run dry-run validation','Verify & create approval package','Fail-closed restore governance'])assert(ui.includes(label),`Recovery Center must expose ${label}.`);
assert(ui.includes('PERSONAL_ONLY')&&ui.includes('payload_sha256'),'Recovery Center must require PERSONAL scope and backup integrity.');
assert(ui.includes('SOURCE_ORDER')&&ui.includes('dependency_order'),'Recovery Center must make recovery dependency order explicit.');
assert(ui.includes("window.stepUpSecurity.verify('PERSONAL_FINANCE_RESTORE_APPROVAL')"),'Final approval package must require fresh step-up verification.');
assert(ui.includes("execution:{allowed:false")&&ui.includes('Canonical restore adapters are not enabled'),'Restore execution must fail closed until canonical adapters exist.');
assert(!/method\s*:\s*['\"](?:POST|PUT|PATCH|DELETE)/i.test(ui),'Recovery Center must not call any mutation API in this release.');
for(const prohibited of ['/payments','/reconcile','/classify','createJournal','POST_TRANSACTION','RECONCILE_BANK_TRANSACTION','router.post','router.put','router.patch','router.delete'])assert(!ui.includes(prohibited),`Recovery Center must not contain restore/finance mutation path: ${prohibited}`);
assert(ui.includes('derived totals, summaries and bounded history')&&ui.includes('could corrupt balances or duplicate calculated data'),'Recovery Center must explain why snapshot writes are unsafe.');
assert(ui.includes('no transaction, balance, debt, savings, tax, evidence, insurance, reconciliation, journal or company-accounting record can be changed'),'Recovery Center must state fail-closed finance boundaries.');
require('./personal-finance-canonical-backup-engine-test');
console.log('Personal Finance Disaster Recovery & Restore Approval Center regression checks passed.');