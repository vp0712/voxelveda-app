const fs=require('node:fs');
const privacy=require('../services/financePrivacyService');
function read(p){return fs.readFileSync(p,'utf8')}
function assert(v,m){if(!v){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}

const delegated={user:{id:42},bankingAccessScope:{is_admin:false,has_explicit_grants:true,can_view_all_business:true,allowed_business_account_ids:[10,12]}};
const personalOnly={user:{id:42},bankingAccessScope:{is_admin:false,has_explicit_grants:false,can_view_all_business:false,allowed_business_account_ids:[]}};
const fullBusiness={user:{id:42},bankingAccessScope:{is_admin:false,has_explicit_grants:false,can_view_all_business:true,allowed_business_account_ids:[]}};
const admin={user:{id:42},bankingAccessScope:{is_admin:true,has_explicit_grants:true,can_view_all_business:false,allowed_business_account_ids:[10]}};

const delegatedSql=privacy.visibilitySql('ba',delegated);
assert(delegatedSql.includes("ba.id IN (?,?)"),'delegated Banking SQL restricts business accounts to explicit grants');
assert(JSON.stringify(privacy.visibilityParams(delegated))===JSON.stringify([42,10,12]),'delegated Banking SQL params contain owner and granted account IDs');
assert(privacy.requestAccountVisible({id:10,ownership_scope:'BUSINESS',created_by:9},delegated),'granted business account is visible');
assert(!privacy.requestAccountVisible({id:11,ownership_scope:'BUSINESS',created_by:9},delegated),'ungranted business account is hidden');
assert(privacy.requestAccountVisible({id:20,ownership_scope:'PERSONAL',created_by:42},delegated),'own personal account stays visible');
assert(!privacy.requestAccountVisible({id:21,ownership_scope:'PERSONAL',created_by:99},delegated),'another users personal account stays hidden');

assert(!privacy.visibilitySql('ba',personalOnly).includes("ownership_scope = 'BUSINESS' OR"),'banking user without business permission does not receive all business accounts');
assert(privacy.visibilitySql('ba',fullBusiness).includes("ownership_scope = 'BUSINESS' OR"),'role-based business visibility remains supported when no explicit grants exist');
assert(privacy.visibilitySql('ba',admin).includes("ownership_scope = 'BUSINESS' OR"),'banking administrators retain full business visibility');

const router=read('routes/bankingPortalRoutes.js');
assert(router.indexOf('router.use(financePrivacy.resolveBankingAccessScope)')>router.indexOf('router.use(view);'),'standalone Banking resolves account scope immediately after view permission');
const middleware=read('middleware/financePrivacyMiddleware.js');
assert(middleware.includes('banking_user_account_access'),'banking scope resolver reads account grants');
assert(middleware.includes('allowed_business_account_ids'),'banking scope resolver publishes explicit account IDs');

for(const p of ['controllers/financeIntelligenceController.js','controllers/financeTransactionIntelligenceController.js','controllers/statementDataManagementController.js','controllers/bankAccountLifecycleController.js','controllers/financeReconciliationCenterController.js']){
 const c=read(p);
 assert(!c.includes("privacy.visibilitySql('ba')"),p+' has no unscoped business visibility query');
 assert(c.includes("privacy.visibilitySql('ba', req)"),p+' uses request-scoped Banking visibility');
}
if(process.exitCode)process.exit(process.exitCode);
