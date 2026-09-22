'use strict';

const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const { normalizePreferences }=require('../services/financeUserPreferencesService');

const root=path.join(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const expect=(src,token,message)=>assert(src.includes(token),message+' (missing: '+token+')');

const normalized=normalizePreferences({
 default_workspace:'business',default_account_id:'12',reporting_currency:'aud',default_period:'quarter',
 dashboard_cards:['cashflow','accounts','accounts','recent','unknown'],date_format:'YYYY-MM-DD',number_format:'en-AU'
});
assert.equal(normalized.default_workspace,'BUSINESS');
assert.equal(normalized.default_account_id,12);
assert.equal(normalized.reporting_currency,'AUD');
assert.deepEqual(normalized.dashboard_cards,['cashflow','accounts','recent']);
assert.throws(()=>normalizePreferences({default_workspace:'EVERYTHING'}),/workspace/);
assert.throws(()=>normalizePreferences({default_period:'all_time'}),/period/);
assert.throws(()=>normalizePreferences({reporting_currency:'AU'}),/three-letter/);

const migration=read('migrations/20260923_finance_user_preferences.sql');
expect(migration,'CREATE TABLE IF NOT EXISTS finance_user_preferences','Finance preference table missing');
expect(migration,'dashboard_cards_json JSON','Dashboard preference storage missing');

const controller=read('controllers/financeUserPreferencesController.js');
expect(controller,'privacy.assertAccountAccess','Default account preference must be permission checked');
expect(controller,'WHERE user_id=?','Preferences must be isolated by user');
expect(controller,'FINANCE_PREFERENCES_UPDATED','Preference audit event missing');

const routes=read('routes/financeRoutes.js');
expect(routes,"router.get('/preferences'","Preference read route missing");
expect(routes,"router.put('/preferences'","Preference save route missing");
expect(routes,"router.get('/categories'","Merged category manager route must remain");
expect(routes,"router.get('/accounting-periods'","Accounting period controls must remain");
expect(routes,"router.get('/banking-os/cashflow-calendar'","Banking calendar source must remain");

const ui=read('public/finance-master.js');
[
 "['forecast','◒','Forecast']",
 "['calendar','▦','Cash Flow Calendar']",
 "['categories','◈','Categories']",
 "loadResource('userPreferences',API+'/preferences')",
 "loadResource('smart',API+'/personal-money/smart')",
 "loadResource('health',API+'/personal-money/health')",
 "loadResource('roadmaps',API+'/personal-money/roadmaps')",
 "function forecastView()",
 "function calendarView()",
 "function categoriesView()",
 "function userPreferencesCard()",
 "function dashboardCardVisible(key)",
 "Original bank categories remain immutable source evidence",
 "no conversion or relabelling occurs without verified FX evidence",
 "accountingPeriodsCard()"
].forEach(token=>expect(ui,token,'Finance preferences/forecast UI contract missing'));

const functions=[...ui.matchAll(/(?:^|\n)(?:async )?function\s+([A-Za-z0-9_]+)\s*\(/g)].map(m=>m[1]);
const duplicates=[...new Set(functions.filter((name,index)=>functions.indexOf(name)!==index))];
assert.deepEqual(duplicates,[],'Finance master contains duplicate function declarations');

console.log('FINANCE_PREFERENCES_FORECAST_TEST_OK');
