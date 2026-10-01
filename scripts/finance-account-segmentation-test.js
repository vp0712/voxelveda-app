'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert');

const root=path.join(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('migrations/20261001_finance_account_segmentation.sql');
const controller=read('controllers/financeIntelligenceController.js');
const schema=read('services/financeSchema.js');
const ui=read('public/finance-master.js');
const css=read('public/finance-master.css');

assert(migration.includes('finance_account_segmentation_schema_free'),'migration must be schema-free');
assert(!/ALTER\s+TABLE\s+bank_accounts/i.test(migration),'segmentation migration must not rebuild bank_accounts');
assert(controller.includes('normalizeBankMarket'),'controller must validate bank market');
assert(controller.includes('normalizeBankAccountType'),'controller must validate account type');
assert(controller.includes('BANK_MARKET_SQL'),'controller must derive bank market from durable account fields');
assert(controller.includes('AS bank_market'),'accounts API must return derived market metadata');
assert(controller.includes('AS bank_country_code'),'accounts API must return derived country metadata');
assert(controller.includes("THEN ba.bsb_masked ELSE NULL END AS routing_code_masked"),'Indian routing identifier must be exposed without a new column');
assert(controller.includes("bankMarket === 'INDIA'"),'save flow must preserve Indian account identity through currency/type');
assert(!controller.includes('SET nickname=?, institution=?, bank_market=?'),'save flow must not require a bank_market column');
assert(!schema.includes('bank_market VARCHAR(20)'),'clean-install schema must remain compatible with the existing bank_accounts shape');
assert(!schema.includes('routing_code_masked VARCHAR(40)'),'clean-install schema must not require a routing column');
assert(ui.includes('data-account-market-filter'),'accounts UI must expose market filter');
assert(ui.includes('data-account-type-filter'),'accounts UI must expose account-type filter');
assert(ui.includes('Banking market'),'account form must expose banking market');
assert(ui.includes('Current account (India)'),'account form must expose Indian current account');
assert(ui.includes('NRE account'),'account form must expose NRE');
assert(ui.includes('NRO account'),'account form must expose NRO');
assert(ui.includes('statementAccountOptions'),'statement uploader must group individual accounts');
assert(ui.includes("accounts?.bank_accounts||accounts?.accounts||[]"),'account fallback must read the actual accounts response');
assert(ui.includes('One real bank account = one Finance account.'),'account form must explain exact account boundaries');
assert(css.includes('.fm-account-segment-filters'),'theme must style account segmentation filters');

console.log('FINANCE_ACCOUNT_SEGMENTATION_TEST_OK');
