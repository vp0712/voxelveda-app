const money = require('../utils/money');

const PAID_STATUSES = new Set(['paid', 'settled', 'complete', 'completed', 'reimbursed', 'closed']);

function legacyPaidAmount(expense, paymentTotal = '0.00', paymentCount = 0) {
  if (Number(paymentCount || 0) > 0) return money.fromCents(money.toCents(paymentTotal));
  return PAID_STATUSES.has(String(expense?.status || '').toLowerCase())
    ? money.fromCents(money.toCents(expense?.total_amount || 0))
    : '0.00';
}

function paymentState(expense, paymentTotal = '0.00', paymentCount = 0, today = new Date().toISOString().slice(0, 10)) {
  const totalCents = money.toCents(expense?.total_amount || 0);
  const paidCents = money.toCents(legacyPaidAmount(expense, paymentTotal, paymentCount));
  const balanceCents = totalCents > paidCents ? totalCents - paidCents : 0n;
  const rawDueDate = expense?.due_date;
  const dueDate = rawDueDate instanceof Date
    ? rawDueDate.toISOString().slice(0, 10)
    : String(rawDueDate || '').slice(0, 10);

  let status = 'unpaid';
  if (balanceCents === 0n && totalCents > 0n) status = 'paid';
  else if (paidCents > 0n) status = 'partially_paid';
  if (balanceCents > 0n && dueDate && dueDate < today) status = 'overdue';

  return {
    totalPaid: money.fromCents(paidCents),
    balanceDue: money.fromCents(balanceCents),
    status
  };
}

function validatePaymentAmount(amount, balanceDue) {
  const amountCents = money.toCents(amount);
  const balanceCents = money.toCents(balanceDue);
  if (amountCents <= 0n) throw new TypeError('Payment amount must be greater than zero');
  if (amountCents > balanceCents) throw new RangeError('Payment amount cannot exceed the remaining balance');
  return money.fromCents(amountCents);
}

module.exports = { legacyPaidAmount, paymentState, validatePaymentAmount };
