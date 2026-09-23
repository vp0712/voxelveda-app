'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const assert=(ok,message)=>{if(!ok)throw new Error(message)};

const client=read('public/finance-master.js');
const guard=read('public/finance-bootstrap-guard.js');
const authRoutes=read('routes/authRoutes.js');
const stepUpController=read('controllers/stepUpController.js');

assert(client.includes('FINANCE_REQUEST_TIMEOUT_MS'),'Finance API timeout boundary is missing');
assert(client.includes('AbortController'),'Finance API requests must be abortable');
assert(client.includes('FINANCE_REQUEST_TIMEOUT'),'timed-out Finance requests need a typed error');
assert(client.includes('function renderFinanceFatal('),'terminal Finance startup error state is missing');
assert(client.includes('function notice(')&&client.includes("role="status"")===false,'canonical Finance client must retain visible notice handling');
assert(guard.includes('WATCHDOG_MS'),'independent Finance startup watchdog is missing');
assert(guard.includes('data-finance-hard-retry'),'stuck startup must expose a hard retry');

assert(authRoutes.includes("router.post('/step-up'"),'step-up API route is missing');
assert(stepUpController.includes('PASSWORD_TOTP'),'high-risk Finance step-up must require password and TOTP assurance');

assert(client.includes('function openAccountForm('),'Add Account workflow is not wired in the canonical Finance OS');
assert(client.includes("if(kind==='account'){openAccountForm();return}"),'New Account action must open the account form');
assert(client.includes('function openStatementWizard()'),'statement import action is missing');
assert(client.includes("$('statementWizard').onsubmit"),'statement import form submit handler is missing');
assert(client.includes('function openStatementReview('),'statement review workflow is missing');
assert(client.includes('data-review-commit'),'review commit action is missing');
assert(client.includes('data-review-reject'),'review reject action is missing');
assert(client.includes("document.querySelector('[data-review-commit]')"),'review commit handler is missing');
assert(client.includes("document.querySelector('[data-review-reject]')"),'review reject handler is missing');
assert(client.includes("if($('runAnalysis'))$('runAnalysis').onclick"),'Finance analysis action is not wired');
assert(client.includes("document.querySelectorAll('[data-viewjump]')"),'module navigation actions are not wired');
assert(client.includes("try{")&&client.includes("catch(error){notice(error.message,true)}"),'Finance actions must surface server errors without silent failure');

console.log('Unified Finance action reliability checks passed.');
