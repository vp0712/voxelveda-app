const fs=require('fs');
const assert=require('assert');
const ui=fs.readFileSync('public/personal-finance-security-privacy-control-center.js','utf8');
const step=fs.readFileSync('public/step-up.js','utf8');
const routes=fs.readFileSync('routes/authRoutes.js','utf8');

assert(step.includes('/personal-finance-security-privacy-control-center.js?v=20260916-security-privacy'),'Authenticated shell must load Personal Finance Security & Privacy Control Center.');
for(const endpoint of ['/api/auth/sessions','/api/auth/mfa/status','/api/auth/step-up/status'])assert(ui.includes(endpoint),`Security Center must use owner-authenticated source: ${endpoint}`);
assert(ui.includes("credentials:'same-origin'"),'Security Center must preserve authenticated same-origin credentials.');
for(const route of ["router.get('/sessions', auth, securityAuthController.getSessions)","router.delete('/sessions/:id', auth, securityAuthController.revokeOwnSession)","router.post('/sessions/revoke-others', auth, securityAuthController.revokeOtherSessions)","router.get('/mfa/status', auth, mfaController.status)","router.get('/step-up/status', auth, stepUpController.status)"])assert(routes.includes(route),`Account security route must remain authenticated: ${route}`);
for(const label of ['PERSONAL FINANCE SECURITY & PRIVACY CONTROL CENTER','Protect access before protecting the numbers','Active sessions','MFA protection','Step-up protection','Personal/company boundary','Export/privacy boundary','Emergency access controls','Sign out all other sessions'])assert(ui.includes(label),`Security Center must explain ${label}.`);
assert(ui.includes('maskIp')&&ui.includes('browser('),'Security Center must reduce raw session telemetry before display.');
for(const secret of ['manual_key','qr_code','recovery_codes','password.value','stepUpPassword'])assert(!ui.includes(secret),`Security Center must not expose secret material: ${secret}`);
assert(ui.includes("method:'DELETE'")&&ui.includes("method:'POST'"),'Security Center may use only explicit account-session revocation mutations.');
assert(ui.includes('window.confirm')||ui.includes('confirm('),'Session revocation must require explicit confirmation.');
for(const prohibited of ['/api/finance/transactions','/payments','/reconcile','/classify','createJournal','POST_TRANSACTION','RECONCILE_BANK_TRANSACTION'])assert(!ui.includes(prohibited),`Security Center must not contain finance mutation path: ${prohibited}`);
assert(ui.includes('does not show company-admin security data')&&ui.includes('never edits transactions'),'Security Center must state personal/company and finance-mutation boundaries.');
console.log('Personal Finance Security & Privacy Control Center regression checks passed.');
