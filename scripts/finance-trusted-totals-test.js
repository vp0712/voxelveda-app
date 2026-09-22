'use strict';

const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const trusted=require('../services/financeTrustedTotalsService');

const result=trusted.summarizeRows([
  { debit:'500.00', credit:'0.00', is_internal_transfer:0 },
  { debit:'0.00', credit:'200.00', linked_refund_amount:'200.00', is_internal_transfer:0 },
  { debit:'150.00', credit:'0.00', is_internal_transfer:0 },
  { debit:'150.00', credit:'0.00', reimbursement_settlement_amount:'150.00', is_internal_transfer:0 },
  { debit:'1000.00', credit:'0.00', is_internal_transfer:1 },
  { debit:'0.00', credit:'1000.00', is_internal_transfer:1 },
  { debit:'0.00', credit:'100.00', is_internal_transfer:0 }
]);

assert.equal(result.cash_in,'300.00','refund cash receipt and ordinary income must remain visible as cash in');
assert.equal(result.cash_out,'800.00','expense and reimbursement settlement are real cash out; transfers are excluded');
assert.equal(result.net_cash_flow,'-500.00','net cash flow must use cash movement only');
assert.equal(result.transfer_in,'1000.00','internal transfer credit remains separately visible');
assert.equal(result.transfer_out,'1000.00','internal transfer debit remains separately visible');
assert.equal(result.economic_income,'100.00','linked refund must not be counted as ordinary income');
assert.equal(result.gross_economic_expense,'650.00','reimbursement settlement must not duplicate the underlying economic expense');
assert.equal(result.refund_offset,'200.00','linked merchant refund must be an expense offset');
assert.equal(result.reimbursement_settlement,'150.00','reimbursement settlement must remain separately traceable');
assert.equal(result.net_economic_expense,'450.00','refund must reduce economic expense');
assert.equal(result.economic_result,'-350.00','economic result must reconcile income less net expense');

const sql=trusted.aggregateSelect('bt');
const joins=trusted.joins('bt');
for(const marker of ['cash_in','cash_out','economic_income','gross_economic_expense','refund_offset','reimbursement_settlement','net_economic_expense']){
  assert.ok(sql.includes(marker),`trusted totals SQL missing ${marker}`);
}
assert.ok(joins.includes('finance_refund_links'),'trusted totals must use canonical refund relationships');
assert.ok(joins.includes("status='ACTIVE'"),'void refund links must not affect totals');
assert.ok(joins.includes('finance_reimbursement_payments'),'trusted totals must use canonical reimbursement settlement relationships');

const controller=read('controllers/financeIntelligenceController.js');
assert.ok(controller.includes("require('../services/financeTrustedTotalsService')"),'Finance intelligence must use the shared totals service');
assert.ok(controller.includes("economic_by_currency"),'dashboard must expose trusted economic totals separately from cash flow');
assert.ok(controller.includes("totals_policy: trustedTotals.POLICY"),'dashboard must explain financial semantics');
assert.ok(controller.includes("...trustedTotals.normalize(count)"),'transaction explorer summary must use shared trusted totals');

const relationships=read('controllers/financeRelationshipController.js');
assert.ok(relationships.includes('REIMBURSEMENT_PAYMENT_OVERALLOCATED'),'reimbursement payment over-allocation guard is missing');
assert.ok(relationships.includes('REIMBURSEMENT_PAYMENT_DEBIT_REQUIRED'),'reimbursement settlement must require an outgoing debit');
assert.ok(relationships.includes('REFUND_TRANSFER_FORBIDDEN'),'internal transfer/refund conflict must be rejected');

console.log('Finance trusted totals calculations and relationship invariants passed.');
