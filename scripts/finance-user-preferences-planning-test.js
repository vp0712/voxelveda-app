'use strict';

const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const { normalizePreferences }=require('../services/financeUserPreferencesService');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const expect=(source,token,message)=>assert(source.includes(token),message+' (missing: '+token+')');

const prefs=normalizePreferences({
 default_workspace:'personal',default_account_id:'7',reporting_currency:'aud',default_period:'quarter',
 dashboard_cards:['cashflow','accounts','recent'],date_format:'YYYY-MM-DD',number_format:'en-AU'
});
assert.equal(prefs.default_workspace,'PERSONAL');
assert.equal(prefs.default_account_id,7);
assert.equal(prefs.reporting_currency,'AUD');
assert.deepEqual(prefs.dashboard_cards,['cashflow','accounts','recent']);
assert.throws(()=>normalizePreferences({default_workspace:'EVERYTHING'}),/workspace/);
assert.throws(()=>normalizePreferences({default_period:'all_time'}),/period/);
assert.throws(()=>normalizePreferences({reporting_currency:'AU'}),/three-letter/);

const migration=read('migrations/20260923_finance_user_preferences.sql');
expect(migration,'CREATE TABLE IF NOT EXISTS finance_user_preferences','Finance preferences migration missing');
expect(migration,'dashboard_cards_json JSON','Dashboard preference storage missing');

const controller=read('controllers/financeUserPreferencesController.js');
expect(controller,'privacy.assertAccountAccess','Default account must be permission checked');
expect(controller,'FINANCE_PREFERENCES_UPDATED','Preference audit event missing');
expect(controller,'Array.isArray(value)','MySQL JSON preference parsing must accept parsed JSON');
expect(controller,"WHERE user_id=?",'Preferences must be isolated per user');

const routes=read('routes/financeRoutes.js');
expect(routes,"router.get('/preferences'",'Finance preferences GET route missing');
expect(routes,"router.put('/preferences'",'Finance preferences PUT route missing');
[
 "router.get('/personal-money/smart'",
 "router.get('/personal-money/health'",
 "router.get('/personal-money/roadmaps'",
 "router.get('/banking-os/cashflow-calendar'"
].forEach(token=>expect(routes,token,'Existing planning route missing'));

const ui=read('public/finance-master.js');
[
 "['forecast','◷','Forecast']",
 "['calendar','▦','Cash Flow Calendar']",
 'function forecastView()',
 'function calendarView()',
 'function userPreferencesCard()',
 "key==='attention'||configured.includes(key)",
 "dashboardCardVisible('cashflow')",
 "dashboardCardVisible('recent')",
 'A reporting-currency preference never relabels native amounts',
 'no forecast mutates financial records',
 'This does not claim direct bank execution'
].forEach(token=>expect(ui,token,'Finance planning/preference UI contract missing'));
[
 /loadResource\('userPreferences',API\+'\/preferences'(?:,cycle)?\)/,
 /\['smart',API\+'\/personal-money\/smart'\]/,
 /\['health',API\+'\/personal-money\/health'\]/,
 /\['roadmaps',API\+'\/personal-money\/roadmaps'\]/,
 /\['cashflowCalendar',OS\+'\/cashflow-calendar\?days=90'\]/
].forEach(pattern=>assert.match(ui,pattern,'Finance planning/preference resource contract missing'));

const functions=[...ui.matchAll(/(?:^|\n)(?:async )?function\s+([A-Za-z0-9_]+)\s*\(/g)].map(m=>m[1]);
const duplicates=[...new Set(functions.filter((name,index)=>functions.indexOf(name)!==index))];
assert.deepEqual(duplicates,[],'Finance master must not contain duplicate function declarations');

console.log('FINANCE_USER_PREFERENCES_PLANNING_TEST_OK');
