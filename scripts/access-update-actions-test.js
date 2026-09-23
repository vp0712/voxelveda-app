'use strict';
const fs=require('node:fs');
function read(p){return fs.readFileSync(p,'utf8')}
function assert(v,m){if(!v){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}

const admin=read('public/admin-dashboard.js');
const finance=read('public/finance-master.js');
const os=read('controllers/bankingOperatingSystemController.js');
const scheduler=read('services/bankSyncScheduler.js');
const adminHtml=read('public/admin-dashboard.html');
const app=read('app.js');

assert(admin.includes('id="dialogAccessStatus"'),'admin access dialog has inline status');
assert(admin.includes('A reason is required before access can be updated.'),'admin access gives visible required-reason error');
assert(admin.includes("primaryBtn.textContent = 'Updating…'"),'admin Update Access has loading state');
assert(admin.includes('await fetch(`/api/users/${userId}/access`'),'admin Update Access sends save request');
assert(admin.includes('catch (error)'),'admin Update Access handles network/runtime failures');
assert(adminHtml.includes('/step-up.js?v=20260919-access-fix'),'admin step-up client remains cache-busted');
assert(adminHtml.includes('/admin-dashboard.js?v=20260919-access-fix'),'admin access client remains cache-busted');

assert(finance.includes('function openTeamAccessForm('),'Finance OS has banking team-access editor');
assert(finance.includes('data-team-account'),'Finance access editor has stable account controls');
assert(finance.includes('access_level:select.value'),'Finance access editor sends changed access levels');
assert(finance.includes('value="NONE"'),'Finance access supports explicit revoke');
assert(finance.includes('Save changed access'),'Finance access has explicit save action');
assert(finance.includes('Access update stopped'),'Finance access visibly reports partial failure');
assert(os.includes("if(level==='NONE')"),'backend supports access revoke');
assert(os.includes('DELETE FROM banking_user_account_access'),'backend removes revoked grant');
assert(app.includes("app.get('/banking',noIndex,pageAuth(),redirectPreservingQuery('/finance-intelligence'))"),'legacy Banking route resolves to Finance OS');

assert(!scheduler.includes('SELECT DISTINCT bc.app_user_id, bc.provider_user_id'),'scheduler no longer uses invalid DISTINCT/ORDER BY pattern');
assert(scheduler.includes('MIN(bc.next_sync_at) AS next_sync_at'),'scheduler selects grouped next sync time');
assert(scheduler.includes('GROUP BY bc.app_user_id, bc.provider_user_id'),'scheduler groups users/connections safely');
assert(scheduler.includes('ORDER BY MIN(bc.next_sync_at) ASC'),'scheduler uses valid grouped ordering');

if(process.exitCode)process.exit(process.exitCode);
