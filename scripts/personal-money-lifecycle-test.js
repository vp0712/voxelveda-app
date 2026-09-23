'use strict';

const fs=require('node:fs');
const path=require('node:path');
function read(file){return fs.readFileSync(path.join(__dirname,'..',file),'utf8')}
function assert(value,message){if(!value)throw new Error(message)}

const money=read('controllers/personalMoneyController.js');
const attention=read('controllers/personalMoneyAttentionController.js');
const routes=read('routes/financeRoutes.js');
const client=read('public/finance-master.js');

assert(money.includes('exports.setWalletActive'),'wallet lifecycle controller is missing');
assert(money.includes('Move the wallet balance to zero before archiving it.'),'non-zero personal wallets must not be hidden by archive');
assert(money.includes('archived_wallets'),'Personal Money dashboard must expose recoverable archived wallets');
assert(money.includes('exports.deleteBudget'),'personal budget removal is missing');
assert(money.includes('No transaction or wallet history was deleted.'),'budget removal must not imply financial-history deletion');

assert(attention.includes('exports.setRecurringActive'),'recurring archive/restore lifecycle is missing');
assert(attention.includes('archived_recurring'),'archived recurring items must remain recoverable');
assert(attention.includes('exports.setGoalStatus'),'goal pause/resume lifecycle is missing');
assert(attention.includes("['ACTIVE','PAUSED']"),'goal status changes must not fake completion');

assert(routes.includes("router.post('/personal-money/wallets/:id/active'"),'wallet lifecycle route missing');
assert(routes.includes("router.delete('/personal-money/budgets/:id'"),'budget removal route missing');
assert(routes.includes("router.post('/personal-money/recurring/:id/active'"),'recurring lifecycle route missing');
assert(routes.includes("router.post('/personal-money/goals/:id/status'"),'goal status route missing');

assert(client.includes('data-wallet-active'),'wallet archive/recovery controls missing');
assert(client.includes('data-personal-budget-delete'),'personal budget removal control missing');
assert(client.includes('data-recurring-active'),'recurring archive/recovery control missing');
assert(client.includes('data-goal-status'),'goal pause/resume control missing');

console.log('PERSONAL_MONEY_LIFECYCLE_TEST_OK');
