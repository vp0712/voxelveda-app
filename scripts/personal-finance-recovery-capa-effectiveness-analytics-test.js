const fs=require('fs');
const assert=require('assert');
const controller=fs.readFileSync('controllers/personalFinanceRecoveryCapaAnalyticsController.js','utf8');
const cert=fs.readFileSync('controllers/personalFinanceRecoveryCertificationController.js','utf8');
const ui=fs.readFileSync('public/personal-finance-recovery-capa-effectiveness-analytics.js','utf8');
const loader=fs.readFileSync('public/personal-finance-recovery-capa-continuous-improvement.js','utf8');

assert(controller.includes('WHERE user_id=? AND created_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? MONTH)'),'CAPA analytics must be owner scoped and time bounded.');
assert(controller.includes('WHERE user_id=? AND opened_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? MONTH)'),'Incident recurrence analytics must be owner scoped and time bounded.');
for(const metric of ['effective_pct','closed_effective_without_observed_recurrence_pct','avg_implementation_hours','avg_effectiveness_hours','avg_closure_hours','post_closure_recurrence'])assert(controller.includes(metric),`CAPA analytics must calculate ${metric}.`);
assert(controller.includes("action_type==='PREVENTIVE'")&&controller.includes("action_type==='CORRECTIVE'")&&controller.includes("action_type==='BOTH'"),'CAPA analytics must separate corrective and preventive action trends.');
assert(controller.includes("scope:'PERSONAL_ONLY'")&&controller.includes('read_only:true')&&controller.includes('finance_mutations:false'),'CAPA analytics must declare Personal-only read-only scope.');
assert(controller.includes('no_inferred_root_cause:true')&&controller.includes('Observed CAPA and recovery incident evidence only'),'CAPA analytics must preserve the evidence boundary and not infer root cause.');
assert(!controller.includes('UPDATE personal_finance_recovery_capa')&&!controller.includes('DELETE FROM personal_finance_recovery_capa')&&!controller.includes('INSERT INTO personal_finance_recovery_capa')&&!controller.includes('UPDATE personal_money_')&&!controller.includes('UPDATE bank_transactions'),'CAPA analytics must not mutate CAPA or source finance records.');
assert(cert.includes("req.query.capa_analytics")&&cert.includes('recoveryCapaAnalytics.get(req,res)'),'CAPA analytics must reuse the protected recovery certification GET surface.');
for(const label of ['CAPA EFFECTIVENESS ANALYTICS & PREVENTIVE CONTROL MONITORING','Overdue','Ineffective','Avg implementation','Avg effectiveness','Preventive control monitoring','Monthly CAPA trend','Management review signal','Analytics boundary','does not infer causation or root cause','does not change financial records'])assert(ui.toLowerCase().includes(label.toLowerCase()),`CAPA analytics UI must explain ${label}.`);
assert(ui.includes("credentials:'same-origin'")&&!ui.includes("method:'POST'")&&!ui.includes("method:'PUT'")&&!ui.includes("method:'PATCH'")&&!ui.includes("method:'DELETE'"),'CAPA analytics UI must remain read-only.');
assert(loader.includes('/personal-finance-recovery-capa-effectiveness-analytics.js?v=20260917-recovery-capa-effectiveness-analytics'),'CAPA center must load CAPA effectiveness analytics.');
console.log('Personal Finance Recovery CAPA Effectiveness Analytics safeguards passed.');
