'use strict';
const assert=require('assert');
const fs=require('fs');
const routes=fs.readFileSync('routes/financeRoutes.js','utf8');
const controller=fs.readFileSync('controllers/personalDebtPlanningController.js','utf8');
const migration=fs.readFileSync('migrations/20260924_personal_debt_planning.sql','utf8');
const schema=fs.readFileSync('services/financeSchema.js','utf8');
const master=fs.readFileSync('public/finance-master.js','utf8');

assert(routes.includes("router.get('/personal-money/debt-planner'"),'Debt Planner route missing.');
assert(routes.includes("router.put('/personal-money/debts/:id/terms'"),'Debt terms route missing.');
assert(routes.includes("router.get('/personal-money/debts/:id/statement'"),'Debt statement route missing.');
assert(controller.includes("INTEREST_MODES=new Set(['NONE','REFERENCE_ONLY'])"),'Debt interest mode must remain non-accruing/reference-only.');
assert(controller.includes('Outstanding principal changes only when an actual repayment is recorded'),'Principal integrity rule missing.');
assert(controller.includes('does not accrue, capitalise or post interest automatically'),'Interest non-posting rule missing.');
assert(controller.includes('scheduled_monthly_equivalent'),'Repayment schedule normalization missing.');
assert(controller.includes('estimated_annual_interest_reference'),'Reference-rate planning calculation missing.');
assert(controller.includes('people:Object.values(people)'),'Person-level exposure aggregation missing.');
assert(controller.includes('PERSONAL_DEBT_TERMS_UPDATED'),'Debt terms changes must be audit logged.');
assert(!controller.includes('UPDATE personal_money_debts SET outstanding_amount'),'Planning controller must never mutate outstanding principal.');
assert(!controller.includes('INSERT INTO personal_money_debt_payments'),'Planning controller must never invent repayments.');

assert(migration.includes('CREATE TABLE IF NOT EXISTS personal_money_debt_terms'),'Debt planning migration missing.');
assert(schema.includes('CREATE TABLE IF NOT EXISTS personal_money_debt_terms'),'Debt planning schema bootstrap missing.');
assert(!/\b(?:DROP|TRUNCATE)\b/i.test(migration),'Debt planning migration must be additive.');

for(const marker of ['PEOPLE & DEBT CONTROL','People exposure','Debt & repayment schedules','function openDebtTermsForm()','async function debtStatement(id)'])
 assert(master.includes(marker),`Debt Control UI missing ${marker}`);
assert(master.includes("['debtPlanner',API+'/personal-money/debt-planner']"),'Debt Planner must hydrate inside canonical Finance OS.');
assert(master.includes("if(v==='debt')return debtControlView();"),'Borrow & Lend navigation must open Debt Control.');
assert(master.includes('data-debt-terms'),'Debt terms action missing.');
assert(master.includes('data-debt-statement'),'Debt statement action missing.');
console.log('PERSONAL_DEBT_CONTROL_OK');
