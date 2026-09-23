'use strict';
const fs=require('fs');
const assert=require('assert');
const controller=fs.readFileSync('controllers/personalSpendingChallengeController.js','utf8');
const routes=fs.readFileSync('routes/financeRoutes.js','utf8');
const migration=fs.readFileSync('migrations/20260916_personal_spending_challenges.sql','utf8');
const ui=fs.readFileSync('public/finance-master.js','utf8');
const html=fs.readFileSync('public/finance-intelligence.html','utf8');

assert(migration.includes('personal_spending_challenges'),'Challenge migration must preserve owner-private challenge metadata.');
for(const col of ['user_id','challenge_type','category','currency','target_amount','baseline_amount','target_percent','start_date','end_date','status'])assert(migration.includes(col),'Challenge migration missing '+col);
for(const prohibited of ['transaction_id','bank_transaction_id','bank_account_id','result_json','balance_snapshot'])assert(!migration.includes(prohibited),'Challenge table must not copy finance result data: '+prohibited);
assert(controller.includes("WHERE user_id=? AND status<>'ARCHIVED'"),'Challenge list must be owner scoped.');
assert(controller.includes("ba.created_by=? AND ba.ownership_scope='PERSONAL' AND bt.ownership_scope='PERSONAL'"),'Challenge progress must use owner PERSONAL bank activity only.');
assert(controller.includes('bt.is_internal_transfer=0'),'Challenge progress must exclude internal transfers.');
assert(controller.includes("e.user_id=? AND e.entry_type IN ('EXPENSE','CASH_OUT')"),'Manual cash progress must be owner scoped and expense-only.');
assert(controller.includes('Progress data is limited to 400 days per request.'),'Challenge progress must remain date bounded.');
for(const prohibited of ['finance_transactions','journal_entries','createJournal','POST_TRANSACTION','RECONCILE_BANK_TRANSACTION'])assert(!controller.includes(prohibited),'Challenge backend must not touch accounting money paths: '+prohibited);

assert(routes.includes("router.get('/personal-money/spending-challenges', requireAnyPermission('VIEW_BANKING')"),'Challenge list must require VIEW_BANKING.');
assert(routes.includes("router.get('/personal-money/spending-challenges/progress', requireAnyPermission('VIEW_BANKING')"),'Challenge progress must be protected GET.');
assert(routes.includes("router.post('/personal-money/spending-challenges', requireAnyPermission('EDIT_FINANCE')"),'Saving challenge metadata must require EDIT_FINANCE.');
assert(routes.includes("router.post('/personal-money/spending-challenges/:id/status', requireAnyPermission('EDIT_FINANCE')"),'Challenge status metadata must require EDIT_FINANCE.');

assert(ui.includes('function insightsView()'),'Unified Finance OS must retain spending intelligence.');
assert(ui.includes('function forecastView()'),'Unified Finance OS must retain cash-flow planning.');
assert(ui.includes('function calendarView()'),'Unified Finance OS must retain cash-flow calendar planning.');
assert(ui.includes('function budgetsView()'),'Unified Finance OS must retain budget controls.');
assert(ui.includes('Recurring commitments'),'Unified Finance OS must surface recurring commitments for cost review.');
assert(ui.includes('currencies')||ui.includes('Currencies'),'Unified Finance OS must explain currency separation.');
assert(!html.includes('personal-financial-action-center')&&!html.includes('personal-finance-automation-approval-center'),'Canonical Finance page must not load retired chained Personal Finance frontends.');

console.log('Personal spending-planning backend and unified Finance integration checks passed.');
