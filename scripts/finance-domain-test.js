const assert = require('assert/strict');
const money = require('../utils/money');
const {
  dateOnly,
  financialYearForDate,
  basQuarterForDate,
  validateTransaction,
  validateJournal,
  blockingIssues
} = require('../services/financeDomain');
const { paymentState, validatePaymentAmount } = require('../services/expensePaymentDomain');

function issueCodes(result) {
  return result.issues.map((entry) => entry.code);
}

function run() {
  assert.equal(money.add('1,200.10', '99.90'), '1300.00');
  assert.equal(money.gstFromGross('1250.00', '10'), '113.64');
  assert.equal(money.percentageOf('1000.00', '10'), '100.00');

  assert.deepEqual(paymentState({ total_amount: '5000.00', status: 'unpaid', due_date: '2099-01-01' }), {
    totalPaid: '0.00', balanceDue: '5000.00', status: 'unpaid'
  });
  assert.deepEqual(paymentState({ total_amount: '5000.00', status: 'paid' }), {
    totalPaid: '5000.00', balanceDue: '0.00', status: 'paid'
  });
  assert.deepEqual(paymentState({ total_amount: '5000.00', status: 'unpaid', due_date: '2099-01-01' }, '2000.00', 1), {
    totalPaid: '2000.00', balanceDue: '3000.00', status: 'partially_paid'
  });
  assert.deepEqual(paymentState({ total_amount: '5000.00', status: 'unpaid', due_date: '2020-01-01' }, '2000.00', 1, '2026-01-01'), {
    totalPaid: '2000.00', balanceDue: '3000.00', status: 'overdue'
  });
  assert.deepEqual(paymentState({ total_amount: '5000.00', status: 'unpaid' }, '5000.00', 2), {
    totalPaid: '5000.00', balanceDue: '0.00', status: 'paid'
  });
  assert.equal(validatePaymentAmount('3000', '3000'), '3000.00');
  assert.throws(() => validatePaymentAmount('3000.01', '3000'), /cannot exceed/);
  assert.throws(() => validatePaymentAmount('0', '3000'), /greater than zero/);

  assert.equal(dateOnly(new Date('2026-08-24T00:00:00.000Z')), '2026-08-24');
  assert.equal(dateOnly('2026-08-24T13:45:00.000Z'), '2026-08-24');

  assert.deepEqual(financialYearForDate('2026-07-01'), {
    label: 'FY2026-27',
    start: '2026-07-01',
    end: '2027-06-30',
    startYear: 2026
  });
  assert.equal(financialYearForDate('2026-06-30').label, 'FY2025-26');
  assert.equal(basQuarterForDate('2026-07-01'), 'Q1');
  assert.equal(basQuarterForDate('2027-04-01'), 'Q4');

  const valid = validateTransaction({
    type: 'EXPENSE',
    effective_date: '2026-08-22',
    description: 'Workshop consumables',
    party_name: 'Example Supplier',
    debit_account_id: 10,
    credit_account_id: 20,
    net_amount: '1136.36',
    gst_amount: '113.64',
    gross_amount: '1250.00',
    tax_code: 'GST_ON_EXPENSES',
    status: 'READY',
    document_count: 1
  }, { amountsIncludeGst: true, gstRate: '10' });
  assert.equal(blockingIssues(valid.issues).length, 0);

  const invalidGst = validateTransaction({
    type: 'EXPENSE', effective_date: '2026-08-22', description: 'Consumables',
    party_name: 'Example Supplier', debit_account_id: 10, credit_account_id: 20,
    net_amount: '1000.00', gst_amount: '200.00', gross_amount: '1200.00',
    tax_code: 'GST_ON_EXPENSES', status: 'READY'
  }, { amountsIncludeGst: false, gstRate: '10' });
  assert.ok(issueCodes(invalidGst).includes('GST_MISMATCH'));

  const incomplete = validateTransaction({ type: 'EXPENSE', status: 'DRAFT' });
  assert.ok(blockingIssues(incomplete.issues).length >= 5);

  const balanced = validateJournal([
    { account_id: 10, debit: '1250.00', credit: '0.00' },
    { account_id: 20, debit: '0.00', credit: '1250.00' }
  ]);
  assert.equal(blockingIssues(balanced.issues).length, 0);
  assert.equal(balanced.difference, '0.00');

  const unbalanced = validateJournal([
    { account_id: 10, debit: '1250.00', credit: '0.00' },
    { account_id: 20, debit: '0.00', credit: '1200.00' }
  ]);
  assert.ok(issueCodes(unbalanced).includes('UNBALANCED_JOURNAL'));
  assert.equal(unbalanced.difference, '50.00');

  console.log('Finance domain tests passed.');
}

run();
