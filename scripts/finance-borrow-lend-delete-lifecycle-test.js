'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const assert=(ok,message)=>{if(!ok)throw new Error(message)};

const controller=read('controllers/personalMoneyController.js');
const routes=read('routes/financeRoutes.js');
const client=read('public/finance-master.js');
const lifecycle=read('controllers/financeTransactionLifecycleController.js');

assert(controller.includes('exports.getDebtDetail'),'Borrow/Lend detail endpoint missing.');
assert(controller.includes('personal_money_debt_payments'),'Borrow/Lend detail must expose repayment history.');
assert(controller.includes('exports.updateDebtDetail'),'Borrow/Lend metadata edit endpoint missing.');
assert(controller.includes('Principal, currency and payment history were not changed.'),'Debt metadata edit must preserve financial terms.');
assert(routes.includes("router.get('/personal-money/debts/:id'"),'Borrow/Lend detail route missing.');
assert(routes.includes("router.put('/personal-money/debts/:id'"),'Borrow/Lend update route missing.');
assert(client.includes('function debtDetail('),'Borrow/Lend detail drawer missing.');
assert(client.includes('Repayment history'),'Borrow/Lend repayment history UI missing.');
assert(client.includes('data-debt-view'),'Borrow/Lend view action missing.');

assert(client.includes('Delete wrong entry'),'Manual mistake deletion workflow missing.');
assert(client.includes('Wrong manual entry removed from the active ledger'),'Manual delete must explain recoverability.');
assert(client.includes('Deleted / Archived Transactions'),'Recovery queue must be obvious.');
assert(lifecycle.includes('archived_at=NOW()'),'transaction deletion must remain recoverable logical deletion.');
assert(!lifecycle.includes('DELETE FROM bank_transactions'),'canonical transaction evidence must not be destructively erased.');

console.log('Finance Borrow/Lend and recoverable-delete lifecycle checks passed.');
