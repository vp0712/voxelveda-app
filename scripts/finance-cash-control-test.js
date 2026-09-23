'use strict';
const assert=require('assert');
const fs=require('fs');
const routes=fs.readFileSync('routes/financeRoutes.js','utf8');
const controller=fs.readFileSync('controllers/financeCashControlController.js','utf8');
const migration=fs.readFileSync('migrations/20260924_finance_cash_control.sql','utf8');
const master=fs.readFileSync('public/finance-master.js','utf8');

for(const route of ["router.get('/cash-control'","router.post('/cash-control/counts'","router.post('/cash-control/counts/:uid/review'","router.post('/cash-control/transfers'","router.post('/cash-control/transfers/:uid/reverse'"])
  assert(routes.includes(route),`Cash Control route missing: ${route}`);
assert(routes.includes("requireStepUp('REVIEW_CASH_VARIANCE')"),'Cash variance review must require step-up.');
assert(routes.includes("requireStepUp('RECORD_CASH_TRANSFER')"),'Cash transfer linking must require step-up.');
assert(routes.includes("requireStepUp('REVERSE_CASH_TRANSFER')"),'Cash transfer reversal must require step-up.');

assert(controller.includes('expected_amount'), 'Cash counts must capture expected amount.');
assert(controller.includes('actual_amount'), 'Cash counts must capture actual amount.');
assert(controller.includes('variance_amount'), 'Cash counts must capture shortage/surplus variance.');
assert(controller.includes("status=Math.abs(variance)<=0.005?'BALANCED':'REVIEW_REQUIRED'"),'Non-zero cash variance must require review.');
assert(controller.includes('No ledger balance was changed'), 'Cash count must explicitly avoid silent ledger correction.');
assert(controller.includes("String(tx.account_scope||tx.ownership_scope||'').toUpperCase()!=='PERSONAL'"),'Bank↔wallet transfer linking must remain owner-only PERSONAL.');
assert(controller.includes('CASH_TRANSFER_FULL_AMOUNT_REQUIRED'),'Cash transfer links must require the full bank transaction amount.');
assert(controller.includes("UPDATE bank_transactions SET is_internal_transfer=1"),'Linked cash movements must become explicit internal transfers.');
assert(controller.includes("entryType=direction==='BANK_TO_CASH'?'CASH_IN':'CASH_OUT'"),'Cash transfer must create a non-income/non-expense wallet movement.');
assert(controller.includes("status='REVERSED'"),'Cash transfer links must support controlled reversal.');
assert(controller.includes('reversal_entry_id'),'Transfer reversal must retain counter-evidence.');
assert(!controller.includes('DELETE FROM finance_cash_transfer_links'),'Cash transfer reversal must not delete evidence.');
assert(!controller.includes('DELETE FROM finance_cash_counts'),'Cash count review must not delete evidence.');

assert(migration.includes('CREATE TABLE IF NOT EXISTS finance_cash_counts'),'Cash count migration missing.');
assert(migration.includes('CREATE TABLE IF NOT EXISTS finance_cash_transfer_links'),'Cash transfer migration missing.');
assert(!/\b(?:DROP|TRUNCATE)\b/i.test(migration),'Cash Control migration must be additive.');

for(const marker of ['PHYSICAL CASH CONTROL','Cash count & Daily Close','Expected vs actual cash','Bank ↔ Cash transfer links','custodian','variance'])
  assert(master.toLowerCase().includes(marker.toLowerCase()),`Cash Control UI missing ${marker}`);
assert(master.includes("['cashControl',API+'/cash-control']"),'Cash Control must hydrate inside canonical Finance OS.');
assert(master.includes('function openCashCountForm()'),'Cash count workflow form missing.');
assert(master.includes('function openCashTransferForm()'),'Bank↔cash linking workflow form missing.');
assert(master.includes("data-cash-count-review"),'Variance review action missing.');
assert(master.includes("data-cash-transfer-reverse"),'Cash transfer reversal action missing.');
console.log('FINANCE_CASH_CONTROL_OK');
