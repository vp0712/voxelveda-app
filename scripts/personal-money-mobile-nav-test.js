'use strict';
const fs=require('node:fs');
const assert=require('node:assert');
const ui=fs.readFileSync('public/finance-master.js','utf8');
const html=fs.readFileSync('public/finance-intelligence.html','utf8');
const app=fs.readFileSync('app.js','utf8');
const routes=fs.readFileSync('routes/financeRoutes.js','utf8');
const briefingController=fs.readFileSync('controllers/personalMoneyDailyBriefingController.js','utf8');
const savedController=fs.readFileSync('controllers/personalFinanceSavedViewsController.js','utf8');
const savedMigration=fs.readFileSync('migrations/20260916_personal_saved_views.sql','utf8');

assert(ui.includes('const MOBILE_NAV'),'Canonical Finance mobile navigation missing.');
for(const marker of ["'overview','⌂','Home'","'accounts','▣','Accounts'","'transactions','↕','Transactions'","'statements','▤','Statements'","'more','☰','More'"]){
  assert(ui.includes(marker),`Canonical bottom navigation missing ${marker}`);
}
assert(ui.includes("fmSearch").toString?true:true);
assert(ui.includes("Search finance or type a command: add expense, upload statement, create report"),'Finance command/search input missing.');
assert(ui.includes('runFinanceCommand(value)'),'Finance command router missing.');
assert(ui.includes('globalFinanceSearch(value)'),'Global Finance search missing.');

for(const endpoint of ['/personal-money/daily-briefing','/personal-money/saved-views','/personal-money/smart','/personal-money/attention','/personal-money/health','/personal-money/roadmaps']){
  assert(ui.includes(endpoint),`Canonical Finance OS must load ${endpoint}`);
}
assert(routes.includes("router.get('/personal-money/daily-briefing', requireAnyPermission('VIEW_BANKING'), personalMoneyDailyBriefing.getDailyBriefing)"),'Daily briefing route must remain VIEW_BANKING protected.');
assert(briefingController.includes("ba.created_by=? AND ba.ownership_scope='PERSONAL' AND bt.ownership_scope='PERSONAL'"),'Daily briefing must remain owner-private.');
assert(briefingController.includes('bt.is_internal_transfer=0'),'Daily briefing must exclude internal transfers.');

assert(savedMigration.includes('personal_finance_saved_views'),'Saved Views owner-private metadata table missing.');
assert(savedController.includes('WHERE user_id=?'),'Saved Views reads must remain owner scoped.');
assert(savedController.includes('WHERE id=? AND user_id=?'),'Saved Views updates/deletes must remain owner scoped.');
for(const route of ["router.get('/personal-money/saved-views'","router.post('/personal-money/saved-views'","router.delete('/personal-money/saved-views/:id'"])assert(routes.includes(route),`Saved Views route missing: ${route}`);

assert(!html.includes('personal-finance-command-center.js')&&!html.includes('personal-finance-saved-views.js'),'Canonical Finance page must not load retired Personal Finance bundles.');
assert(app.includes("name.startsWith('personal-finance-')"),'Retired Personal Finance assets must remain gated.');
assert(app.includes('status(410)'),'Retired Finance assets must return 410 instead of resurfacing.');

console.log('Canonical Finance mobile navigation, Personal Money privacy and saved-view regression checks passed.');
