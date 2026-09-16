const fs=require('fs');
const assert=require('assert');
const controller=fs.readFileSync('controllers/personalFinanceRecoveryIntegrityWatchController.js','utf8');
const ui=fs.readFileSync('public/personal-finance-recovery-remediation-planner.js','utf8');
const watchUi=fs.readFileSync('public/personal-finance-recovery-integrity-watch.js','utf8');

for(const label of ['INVESTIGATE_CURRENT_STATE','PRESERVE_FRESH_BACKUP','CONSIDER_CONTROLLED_ROLLBACK','PREPARE_NEW_RESTORE','PRESERVE_CERTIFICATE_EVIDENCE','INITIALIZE_VERIFICATION','REVIEW_NON_CRITICAL_FINDINGS','CERTIFY_CURRENT_STATE','COMPARE_WITH_LATEST_CERTIFICATE','DECIDE_BEFORE_ROLLBACK_EXPIRY'])assert(controller.includes(label),`Remediation planner must model ${label}.`);
assert(controller.includes('It does not prove which later user action, import, integration, or process caused the difference.'),'Planner must state the evidence boundary instead of inventing a root cause.');
assert(controller.includes('planner_read_only:true')&&controller.includes('automatic_repair:false')&&controller.includes('automatic_rollback:false')&&controller.includes('automatic_restore:false')&&controller.includes('explicit_approval_required_for_future_mutation:true'),'Planner must remain fail-closed and require explicit approval for future mutations.');
assert(controller.includes('affected_datasets')&&controller.includes('critical_mismatches')&&controller.includes('needs_review'),'Planner must use current verification evidence and expose affected scope.');
assert(controller.includes('Currencies remain separate'),'Planner must preserve currency separation.');
assert(!controller.includes('UPDATE personal_money_')&&!controller.includes('DELETE FROM personal_money_')&&!controller.includes('INSERT INTO personal_money_'),'Planner backend must not mutate Personal Money source tables.');
for(const label of ['RECOVERY INCIDENT & REMEDIATION PLANNER','Affected datasets','Evidence boundary','Open verification','Open certificates','Open restore controls','does not repair records','does not reconcile banking','does not roll back a restore','does not start a new restore'])assert(ui.toLowerCase().includes(label.toLowerCase()),`Remediation UI must explain ${label}.`);
assert(!ui.includes("method:'POST'")&&!ui.includes("method:'PUT'")&&!ui.includes("method:'PATCH'")&&!ui.includes("method:'DELETE'"),'Remediation planner UI must remain GET/read-only.');
assert(watchUi.includes('/personal-finance-recovery-remediation-planner.js?v=20260916-recovery-remediation-planner'),'Recovery integrity watch must load the remediation planner.');
require('./personal-finance-recovery-incident-case-management-test');
console.log('Personal Finance Recovery Incident & Remediation Planner safeguards passed.');
