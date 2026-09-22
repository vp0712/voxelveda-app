'use strict';

const fs=require('node:fs');
const path=require('node:path');
function read(file){return fs.readFileSync(path.join(__dirname,'..',file),'utf8')}
function assert(value,message){if(!value)throw new Error(message)}

const migration=read('migrations/20260923_finance_transaction_archive.sql');
const controller=read('controllers/financeTransactionLifecycleController.js');
const routes=read('routes/financeRoutes.js');
const client=read('public/finance-master.js');
const trusted=read('services/financeTrustedTotals.js');

['archived_at','archived_by','archive_reason','pre_archive_reconciliation_status','pre_archive_ignored_reason']
  .forEach(token=>assert(migration.includes(token),'archive metadata migration missing '+token));

assert(controller.includes("reconciliation_status='IGNORED'"),'archive must exclude transaction from active reporting using controlled ignore semantics');
assert(controller.includes('pre_archive_reconciliation_status=reconciliation_status'),'archive must preserve prior reconciliation status');
assert(controller.includes('pre_archive_ignored_reason=ignored_reason'),'archive must preserve prior ignored reason');
assert(controller.includes("archived_at=NULL"),'restore must clear archive state');
assert(controller.includes('BANK_TRANSACTION_ARCHIVED'),'archive audit event is missing');
assert(controller.includes('BANK_TRANSACTION_RESTORED'),'restore audit event is missing');
assert(!controller.includes('DELETE FROM bank_transactions'),'financial source rows must never be deleted by archive lifecycle');

assert(routes.includes("router.get('/bank-transactions-archived'"),'archived transaction recovery queue route missing');
assert(routes.includes("router.post('/bank-transactions/:id/archive'"),'archive route missing');
assert(routes.includes("router.post('/bank-transactions/:id/restore'"),'restore route missing');
assert(routes.includes("requireStepUp('RESTORE_BANK_TRANSACTION')"),'transaction restore must require step-up authentication');
assert(routes.includes("financePrivacy.bankTransactionParam('id')"),'transaction lifecycle must remain behind finance privacy middleware');

assert(client.includes('Archived Transactions'),'Review Centre archived queue is missing');
assert(client.includes('data-transaction-archive'),'transaction archive action is missing');
assert(client.includes('data-transaction-restore'),'transaction restore action is missing');
assert(client.includes("API+'/bank-transactions/'+id+'/archive"),'transaction archive client API is missing');
assert(client.includes("API+'/bank-transactions/'+id+'/restore"),'transaction restore client API is missing');

assert(trusted.includes("ignored transactions are expected to be excluded by the caller's WHERE clause"),'Trusted Totals ignored-transaction contract changed unexpectedly');

console.log('FINANCE_TRANSACTION_LIFECYCLE_TEST_OK');
