'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { normalizeCategory, normalizePreferences } = require('../services/financeControlPreferencesService');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const expect = (source, token, message) => assert(source.includes(token), message + ' (missing: ' + token + ')');

const category = normalizeCategory({ name:'Office Supplies', scope:'business', gst_default:'gst', colour:'#112233', icon:'office' });
assert.equal(category.name, 'Office Supplies');
assert.equal(category.scope, 'BUSINESS');
assert.equal(category.gst_default, 'GST');
assert.equal(category.colour, '#112233');
assert.throws(() => normalizeCategory({ name:'x', scope:'BUSINESS' }), /at least 2 characters/);
assert.throws(() => normalizeCategory({ name:'Fuel', scope:'GLOBAL' }), /scope/);
assert.throws(() => normalizeCategory({ name:'Fuel', scope:'BUSINESS', colour:'red' }), /six-digit hex/);

const prefs = normalizePreferences({
  default_workspace:'personal', default_account_id:'7', reporting_currency:'aud', default_period:'quarter',
  dashboard_cards:['cashflow','accounts','recent'], date_format:'YYYY-MM-DD', number_format:'en-AU'
});
assert.equal(prefs.default_workspace, 'PERSONAL');
assert.equal(prefs.default_account_id, 7);
assert.equal(prefs.reporting_currency, 'AUD');
assert.deepEqual(prefs.dashboard_cards, ['cashflow','accounts','recent']);
assert.throws(() => normalizePreferences({ default_workspace:'EVERYTHING' }), /workspace/);
assert.throws(() => normalizePreferences({ default_period:'all_time' }), /period/);
assert.throws(() => normalizePreferences({ reporting_currency:'AU' }), /three-letter/);

const migration = read('migrations/20260923_finance_categories_preferences.sql');
expect(migration, 'CREATE TABLE IF NOT EXISTS finance_categories', 'Finance categories migration missing');
expect(migration, 'CREATE TABLE IF NOT EXISTS finance_user_preferences', 'Finance user preferences migration missing');
expect(migration, 'dashboard_cards_json JSON', 'Dashboard preference storage missing');

const controller = read('controllers/financeControlPreferencesController.js');
expect(controller, "fc.scope IN ('BUSINESS','BOTH')", 'Shared category visibility rule missing');
expect(controller, "fc.scope='PERSONAL' AND fc.created_by=?", 'Personal category owner isolation missing');
expect(controller, 'privacy.visibilitySql', 'Observed categories must use Finance account privacy');
expect(controller, 'privacy.assertAccountAccess', 'Default account preference must validate account access');
expect(controller, 'FINANCE_CATEGORY_ARCHIVED', 'Category archive audit event missing');
expect(controller, 'FINANCE_PREFERENCES_UPDATED', 'Preference update audit event missing');

const routes = read('routes/financeRoutes.js');
[
  "router.get('/categories'", "router.post('/categories'", "router.put('/categories/:id'",
  "router.post('/categories/:id/archive'", "router.post('/categories/:id/restore'",
  "router.get('/preferences'", "router.put('/preferences'",
  "router.get('/personal-money/smart'", "router.get('/personal-money/health'",
  "router.get('/personal-money/roadmaps'", "router.get('/banking-os/cashflow-calendar'"
].forEach((token) => expect(routes, token, 'Finance planning/control route missing'));

const ui = read('public/finance-master.js');
[
  "['forecast','◒','Forecast']", "['calendar','▦','Cash Flow Calendar']", "['categories','◈','Categories']",
  "loadResource('smart',API+'/personal-money/smart')", "loadResource('health',API+'/personal-money/health')",
  "loadResource('roadmaps',API+'/personal-money/roadmaps')", "loadResource('cashflowCalendar',OS+'/cashflow-calendar?days=90')",
  "loadResource('categories',API+'/categories')", "loadResource('userPreferences',API+'/preferences')",
  'function forecastView()', 'function calendarView()', 'function categoriesView()', 'function userPreferencesCard()',
  'Original bank categories remain immutable source evidence',
  'Reporting-currency conversion is not activated unless verified FX evidence exists',
  "key==='attention'||configured.includes(key)"
].forEach((token) => expect(ui, token, 'Finance planning/control UI contract missing'));

const functions = [...ui.matchAll(/(?:^|\n)(?:async )?function\s+([A-Za-z0-9_]+)\s*\(/g)].map((m) => m[1]);
const duplicates = [...new Set(functions.filter((name, index) => functions.indexOf(name) !== index))];
assert.deepEqual(duplicates, [], 'Finance master must not contain duplicate function declarations');

console.log('FINANCE_PLANNING_CONTROL_TEST_OK');
