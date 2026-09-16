const fs=require('fs');
const assert=require('assert');
const controller=fs.readFileSync('controllers/personalFinanceRecoveryGovernanceReportingController.js','utf8');
const cert=fs.readFileSync('controllers/personalFinanceRecoveryCertificationController.js','utf8');
const ui=fs.readFileSync('public/personal-finance-recovery-governance-reporting.js','utf8');
const loader=fs.readFileSync('public/personal-finance-recovery-incident-sla-governance.js','utf8');

assert(controller.includes('WHERE user_id=? AND opened_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? MONTH)'),'Governance reporting must be owner scoped and time bounded.');
for(const metric of ['response_sla_compliance_pct','resolution_sla_compliance_pct','avg_response_hours','avg_resolution_hours','closure_with_certificate_pct','closure_ready_approval_pct'])assert(controller.includes(metric),`Reporting must calculate ${metric}.`);
assert(controller.includes('condition_category:category')&&controller.includes('no_inferred_root_cause:true'),'Condition trends must be evidence-based and must not claim inferred root cause.');
assert(controller.includes("scope:'PERSONAL_ONLY'")&&controller.includes('finance_mutations:false'),'Reporting response must declare Personal-only read-only scope.');
assert(!controller.includes('UPDATE personal_money_')&&!controller.includes('DELETE FROM personal_money_')&&!controller.includes('INSERT INTO personal_money_')&&!controller.includes('UPDATE bank_transactions')&&!controller.includes('DELETE FROM bank_transactions'),'Governance reporting must never mutate source finance records.');
assert(cert.includes("req.query.governance_report")&&cert.includes('recoveryGovernanceReporting.get(req,res)'),'Reporting must reuse the protected recovery certification GET surface.');
for(const label of ['GOVERNANCE REPORTING, TREND ANALYTICS & MANAGEMENT REVIEW CENTER','Response SLA','Resolution SLA','Avg response','Avg resolution','Evidence condition recurrence','Monthly trend','Download management review JSON','Download monthly trend CSV','Reporting boundary','does not change financial records','does not infer a root cause'])assert(ui.toLowerCase().includes(label.toLowerCase()),`Reporting UI must explain ${label}.`);
assert(ui.includes("credentials:'same-origin'")&&!ui.includes("method:'POST'")&&!ui.includes("method:'PUT'")&&!ui.includes("method:'PATCH'")&&!ui.includes("method:'DELETE'"),'Governance reporting UI must remain read-only.');
assert(loader.includes('/personal-finance-recovery-governance-reporting.js?v=20260917-recovery-governance-reporting'),'SLA governance center must load reporting center.');
console.log('Personal Finance Recovery Governance Reporting safeguards passed.');
require('./personal-finance-recovery-management-review-attestation-test');
