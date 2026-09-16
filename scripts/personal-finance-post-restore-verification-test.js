const fs=require('fs');
const assert=require('assert');
const controller=fs.readFileSync('controllers/personalFinancePostRestoreVerificationController.js','utf8');
const routes=fs.readFileSync('routes/financeRoutes.js','utf8');
const migration=fs.readFileSync('migrations/20260916_personal_finance_post_restore_verification.sql','utf8');
const ui=fs.readFileSync('public/personal-finance-post-restore-verification.js','utf8');
const restoreUi=fs.readFileSync('public/personal-finance-transaction-safe-restore-executor.js','utf8');
const canonicalUi=fs.readFileSync('public/personal-finance-canonical-backup-engine.js','utf8');

assert(migration.includes('personal_finance_restore_verification_targets')&&migration.includes('target_sha256')&&migration.includes('expected_records_json'),'Verification migration must persist compact expected hash targets.');
assert(migration.includes('FOREIGN KEY (restore_run_id) REFERENCES personal_finance_restore_runs(id) ON DELETE CASCADE'),'Verification targets must be tied to a governed restore run.');
for(const route of [
  "router.get('/personal-money/canonical-restore/:id/verification', requireAnyPermission('VIEW_BANKING')",
  "router.post('/personal-money/canonical-restore/:id/verification/initialize', requireAnyPermission('VIEW_BANKING')"
])assert(routes.includes(route),`Missing owner-protected verification route: ${route}`);
assert(controller.includes("WHERE id=? AND user_id=? LIMIT 1")&&controller.includes("WHERE restore_run_id=? AND user_id=?"),'Verification must remain owner-scoped.');
for(const mark of ['RESTORE_FIDELITY','TARGET_LEDGER_INTEGRITY','MISSING_DEPENDENCY','CRITICAL_MISMATCH','NEEDS_REVIEW','VERIFIED','INITIALIZATION_REQUIRED'])assert(controller.includes(mark),`Verification must support ${mark}.`);
assert(controller.includes('record_sha256')&&controller.includes('target_sha256')&&controller.includes('hash(publicRow(row))'),'Verification must compare current canonical records to approved SHA-256 targets.');
assert(controller.includes('VERIFICATION_CHECKPOINT_HASH_MISMATCH'),'Verification initialization must independently validate rollback-checkpoint integrity.');
assert(controller.includes("Currencies remain separate")&&!controller.includes('converted_total'),'Verification must preserve currency separation.');
assert(controller.includes('finance_mutations:false')&&controller.includes('read_only:true'),'Verification response must explicitly remain read-only.');
assert(!controller.includes('UPDATE personal_money_')&&!controller.includes('DELETE FROM personal_money_')&&!controller.includes('INSERT INTO personal_money_'),'Verification must not mutate Personal Money source tables.');
assert(!controller.includes("ownership_scope='BUSINESS'")&&!controller.includes("ownership_scope='MIXED'"),'Verification must not target company finance scope.');
for(const label of ['RESTORE VERIFICATION & POST-RECOVERY RECONCILIATION CENTER','VERIFIED','Critical mismatches','Needs review','read-only','does not reconcile banking'])assert(ui.toLowerCase().includes(label.toLowerCase()),`Verification UI must explain ${label}.`);
assert(ui.includes("voxelveda:personal-finance-restored")&&restoreUi.includes("voxelveda:personal-finance-restored"),'Successful restore must automatically hand off to post-recovery verification.');
assert(restoreUi.includes("upload_id:uploadId")&&restoreUi.includes("{run_id:p.run_id,backup}"),'Automatic verification must reuse verified large upload sessions or in-memory small backups without sending the backup password.');
assert(!restoreUi.includes('backup_password')&&!ui.includes('backup_password'),'Backup password must never be sent to verification APIs.');
assert(canonicalUi.includes('/personal-finance-post-restore-verification.js?v=20260916-post-restore-verification'),'Canonical backup engine must load the verification center.');
assert(routes.includes("router.post('/accounting-periods/:id/status', requireAnyPermission('EDIT_FINANCE'), requireStepUp('CHANGE_ACCOUNTING_PERIOD'), operations.updateAccountingPeriod);"),'Verification work must preserve unrelated accounting period behavior.');
require('./personal-finance-recovery-certification-test');
console.log('Personal Finance Restore Verification & Post-Recovery Reconciliation safeguards passed.');
