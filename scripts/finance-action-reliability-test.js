'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const expect=(source,needle,message)=>{if(!source.includes(needle))throw new Error(message||('Expected '+needle))};

const client=read('public/finance-master.js');
const authRoutes=read('routes/authRoutes.js');
const stepUpController=read('controllers/stepUpController.js');
const stepUpMiddleware=read('middleware/stepUpMiddleware.js');

expect(client,'FINANCE_REQUEST_TIMEOUT_MS=12000','Finance requests need a bounded timeout.');
expect(client,'AbortController','Finance requests must be abortable.');
expect(client,'The rest of the workspace remains available','timeout errors must preserve the rest of Finance.');
expect(client,'function requestFinanceStepUp(','canonical Finance step-up dialog is missing.');
expect(client,"body.code==='STEP_UP_REQUIRED'",'sensitive actions must recognize step-up responses.');
expect(client,"'/api/auth/step-up'",'Finance step-up must use the authenticated app endpoint.');
expect(client,'Never enter a bank password, bank PIN or bank OTP','step-up UI must distinguish app credentials from bank credentials.');
expect(client,'pattern="[0-9]{6}"','step-up must require a 6-digit authenticator code.');
expect(client,'_stepUpRetry:true','sensitive requests must retry only after successful step-up.');
expect(client,'form.reportValidity()','step-up form must use browser validation.');
expect(client,'function notice(','canonical inline Finance feedback is missing.');
expect(client,'renderFinanceFatal','Finance startup fatal boundary is missing.');
expect(client,'signalFinanceReady','Finance startup ready signal is missing.');
expect(client,'openStatementWizard','statement action must remain wired in the master Finance OS.');
expect(client,'openAccountForm','account action must remain wired in the master Finance OS.');
expect(authRoutes,"router.post('/step-up'",'step-up API route is missing.');
expect(stepUpController,'PASSWORD_TOTP','step-up verification must require password and TOTP assurance.');
expect(stepUpMiddleware,"code: 'STEP_UP_REQUIRED'",'protected Finance actions must expose the step-up contract.');

console.log('Finance action reliability regression checks passed.');
