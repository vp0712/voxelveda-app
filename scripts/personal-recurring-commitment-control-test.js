'use strict';
const assert=require('assert');
const fs=require('fs');
const controller=fs.readFileSync('controllers/personalRecurringCommitmentController.js','utf8');
const migration=fs.readFileSync('migrations/20260924_personal_recurring_commitment_control.sql','utf8');
const schema=fs.readFileSync('services/financeSchema.js','utf8');
const routes=fs.readFileSync('routes/financeRoutes.js','utf8');
const master=fs.readFileSync('public/finance-master.js','utf8');

assert(routes.includes("router.get('/personal-money/commitments-control'"),'Commitment Control read route missing.');
assert(routes.includes("router.put('/personal-money/recurring/:id/control'"),'Commitment Control update route missing.');
assert(controller.includes("DECISIONS=new Set(['KEEP','REVIEW','CANCEL_PLANNED'])"),'Commitment lifecycle decisions missing.');
assert(controller.includes("ESSENTIALITY=new Set(['UNKNOWN','ESSENTIAL','DISCRETIONARY'])"),'Commitment essentiality control missing.');
assert(controller.includes("AUTO_RENEW=new Set(['UNKNOWN','YES','NO'])"),'Auto-renew control missing.');
assert(controller.includes('possible_price_change'),'Bank-evidence price-change suggestion missing.');
assert(controller.includes('Recent bank charges are heuristic evidence suggestions only'),'Bank evidence must remain suggestion-only.');
assert(controller.includes('never pays, renews or cancels'),'Commitment control must disclose non-execution.');
assert(controller.includes('PERSONAL_RECURRING_CONTROL_UPDATED'),'Control changes must be audit logged.');
assert(!controller.includes('UPDATE personal_money_recurring_items SET amount'),'Control metadata must never auto-reprice recurring schedules.');
assert(!controller.includes('DELETE FROM personal_money_recurring_items'),'Control metadata must not delete recurring history.');

assert(migration.includes('CREATE TABLE IF NOT EXISTS personal_money_recurring_control'),'Commitment migration missing.');
assert(schema.includes('CREATE TABLE IF NOT EXISTS personal_money_recurring_control'),'Commitment bootstrap table missing.');
assert(!/\b(?:DROP|TRUNCATE)\b/i.test(migration),'Commitment migration must be additive.');

for(const marker of ['SUBSCRIPTION & RECURRING COMMITMENT CONTROL','Renewing ≤30 days','Possible price changes','function openRecurringControlForm(id)','data-recurring-control'])
 assert(master.includes(marker),`Commitment UI missing ${marker}`);
assert(master.includes("['commitments',API+'/personal-money/commitments-control']"),'Commitment Control must hydrate in canonical Finance OS.');
assert(master.includes("method:'PUT'"),'Commitment metadata save action missing.');
console.log('PERSONAL_RECURRING_COMMITMENT_CONTROL_OK');
