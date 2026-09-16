const fs=require('fs');
const assert=require('assert');
const controller=fs.readFileSync('controllers/personalFinanceCanonicalRestoreController.js','utf8');
const routes=fs.readFileSync('routes/financeRoutes.js','utf8');
const migration=fs.readFileSync('migrations/20260916_personal_finance_restore_executor.sql','utf8');
const ui=fs.readFileSync('public/personal-finance-transaction-safe-restore-executor.js','utf8');
const canonicalUi=fs.readFileSync('public/personal-finance-canonical-backup-engine.js','utf8');

for(const route of [
  "router.get('/personal-money/canonical-restore/status', requireAnyPermission('VIEW_BANKING')",
  "router.post('/personal-money/canonical-restore/dry-run', requireAnyPermission('VIEW_BANKING'), requireStepUp('PREVIEW_PERSONAL_FINANCE_RESTORE')",
  "router.post('/personal-money/canonical-restore/execute', requireAnyPermission('EDIT_FINANCE'), requireStepUp('RESTORE_PERSONAL_FINANCE')",
  "router.post('/personal-money/canonical-restore/:id/rollback', requireAnyPermission('EDIT_FINANCE'), requireStepUp('ROLLBACK_PERSONAL_FINANCE_RESTORE')"
]) assert(routes.includes(route),`Missing protected restore route: ${route}`);

for(const mark of ['validatePackage','RESTORE_PACKAGE_HASH_MISMATCH','RESTORE_RECORD_HASH_MISMATCH','RESTORE_DATASET_HASH_MISMATCH','RESTORE_OWNER_MISMATCH','RESTORE_OWNER_COLLISION','RESTORE_DEPENDENCY_MISMATCH'])assert(controller.includes(mark),`Restore executor must enforce ${mark}.`);
assert(controller.includes("const ACTIONS=new Set(['KEEP_CURRENT','ADD','REPLACE','SKIP'])"),'Restore actions must be explicit and bounded.');
assert(controller.includes("const CONFIRM_PHRASE='RESTORE PERSONAL FINANCE'")&&controller.includes("const ROLLBACK_PHRASE='ROLL BACK PERSONAL FINANCE'"),'Restore and rollback must use explicit confirmation phrases.');
assert(controller.includes('await db.beginTransaction()')&&controller.includes('await db.commit()')&&controller.includes('await db.rollback()'),'Execution and rollback must be transactional.');
assert(controller.includes('personal_finance_restore_checkpoints')&&controller.includes('checkpoint_sha256'),'Restore must create persistent pre-change checkpoints.');
assert(controller.includes("delete:0")&&controller.includes('delete_missing_records:false'),'Dry-run and execution must never delete current records absent from the backup.');
assert(controller.includes("if(mode==='ADD'&&has){kept++;continue;}"),'ADD must preserve existing records.');
assert(controller.includes("if(mode==='REPLACE')sql+=` ON DUPLICATE KEY UPDATE"),'REPLACE must update matching IDs rather than truncate a dataset.');
assert(controller.includes("ORDER BY id DESC FOR UPDATE"),'Rollback must process checkpoints in reverse dependency order.');
assert(controller.includes("status='ROLLED_BACK'")&&migration.includes("'ROLLED_BACK'"),'Rollback completion must be persisted.');
assert(migration.includes('rollback_expires_at')&&migration.includes('rolled_back_at'),'Restore governance must retain rollback expiry and completion timestamps.');
assert(migration.includes('approval_token_sha256')&&migration.includes('action_plan_sha256'),'Dry-run approval must bind token and exact action plan server-side.');
assert(!controller.includes('TRUNCATE TABLE')&&!controller.includes('DROP TABLE'),'Restore executor must not truncate or drop finance tables.');
assert(!controller.includes("ownership_scope='BUSINESS'")&&!controller.includes("ownership_scope='MIXED'"),'Restore executor must never target BUSINESS or MIXED finance scope.');
for(const text of ['Load canonical backup','Run server dry-run','Execute approved restore','High-risk recovery control','30-day pre-change checkpoint','ADD inserts missing records only','REPLACE updates matching backup IDs'])assert(ui.includes(text),`Restore UI must explain ${text}.`);
assert(ui.includes("fetch(url")&&ui.includes("credentials:'same-origin'"),'Restore UI must use authenticated same-origin APIs.');
assert(ui.includes("window.prompt('Type exactly: ROLL BACK PERSONAL FINANCE')"),'Rollback UI must demand an explicit phrase.');
assert(canonicalUi.includes('/personal-finance-transaction-safe-restore-executor.js?v=20260916-restore-executor'),'Canonical backup engine must load the restore executor UI.');
assert(routes.includes("router.post('/accounting-periods/:id/status', requireAnyPermission('EDIT_FINANCE'), requireStepUp('CHANGE_ACCOUNTING_PERIOD'), operations.updateAccountingPeriod);"),'Restore work must preserve unrelated accounting period behavior.');
require('./personal-finance-streaming-restore-transport-test');
console.log('Personal Finance Transaction-Safe Restore Executor regression checks passed.');
