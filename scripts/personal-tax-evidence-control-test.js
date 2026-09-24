'use strict';
const assert=require('assert');
const fs=require('fs');
const controller=fs.readFileSync('controllers/personalTaxEvidenceControlController.js','utf8');
const migration=fs.readFileSync('migrations/20260924_personal_tax_evidence_control.sql','utf8');
const schema=fs.readFileSync('services/financeSchema.js','utf8');
const routes=fs.readFileSync('routes/financeRoutes.js','utf8');
const master=fs.readFileSync('public/finance-master.js','utf8');

assert(routes.includes("router.get('/personal-money/tax-control'"),'Personal Tax Control read route missing.');
assert(routes.includes("router.put('/personal-money/tax-control/items/:entryId'"),'Personal Tax Control save route missing.');
for(const state of ['UNREVIEWED','CANDIDATE','NOT_CLAIMING','ASK_ACCOUNTANT'])assert(controller.includes(state),`Tax review state missing ${state}`);
for(const state of ['UNKNOWN','HAS_EVIDENCE','MISSING_EVIDENCE'])assert(controller.includes(state),`Evidence state missing ${state}`);
assert(controller.includes("e.user_id=?"),'Tax review source must be owner-scoped.');
assert(controller.includes("['EXPENSE','CASH_OUT']"),'Tax review must remain limited to Personal expense/cash-out candidates.');
assert(controller.includes('does not calculate taxable income, tax payable, tax liability or legal deductibility'),'Tax preparation boundary missing.');
assert(controller.includes('No ATO or other tax FX rate is assumed'),'Tax FX boundary missing.');
assert(controller.includes('PERSONAL_TAX_REVIEW_UPDATED'),'Tax review changes must be audit logged.');
assert(!controller.includes('journal_entries'),'Personal Tax Control must not create accounting journals.');
assert(!controller.includes('tax_payable'),'Personal Tax Control must not calculate tax payable.');
assert(!controller.includes('tax_liability'),'Personal Tax Control must not calculate tax liability.');

assert(migration.includes('CREATE TABLE IF NOT EXISTS personal_tax_review_control'),'Personal Tax migration missing.');
assert(schema.includes('CREATE TABLE IF NOT EXISTS personal_tax_review_control'),'Personal Tax bootstrap schema missing.');
assert(!/\b(?:DROP|TRUNCATE)\b/i.test(migration),'Personal Tax migration must be additive.');

for(const marker of ['PERSONAL TAX & EVIDENCE CONTROL','Persistent review queue','Accountant questions','function openPersonalTaxReviewForm(id)','data-personal-tax-review'])
  assert(master.includes(marker),`Personal Tax UI missing ${marker}`);
assert(master.includes("['personalTaxControl',API+'/personal-money/tax-control']"),'Personal Tax Control must hydrate in canonical Finance OS.');
assert(master.includes("method:'PUT'"),'Persistent Personal Tax review save action missing.');
console.log('PERSONAL_TAX_EVIDENCE_CONTROL_OK');
