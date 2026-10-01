'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert');

const root=path.join(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('migrations/20261001_finance_account_segmentation.sql');
const controller=read('controllers/financeIntelligenceController.js');
const ui=read('public/finance-master.js');
const css=read('public/finance-master.css');

assert(migration.includes('bank_market VARCHAR(20)'),'migration must add bank_market');
assert(migration.includes('bank_country_code CHAR(2)'),'migration must add bank_country_code');
assert(migration.includes('routing_code_masked VARCHAR(40)'),'migration must add generic routing code');
assert(migration.includes('idx_bank_accounts_market_type_status'),'migration must index market/type/status');
assert(controller.includes('normalizeBankMarket'),'controller must validate bank market');
assert(controller.includes('normalizeBankAccountType'),'controller must validate account type');
assert(controller.includes('bank_country_code'),'controller must persist country');
assert(controller.includes('routing_code_masked'),'controller must persist routing code');
assert(controller.includes('ba.bank_market,ba.bank_country_code'),'banking dashboard must return market metadata');
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
