const fs=require('fs');
const assert=require('assert');
const controller=fs.readFileSync('controllers/personalFinanceRecoveryCertificationController.js','utf8');
const routes=fs.readFileSync('routes/financeRoutes.js','utf8');
const migration=fs.readFileSync('migrations/20260916_personal_finance_recovery_certification.sql','utf8');
const ui=fs.readFileSync('public/personal-finance-recovery-certification.js','utf8');
const canonicalUi=fs.readFileSync('public/personal-finance-canonical-backup-engine.js','utf8');

assert(migration.includes('personal_finance_recovery_certificates')&&migration.includes('previous_certificate_sha256')&&migration.includes('certificate_sha256')&&migration.includes('evidence_json'),'Recovery certificate ledger must preserve immutable evidence and SHA-256 chain fields.');
assert(migration.includes('FOREIGN KEY (restore_run_id) REFERENCES personal_finance_restore_runs(id)'),'Certificates must remain tied to a governed restore run.');
for(const route of [
  "router.get('/personal-money/canonical-restore/:id/certificates', requireAnyPermission('VIEW_BANKING')",
  "router.post('/personal-money/canonical-restore/:id/certificates', requireAnyPermission('VIEW_BANKING'), requireStepUp('CERTIFY_PERSONAL_FINANCE_RECOVERY')",
  "router.get('/personal-money/canonical-restore/:id/certificates/:certificateId', requireAnyPermission('VIEW_BANKING'), requireStepUp('EXPORT_PERSONAL_FINANCE_RECOVERY_EVIDENCE')"
])assert(routes.includes(route),`Missing protected recovery certification route: ${route}`);
assert(controller.includes("WHERE id=? AND user_id=? LIMIT 1")&&controller.includes("WHERE restore_run_id=? AND user_id=?"),'Recovery evidence must remain owner-scoped.');
assert(controller.includes("run.status!=='SUCCEEDED'")&&controller.includes("['VERIFIED','NEEDS_REVIEW','CRITICAL_MISMATCH']"),'Only successful restores with a certifiable verification state may be certified.');
assert(controller.includes('previous_certificate_sha256')&&controller.includes("certificate_chain_algorithm:'SHA-256'")&&controller.includes('RECOVERY_CERTIFICATE_HASH_MISMATCH'),'Certificate creation and retrieval must verify a SHA-256 evidence chain.');
assert(controller.includes('hashedRecordRef')&&controller.includes("record_identifiers_in_mismatch_examples:'One-way SHA-256 references only'"),'Mismatch examples must not expose raw restored record identifiers.');
for(const secret of ['approval_token','backup_password','access_token','refresh_token','consent_token','api_key','password'])assert(!controller.includes(`:${secret}`),`Certificate evidence must not deliberately expose ${secret}.`);
assert(controller.includes("company_finance_included:false")&&controller.includes("currencies_combined:false")&&controller.includes("automatic_reconciliation:false")&&controller.includes("automatic_money_movement:false"),'Recovery evidence must preserve PERSONAL-only, currency-separated, read-only boundaries.');
assert(!controller.includes('UPDATE personal_money_')&&!controller.includes('DELETE FROM personal_money_')&&!controller.includes('INSERT INTO personal_money_'),'Certification must never mutate Personal Money source tables.');
for(const label of ['RECOVERY CERTIFICATION & EVIDENCE PACK','Generate recovery certificate','Certificate chain','Download evidence JSON','Print / Save as PDF','raw transaction rows'])assert(ui.includes(label),`Recovery certification UI must explain ${label}.`);
assert(ui.includes("req('/status'")&&ui.includes('/verification')&&ui.includes('Check & select'),'Certification must independently rediscover successful restores after page reload.');
assert(canonicalUi.includes('/personal-finance-recovery-certification.js?v=20260916-recovery-certification'),'Canonical recovery UI must load the certification center.');
assert(!ui.includes('backup_password')&&!ui.includes('approval_token'),'Recovery certificate UI must not handle backup passwords or restore approval tokens.');
require('./personal-finance-recovery-integrity-watch-test');
console.log('Personal Finance Recovery Certification & Evidence Pack safeguards passed.');
