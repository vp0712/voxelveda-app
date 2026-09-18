const fs = require('node:fs');
function read(path){ return fs.readFileSync(path,'utf8'); }
function assert(condition,message){ if(!condition){ console.error('FAIL:',message); process.exitCode=1; } else console.log('PASS:',message); }

const controller=read('controllers/bankingOperatingSystemController.js');
const routes=read('routes/financeRoutes.js');
const ui=read('public/premium-banking-app.js');
const migration=read('migrations/20260918_banking_os_multi_user.sql');

assert(migration.includes('banking_user_account_access'),'account-level banking access schema exists');
assert(migration.includes('banking_payment_requests'),'payment workflow schema exists');
assert(migration.includes('banking_payment_approvals'),'maker-checker approval schema exists');
assert(migration.includes('banking_money_spaces'),'Money Spaces schema exists');
assert(migration.includes('banking_beneficiaries'),'beneficiary schema exists');
assert(migration.includes('banking_alert_preferences'),'user banking alert preferences exist');

assert(controller.includes('SELF_APPROVAL_BLOCKED'),'self-approval is explicitly blocked');
assert(controller.includes("status='PENDING_APPROVAL'"),'payment workflow uses pending approval state');
assert(controller.includes("READY_FOR_EXECUTION"),'approved payments stop at capability-gated execution state');
assert(controller.includes('external_transfer:false'),'external payment rail is fail-closed');
assert(controller.includes('card_issuing:false'),'card issuing is fail-closed');
assert(controller.includes('grants.length'),'explicit account grants become a banking visibility boundary');
assert(controller.includes("ownership_scope='PERSONAL'"),'personal and business banking remain separated');

assert(routes.includes("'/banking-os/payments/:uid/decision'"),'payment approval route exists');
assert(routes.includes("requireAnyPermission('APPROVE_PAYMENT')"),'payment decision requires approval permission');
assert(routes.includes("requireStepUp('APPROVE_BANK_PAYMENT')"),'payment approval requires step-up authentication');
assert(routes.includes("'/banking-os/team/:userId/access'"),'team account access route exists');
assert(routes.includes("requireStepUp('CHANGE_BANKING_USER_ACCESS')"),'team access change requires step-up authentication');

for(const tab of ['data-pb-tab="pay"','data-pb-tab="team"','Money Spaces','Pay & Transfer','Banking alerts']){
  assert(ui.includes(tab),`premium Banking UI contains ${tab}`);
}
assert(ui.includes('External payment rail'),'UI exposes real provider capability state');
assert(ui.includes('Workflow only'),'UI does not pretend payment execution is enabled');
assert(ui.includes('prepared by'),'payment queue identifies preparer for maker-checker review');

if(process.exitCode) process.exit(process.exitCode);
