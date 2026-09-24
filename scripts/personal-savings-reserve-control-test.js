'use strict';
const assert=require('assert');
const fs=require('fs');
const controller=fs.readFileSync('controllers/personalSavingsReserveController.js','utf8');
const migration=fs.readFileSync('migrations/20260924_personal_savings_reserve_control.sql','utf8');
const schema=fs.readFileSync('services/financeSchema.js','utf8');
const routes=fs.readFileSync('routes/financeRoutes.js','utf8');
const master=fs.readFileSync('public/finance-master.js','utf8');
const suite=fs.readFileSync('scripts/finance-production-regression-suite.js','utf8');

for(const route of ["router.get('/personal-money/savings-control'","router.put('/personal-money/goals/:id/control'","router.get('/personal-money/goals/:id/statement'"])
  assert(routes.includes(route),'Savings & Reserve route missing: '+route);

for(const marker of [
  "GOAL_TYPES=new Set(['EMERGENCY_FUND','SINKING_FUND','PURCHASE','TRAVEL','INVESTMENT_RESERVE','TAX_RESERVE','OTHER'])",
  'required_monthly_to_target','recent_monthly_pace','forecast_completion_date','emergency_coverage_months',
  'PERSONAL_SAVINGS_CONTROL_UPDATED','never transfers money into a goal automatically'
]) assert(controller.includes(marker),'Savings & Reserve backend missing '+marker);

assert(!controller.includes('UPDATE personal_money_savings_goals SET current_amount'),'Savings control metadata must never alter goal progress.');
assert(!controller.includes('UPDATE personal_money_wallets'),'Savings control must never move wallet money.');
assert(!controller.includes('INSERT INTO personal_money_goal_contributions'),'Savings control must never invent contributions.');
assert(migration.includes('CREATE TABLE IF NOT EXISTS personal_money_savings_control'),'Savings control migration missing.');
assert(schema.includes('CREATE TABLE IF NOT EXISTS personal_money_savings_control'),'Savings control bootstrap missing.');
assert(!/\b(?:DROP|TRUNCATE)\b/i.test(migration),'Savings control migration must be additive.');

for(const marker of ['SAVINGS & RESERVE CONTROL','Emergency funds','Goal & reserve funding plan','function openSavingsControlForm(id)','async function savingsStatement(id)','data-savings-control','data-savings-statement'])
  assert(master.includes(marker),'Savings & Reserve UI missing '+marker);
assert(master.includes("['savingsReserve',API+'/personal-money/savings-control']"),'Savings control must hydrate in canonical Finance OS.');
assert(suite.includes('"personal-savings-reserve-control-test.js"'),'Savings control must gate production.');
console.log('PERSONAL_SAVINGS_RESERVE_CONTROL_OK');
