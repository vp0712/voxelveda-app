'use strict';
const assert=require('assert');
const fs=require('fs');
const routes=fs.readFileSync('routes/financeRoutes.js','utf8');
const controller=fs.readFileSync('controllers/financePlanningControlController.js','utf8');
const schema=fs.readFileSync('services/financeSchema.js','utf8');
const migration=fs.readFileSync('migrations/20260924_finance_fpa_planning.sql','utf8');
const master=fs.readFileSync('public/finance-master.js','utf8');
const advanced=fs.readFileSync('public/finance-advanced-control.js','utf8');

for(const route of [
 "router.get('/planning-control'",
 "router.post('/planning-control/plans'",
 "router.post('/planning-control/plans/:uid/clone'",
 "router.put('/planning-control/plans/:uid/lines'",
 "router.delete('/planning-control/plans/:uid/lines/:lineId'",
 "router.post('/planning-control/plans/:uid/status'"
]) assert(routes.includes(route),`FP&A route missing: ${route}`);

assert(routes.includes("requireStepUp('CHANGE_FINANCE_PLAN_STATUS')"),'Plan status changes must require step-up.');
for(const marker of [
 'Only DRAFT plan lines are editable',
 'never silently combined across currencies',
 'actualEvidence(plan,req)',
 "bt.is_internal_transfer=0",
 "bt.reconciliation_status<>'IGNORED'",
 'completed_plan_accuracy_percent',
 'rolling_12_month',
 'split_integrity_variance_count',
 "status='SUPERSEDED'",
 'FINANCE_PLAN_IMMUTABLE'
]) assert(controller.includes(marker),`FP&A controller contract missing ${marker}`);

assert(!controller.includes('UPDATE bank_transactions SET'),'FP&A must never mutate bank transactions.');
assert(!controller.includes('INSERT INTO bank_transactions'),'FP&A must never invent actual transactions.');
assert(controller.includes("ba.ownership_scope='PERSONAL' AND ba.created_by=?"),'Personal actuals must remain owner-scoped.');
assert(controller.includes("ba.ownership_scope='BUSINESS'"),'Business actuals must use business scope.');
assert(controller.includes('BUSINESS_PLAN_FULL_ACCESS_REQUIRED'),'Business plans require full Company Finance visibility.');

assert(migration.includes('CREATE TABLE IF NOT EXISTS finance_operating_plans'),'FP&A plan migration missing.');
assert(migration.includes('CREATE TABLE IF NOT EXISTS finance_operating_plan_lines'),'FP&A line migration missing.');
assert(schema.includes('CREATE TABLE IF NOT EXISTS finance_operating_plans'),'FP&A schema bootstrap missing.');
assert(schema.includes('CREATE TABLE IF NOT EXISTS finance_operating_plan_lines'),'FP&A line bootstrap missing.');
assert(!/\b(?:DROP|TRUNCATE)\b/i.test(migration),'FP&A migration must be additive.');

for(const marker of [
 'FP&A PLANNING',
 'Monthly plan · actual · rolling forecast',
 'function openPlanningPlanForm()',
 'function openPlanningLineForm()'
]) assert(master.includes(marker),`FP&A UI missing ${marker}`);

assert(master.includes("['planning','▦','FP&A Planning']"),'FP&A must be in Planning navigation.');
assert(master.includes("['planningControl',API+'/planning-control']"),'FP&A must hydrate in canonical Finance OS.');
assert(master.includes("if(v==='planning')return planningControlView();"),'FP&A route binding missing.');
assert(advanced.includes('/api/finance/planning-control'),'Advanced Control must hydrate FP&A.');
assert(advanced.includes('FP&A · Plan vs Actual'),'Advanced Control must surface FP&A.');
console.log('FINANCE_FPA_PLANNING_OK');
