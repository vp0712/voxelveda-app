'use strict';

const assert = require('node:assert/strict');
const relationships = require('../controllers/financeRelationshipController');
const audit = require('../controllers/financeAuditController');

const calculate = relationships._test.reimbursementPaymentState;

assert.deepEqual(
  calculate({ requestedAmount: '500.00', paidAmount: '0.00', paymentAmount: '200.00', paymentDebit: '200.00', paymentAllocated: '0.00' }),
  { payment: '200.00', remaining: '300.00', status: 'PARTIALLY_REIMBURSED' },
  'partial reimbursement math must be exact'
);
assert.deepEqual(
  calculate({ requestedAmount: '500.00', paidAmount: '200.00', paymentAmount: '300.00', paymentDebit: '400.00', paymentAllocated: '100.00' }),
  { payment: '300.00', remaining: '0.00', status: 'FULLY_REIMBURSED' },
  'full reimbursement must account for prior claim and payment allocations'
);
assert.throws(
  () => calculate({ requestedAmount: '500.00', paidAmount: '0.00', paymentAmount: '250.00', paymentDebit: '300.00', paymentAllocated: '100.00' }),
  (error) => error.code === 'REIMBURSEMENT_PAYMENT_OVERALLOCATED',
  'one settlement transaction must not be over-allocated across reimbursements'
);
assert.throws(
  () => calculate({ requestedAmount: '500.00', paidAmount: '450.00', paymentAmount: '50.01', paymentDebit: '100.00', paymentAllocated: '0.00' }),
  (error) => error.code === 'REIMBURSEMENT_PAYMENT_INVALID',
  'settlement must not exceed the claim balance'
);

const description = audit._test.eventDescription(
  'BANK_TRANSACTION_UPDATED',
  { category: null, ownership_scope: 'UNCLASSIFIED' },
  { category: 'Fuel', ownership_scope: 'BUSINESS' }
);
assert.match(description, /category: Uncategorised to Fuel/);
assert.match(description, /ownership: UNCLASSIFIED to BUSINESS/);

console.log('Finance reimbursement settlement and audit description checks passed.');
