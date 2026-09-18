const fs=require('node:fs');
function read(p){return fs.readFileSync(p,'utf8')}
function assert(v,m){if(!v){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}

const admin=read('public/admin-dashboard.js');
const banking=read('public/premium-banking-app.js');
const os=read('controllers/bankingOperatingSystemController.js');
const scheduler=read('services/bankSyncScheduler.js');
const adminHtml=read('public/admin-dashboard.html');
const renderer=read('services/globalBrandRenderer.js');

assert(admin.includes("id=\"dialogAccessStatus\""),'admin access dialog has inline status');
assert(admin.includes("A reason is required before access can be updated."),'admin access gives visible required-reason error');
assert(admin.includes("primaryBtn.textContent = 'Updating…'"),'admin Update Access has loading state');
assert(admin.includes("await fetch(\`/api/users/\${userId}/access\`"),'admin Update Access sends save request');
assert(admin.includes("catch (error)"),'admin Update Access handles network/runtime failures');
assert(adminHtml.includes('/step-up.js?v=20260919-access-fix'),'admin step-up client is cache-busted');
assert(adminHtml.includes('/admin-dashboard.js?v=20260919-access-fix'),'admin access client is cache-busted');

assert(banking.includes('id="vvPbAccessStatus"'),'banking access dialog has inline status');
assert(banking.includes('id="vvPbAccessSave"'),'banking Update access button has stable id');
assert(banking.includes("save.textContent='Updating…'"),'banking access update has loading state');
assert(banking.includes("if(!userId||!accountId)"),'banking access validates user/account before save');
assert(banking.includes('<option value="NONE">No access</option>'),'banking access supports explicit revoke');
assert(os.includes("if(level==='NONE')"),'backend supports access revoke');
assert(os.includes("DELETE FROM banking_user_account_access"),'backend removes revoked grant');
assert(renderer.includes('premium-banking-app.js?v=20260919-access-fix'),'premium Banking access client is cache-busted');

assert(!scheduler.includes('SELECT DISTINCT bc.app_user_id, bc.provider_user_id'),'scheduler no longer uses invalid DISTINCT/ORDER BY pattern');
assert(scheduler.includes('MIN(bc.next_sync_at) AS next_sync_at'),'scheduler selects grouped next sync time');
assert(scheduler.includes('GROUP BY bc.app_user_id, bc.provider_user_id'),'scheduler groups users/connections safely');
assert(scheduler.includes('ORDER BY MIN(bc.next_sync_at) ASC'),'scheduler uses valid grouped ordering');

if(process.exitCode) process.exit(process.exitCode);
