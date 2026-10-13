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
    overpayment: money.fromCents(paidCents > totalCents ? paidCents - totalCents : 0n),
    status
  };
}

// Shared by the dashboard, the filtered register and its summaries.
function paymentSql() {
  const paid = `CASE WHEN COALESCE(p.payment_count,0)>0 THEN LEAST(e.total_amount,COALESCE(p.payment_total,0)) WHEN LOWER(COALESCE(e.status,'')) IN ('paid','settled','complete','completed','reimbursed','closed') THEN e.total_amount ELSE 0 END`;
  return { paid, due:`GREATEST(e.total_amount-(${paid}),0)`, join:`LEFT JOIN (SELECT expense_id,COUNT(*) AS payment_count,SUM(amount) AS payment_total FROM expense_payments WHERE voided_at IS NULL GROUP BY expense_id) p ON p.expense_id=e.id` };
}

function validatePaymentAmount(amount, balanceDue) {
  const amountCents = money.toCents(amount);
  const balanceCents = money.toCents(balanceDue);
  if (amountCents <= 0n) throw new TypeError('Payment amount must be greater than zero');
  if (amountCents > balanceCents) throw new RangeError('Payment amount cannot exceed the remaining balance');
  return money.fromCents(amountCents);
}

module.exports = { legacyPaidAmount, paymentState, validatePaymentAmount, paymentSql };
