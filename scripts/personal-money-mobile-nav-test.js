'use strict';
const fs=require('fs');
const assert=require('assert');
const ui=fs.readFileSync('public/finance-master.js','utf8');
const html=fs.readFileSync('public/finance-intelligence.html','utf8');
const routes=fs.readFileSync('routes/financeRoutes.js','utf8');
const briefingController=fs.readFileSync('controllers/personalMoneyDailyBriefingController.js','utf8');
const savedController=fs.readFileSync('controllers/personalFinanceSavedViewsController.js','utf8');
const savedMigration=fs.readFileSync('migrations/20260916_personal_saved_views.sql','utf8');

assert(html.includes('/finance-master.js'),'Mobile Personal Money must live inside the canonical Finance OS.');
assert(ui.includes("const MOBILE_NAV=[['overview','⌂','Home'],['accounts','▣','Accounts'],['transactions','↕','Transactions'],['statements','▤','Statements'],['more','☰','More']]"),'Unified mobile bottom navigation contract changed.');
assert(ui.includes('function moreView()')&&ui.includes('All finance modules'),'More must expose the complete Finance module launcher on mobile.');
for(const moduleName of ['My Money','Budgets','Savings Goals','Net Worth','Forecast','Cash Flow Calendar','Borrow & Lend','Recurring'])assert(ui.includes(moduleName),'Mobile module launcher must retain '+moduleName);
assert(ui.includes('Personal finance is private to you'),'Personal Money privacy boundary must be visible.');
assert(ui.includes('function dailyBriefingCard()')&&ui.includes('Daily Finance Briefing'),'Daily briefing must be integrated into My Money.');
assert(ui.includes("['briefing',API+'/personal-money/daily-briefing?today='"),'Daily briefing must hydrate from the protected owner endpoint.');
assert(routes.includes("router.get('/personal-money/daily-briefing', requireAnyPermission('VIEW_BANKING')"),'Daily briefing route must remain VIEW_BANKING protected and GET-only.');
assert(briefingController.includes("ba.created_by=? AND ba.ownership_scope='PERSONAL' AND bt.ownership_scope='PERSONAL'"),'Daily briefing must restrict bank activity to the signed-in user personal data.');
assert(briefingController.includes('bt.is_internal_transfer=0'),'Daily briefing must exclude confirmed internal transfers.');

assert(ui.includes('function savedViewsCard()')&&ui.includes('Owner-private search definitions'),'Saved Views must be integrated without duplicating transaction snapshots.');
assert(savedMigration.includes('personal_finance_saved_views'),'Saved Views owner-private metadata table missing.');
for(const prohibitedColumn of ['transaction_id','bank_account_id','balance','amount','result_json'])assert(!savedMigration.includes(prohibitedColumn),'Saved Views must not persist result data: '+prohibitedColumn);
assert(savedController.includes('WHERE user_id=?'),'Saved Views reads must be owner scoped.');
assert(savedController.includes('WHERE id=? AND user_id=?'),'Saved Views updates/deletes must enforce owner scope.');
for(const route of ["router.get('/personal-money/saved-views'","router.post('/personal-money/saved-views'","router.delete('/personal-money/saved-views/:id'"])assert(routes.includes(route),'Saved Views route missing: '+route);

assert(ui.includes("['networth','◇','Net Worth']")&&ui.includes('function netWorthView()'),'Net Worth must be a first-class Finance OS module.');
assert(ui.includes('function roadmapDetail(id)')&&ui.includes('Monthly checkpoints'),'Actionable roadmap progress must remain integrated.');
assert(ui.includes('function budgetsView()')&&ui.includes('Banking Budgets'),'Personal and ledger-backed budget controls must remain integrated.');
assert(ui.includes('function insightsView()')&&ui.includes('Recurring commitments'),'Spending intelligence and recurring commitments must remain integrated.');
assert(ui.includes('function globalFinanceSearch(input)')&&ui.includes('function runFinanceCommand(input)'),'Search and command entry must be integrated into the master Finance OS.');
for(const old of ['personal-finance-command-center.js','personal-finance-saved-views.js','personal-money-mobile-nav.js'])assert(!html.includes(old),'Canonical Finance page must not load retired personal frontend '+old);

console.log('Unified Finance mobile Personal Money regression checks passed.');
