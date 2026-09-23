'use strict';

const fs=require('node:fs');
const path=require('node:path');
function read(file){return fs.readFileSync(path.join(__dirname,'..',file),'utf8')}
function assert(value,message){if(!value)throw new Error(message)}

const migration=read('migrations/20260924_finance_fx_rates.sql');
const controller=read('controllers/financeFxController.js');
const routes=read('routes/financeRoutes.js');
const client=read('public/finance-master.js');

for(const token of ['finance_fx_rates','from_currency','to_currency','effective_date','source_note','uniq_finance_fx_user_day'])assert(migration.includes(token),'FX migration missing '+token);
assert(controller.includes('WHERE user_id=?'),'FX evidence must be scoped to the signed-in user.');
assert(controller.includes('FX rates are user-supplied management-reporting evidence'),'FX controller must state the non-accounting conversion boundary.');
assert(controller.includes('n<=0'),'FX controller must reject non-positive rates.');
assert(controller.includes('FINANCE_FX_RATE_CREATED'),'FX rate creation audit event is missing.');
assert(controller.includes('FINANCE_FX_RATE_ARCHIVED'),'FX rate archive audit event is missing.');

assert(routes.includes("router.get('/fx-rates'"),'FX list route is missing.');
assert(routes.includes("router.post('/fx-rates'"),'FX save route is missing.');
assert(routes.includes("router.post('/fx-rates/:uid/archive'"),'FX archive route is missing.');

assert(client.includes("['currency','FX','Currency Centre']"),'Currency Centre is missing from the unified Finance OS.');
assert(client.includes('function latestFxRate('),'FX resolution helper is missing.');
assert(client.includes('function managementConversionCard('),'Management conversion view is missing.');
assert(client.includes('Finance will not invent an exchange rate.'),'Missing FX evidence must fail closed instead of inventing a conversion.');
assert(client.includes('This creates management-reporting evidence only'),'FX form must disclose that it does not rewrite native transactions.');

console.log('FINANCE_FX_RATES_TEST_OK');

assert(html.includes('value="MANAGEMENT">Management conversion'),'Finance filter bar must expose the evidence-based management conversion centre.');
assert(!client.includes('Reporting-currency conversion is unavailable because no verified FX-rate service is configured'),'Finance must not claim FX conversion is unavailable after the explicit FX register exists.');
assert(client.includes("go('currency')"),'Management conversion selector must route to the Currency Centre.');
