'use strict';
const assert=require('assert');
const fs=require('fs');
const controller=fs.readFileSync('controllers/financeController.js','utf8');
const schema=fs.readFileSync('services/financeSchema.js','utf8');
const migration=fs.readFileSync('migrations/20260924_finance_issue_controls.sql','utf8');
const master=fs.readFileSync('public/finance-master.js','utf8');
const advanced=fs.readFileSync('public/finance-advanced-control.js','utf8');

assert(schema.includes('CREATE TABLE IF NOT EXISTS finance_issue_controls'),'Issue-control schema bootstrap missing.');
assert(migration.includes('CREATE TABLE IF NOT EXISTS finance_issue_controls'),'Issue-control migration missing.');
assert(!/\b(?:DROP|TRUNCATE)\b/i.test(migration),'Issue-control migration must be additive.');
for(const marker of ['due_date','assigned_by','assigned_at','last_progress_note','last_progress_at'])assert(schema.includes(marker),'Issue-control metadata missing '+marker);

assert(controller.includes('assignee_name'),'Finance issues must expose assignee identity.');
assert(controller.includes('overdue_active'),'Finance issues must expose overdue summary.');
assert(controller.includes('unassigned_active'),'Finance issues must expose unassigned summary.');
assert(controller.includes('assign_to_me'),'Finance issue workflow must support self ownership.');
assert(controller.includes('progress_note'),'Finance issue workflow must support progress evidence.');
assert(controller.includes('ISSUE_CONTROL_UPDATED'),'Finance issue control changes must be audit logged.');
assert(controller.includes("Blocking finance issues cannot be ignored."),'Blocking issues must remain non-ignorable.');
assert(controller.includes('A resolution reason is required.'),'Resolution must require evidence/reason.');

for(const marker of ['Control Actions','function controlActionsView()','Every Finance exception needs an owner, due date and resolution trail',"if(v==='controlactions')return controlActionsView();","['controlActions',API+'/issues']",'data-control-take','data-control-due','data-control-progress','data-control-resolve'])assert(master.includes(marker),'Control Actions UI missing '+marker);
assert(advanced.includes("['issues','/api/finance/issues']"),'Advanced Control must hydrate Finance issue actions.');
assert(advanced.includes('function controlActionsSummary()'),'Advanced Control Actions summary missing.');
assert(advanced.includes('data-fac-open="controlactions"'),'Advanced Control must drill into Control Actions.');
assert(advanced.includes("VERSION='20260924-advanced-control-v10'"),'Advanced Control release must be versioned.');
console.log('FINANCE_CONTROL_ACTIONS_OK');
