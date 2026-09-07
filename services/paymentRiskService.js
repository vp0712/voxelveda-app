const money = require('../utils/money');

function thresholdCents() {
  return money.toCents(process.env.HIGH_RISK_PAYMENT_THRESHOLD || '5000.00');
}

function approvalTtlHours() {
  const value = Number(process.env.PAYMENT_APPROVAL_TTL_HOURS || 24);
  return Number.isFinite(value) && value >= 1 && value <= 72 ? Math.floor(value) : 24;
}

function levelForScore(score) {
  if (score >= 80) return 'CRITICAL';
  if (score >= 55) return 'HIGH';
  if (score >= 30) return 'MEDIUM';
  return 'LOW';
}

async function assessSupplierPayment({ billId, amount, actorId, connection }) {
  const amountCents = money.toCents(amount);
  const threshold = thresholdCents();
  const [[bill]] = await connection.query(
    'SELECT id, supplier_id, bill_uid, total_amount, paid_amount FROM supplier_bills WHERE id = ? LIMIT 1',
    [billId]
  );
  if (!bill) return null;

  const [[bankDetail]] = await connection.query(
    `SELECT id, activated_at, account_last_four
     FROM sensitive_bank_details
     WHERE subject_type = 'SUPPLIER' AND subject_id = ? AND status = 'ACTIVE'
     ORDER BY activated_at DESC, id DESC LIMIT 1`,
    [bill.supplier_id]
  );
  const recentDays = Math.max(1, Math.min(30, Number(process.env.BANK_DETAIL_RECENT_DAYS || 7)));
  const [[activity]] = await connection.query(
    `SELECT COUNT(*) AS payment_count, COALESCE(SUM(p.amount), 0) AS payment_total
     FROM supplier_bill_payments p
     JOIN supplier_bills sb ON sb.id = p.supplier_bill_id
     WHERE sb.supplier_id = ? AND p.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
    [bill.supplier_id]
  );
  const [[duplicate]] = await connection.query(
    `SELECT COUNT(*) AS duplicate_count
     FROM supplier_bill_payments
     WHERE supplier_bill_id = ? AND amount = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
    [billId, amount]
  );
  const [[sinceBankChange]] = bankDetail ? await connection.query(
    `SELECT COUNT(*) AS payment_count
     FROM supplier_bill_payments p
     JOIN supplier_bills sb ON sb.id = p.supplier_bill_id
     WHERE sb.supplier_id = ? AND p.created_at >= ?`,
    [bill.supplier_id, bankDetail.activated_at]
  ) : [[{ payment_count: 0 }]];

  const reasons = [];
  let score = 0;
  if (amountCents >= threshold) { reasons.push('HIGH_VALUE_PAYMENT'); score += 40; }
  if (amountCents >= threshold * 2n) score += 20;
  if (!bankDetail) {
    reasons.push('SUPPLIER_BANK_DETAILS_NOT_VERIFIED');
    score += 35;
  }
  const bankAgeMs = bankDetail ? Date.now() - new Date(bankDetail.activated_at).getTime() : Infinity;
  if (bankAgeMs >= 0 && bankAgeMs <= recentDays * 86400000) {
    reasons.push('SUPPLIER_BANK_DETAILS_RECENTLY_CHANGED');
    score += 45;
  }
  if (bankDetail && Number(sinceBankChange.payment_count || 0) === 0) {
    reasons.push('FIRST_PAYMENT_TO_CURRENT_BANK_DETAILS');
    score += 20;
  }
  if (Number(duplicate.duplicate_count || 0) > 0) {
    reasons.push('POSSIBLE_DUPLICATE_PAYMENT');
    score += 35;
  }
  if (Number(activity.payment_count || 0) >= 3) {
    reasons.push('SUPPLIER_PAYMENT_VELOCITY');
    score += 20;
  }

  score = Math.min(100, score);
  return {
    requireApproval: score >= 30,
    score,
    level: levelForScore(score),
    reasons: [...new Set(reasons)],
    bankDetailId: bankDetail?.id || null,
    snapshot: {
      evaluated_at: new Date().toISOString(),
      actor_id: Number(actorId),
      supplier_id: Number(bill.supplier_id),
      bill_uid: bill.bill_uid,
      bank_detail_id: bankDetail?.id || null,
      bank_ending: bankDetail?.account_last_four || null,
      recent_payment_count: Number(activity.payment_count || 0),
      recent_payment_total: String(activity.payment_total || '0.00'),
      duplicate_count: Number(duplicate.duplicate_count || 0),
      threshold: money.fromCents(threshold)
    }
  };
}

module.exports = { approvalTtlHours, assessSupplierPayment, levelForScore, thresholdCents };
