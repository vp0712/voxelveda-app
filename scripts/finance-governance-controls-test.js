'use strict';
const fs=require('fs');
const assert=require('assert');

const master=fs.readFileSync('public/finance-master.js','utf8');
const html=fs.readFileSync('public/finance-intelligence.html','utf8');
const authRoutes=fs.readFileSync('routes/authRoutes.js','utf8');
const financeRoutes=fs.readFileSync('routes/financeRoutes.js','utf8');

for(const nav of [
  "['protection','◇','Protection Register']",
  "['evidenceaudit','⌘','Evidence & Audit']",
  "['securityprivacy','⌾','Security & Privacy']"
]) assert(master.includes(nav),`Canonical Finance navigation missing ${nav}`);

for(const view of ['function protectionControlView()','function evidenceAuditView()','function securityPrivacyView()'])
  assert(master.includes(view),`Finance governance view missing ${view}`);

for(const route of [
  "['personalIntegrity',API+'/personal-money/data-quality-integrity']",
  "['securitySessions','/api/auth/sessions']",
  "['mfaStatus','/api/auth/mfa/status']",
  "['stepUpStatus','/api/auth/step-up/status']"
]) assert(master.includes(route),`Governance source missing ${route}`);

assert(master.includes("if(v==='protection')return protectionControlView();"),'Protection navigation is not bound.');
assert(master.includes("if(v==='evidenceaudit')return evidenceAuditView();"),'Evidence/Audit navigation is not bound.');
assert(master.includes("if(v==='securityprivacy')return securityPrivacyView();"),'Security/Privacy navigation is not bound.');

const evidence=master.slice(master.indexOf('function evidenceAuditView()'),master.indexOf('function maskFinanceSessionIp'));
assert(evidence.includes('audit_trail'),'Evidence/Audit must use the owner-private audit trail.');
assert(evidence.includes('integrity.hash_prefix'),'Evidence/Audit may show only the short integrity hash prefix.');
assert(!evidence.includes('ip_address')&&!evidence.includes('user_agent'),'Evidence/Audit must not expose raw session telemetry.');
assert(!/method:['"](?:POST|PUT|PATCH|DELETE)/.test(evidence),'Evidence/Audit must remain financial-record read-only.');

const security=master.slice(master.indexOf('function securityPrivacyView()'),master.indexOf('function simpleView(v)'));
assert(security.includes('maskFinanceSessionIp')&&security.includes('financeSessionAgent'),'Security view must reduce raw session telemetry.');
assert(security.includes('recovery_codes_remaining'),'Security view may show only recovery-code count.');
assert(!/\.recovery_codes\b|['\"]recovery_codes['\"]/.test(security),'Security view must not display raw recovery code material.');
assert(master.includes("confirm('Sign out this other session?')"),'Single-session revoke must require explicit confirmation.');
assert(master.includes("confirm('Sign out every other active session and keep only this one?')"),'Bulk session revoke must require explicit confirmation.');
assert(master.includes("method:'DELETE'")&&master.includes("/api/auth/sessions/revoke-others"),'Security session controls must use authenticated session routes.');

assert(authRoutes.includes("router.get('/sessions', auth, securityAuthController.getSessions)"),'Session list must remain authenticated.');
assert(authRoutes.includes("router.delete('/sessions/:id', auth, securityAuthController.revokeOwnSession)"),'Session revoke must remain authenticated.');
assert(authRoutes.includes("router.get('/mfa/status', auth, mfaController.status)"),'MFA status must remain authenticated.');
assert(authRoutes.includes("router.get('/step-up/status', auth, stepUpController.status)"),'Step-up status must remain authenticated.');
assert(financeRoutes.includes("router.get('/personal-money/data-quality-integrity', requireAnyPermission('VIEW_BANKING'), personalFinancialDataQuality.getCenter)"),'Personal audit source must remain VIEW_BANKING protected.');

const protection=master.slice(master.indexOf('function protectionControlView()'),master.indexOf('function financeAuditValue'));
assert(protection.includes('INSURANCE')&&protection.includes('Protection boundary'),'Protection register must expose insurance/lifecycle controls and safety boundary.');
assert(protection.includes('annualByCurrency'),'Protection costs must remain separated by native currency.');
assert(protection.includes('never renews or pays anything automatically'),'Protection register must prohibit implied automation.');

assert(html.includes('/finance-master.js?v=20260924-profitability-v1'),'Finance master release must be cache-busted for governance controls.');
console.log('FINANCE_GOVERNANCE_CONTROLS_OK');
