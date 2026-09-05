const crypto = require('crypto');
const pool = require('../config/db');
const money = require('../utils/money');
const { ensureHighRiskFinanceSchema } = require('../services/highRiskFinanceSchema');
const { logAudit } = require('../services/auditService');

function thresholdCents() {
  return money.toCents(process.env.HIGH_RISK_PAYMENT_THRESHOLD || '5000.00');
}

module.exports = async function highRiskPaymentGuard(req, res, next) {
  try {
    await ensureHighRiskFinanceSchema();
    const billId = Number(req.params.id || 0);
    let amount;
    try { amount = money.fromCents(money.toCents(req.body.amount)); } catch {
      return res.status(400).json({ message: 'Enter a valid positive payment amount.', code: 'INVALID_PAYMENT_AMOUNT' });
    }
    if (!billId || money.toCents(amount) <= 0n) return res.status(400).json({ message: 'Enter a valid supplier bill and positive payment amount.', code: 'INVALID_PAYMENT_AMOUNT' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.body.payment_date || ''))) return res.status(400).json({ message: 'Enter a valid payment date.', code: 'PAYMENT_DATE_REQUIRED' });
    const [[bill]] = await pool.query(`SELECT supplier_id FROM supplier_bills WHERE id = ?`, [billId]);
    if (!bill) return res.status(404).json({ message: 'Supplier bill not found.', code: 'BILL_NOT_FOUND' });
    const recentDays = Math.max(1, Number(process.env.BANK_DETAIL_RECENT_DAYS || 7));
    const [[recentBank]] = await pool.query(
      `SELECT id FROM sensitive_bank_details WHERE subject_type = 'SUPPLIER' AND subject_id = ? AND status = 'ACTIVE'
       AND activated_at >= DATE_SUB(NOW(), INTERVAL ? DAY) LIMIT 1`, [bill.supplier_id, recentDays]
    );
    const reasons = [];
    if (money.toCents(amount) >= thresholdCents()) reasons.push('HIGH_VALUE_PAYMENT');
    if (recentBank) reasons.push('SUPPLIER_BANK_DETAILS_RECENTLY_CHANGED');
    if (!reasons.length) return next();

    const [[existing]] = await pool.query(
      `SELECT id FROM payment_approval_requests
       WHERE supplier_bill_id = ? AND initiated_by = ? AND amount = ? AND status = 'PENDING'
       ORDER BY initiated_at DESC LIMIT 1`, [billId, req.user.id, amount]
    );
    if (existing) {
      return res.status(202).json({
        message: 'This high-risk payment is already awaiting independent approval.',
        code: 'DUAL_APPROVAL_REQUIRED', approval_request_id: existing.id, status: 'PENDING', risk_reasons: reasons
      });
    }

    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO payment_approval_requests
       (id, supplier_bill_id, payment_date, amount, bank_account_id, payment_method, reference, notes, risk_reasons, initiated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, billId, req.body.payment_date, amount, Number(req.body.bank_account_id || 0) || null,
        String(req.body.payment_method || 'Bank').slice(0, 60), String(req.body.reference || '').slice(0, 180) || null,
        String(req.body.notes || '').slice(0, 2000) || null, JSON.stringify(reasons), req.user.id]
    );
    await logAudit(pool, {
      actorId: req.user.id, action: 'PAYMENT_APPROVAL_REQUESTED', module: 'finance', recordType: 'payment_approval_request', recordId: id,
      newValue: { supplier_bill_id: billId, amount, risk_reasons: reasons, status: 'PENDING' }, ipAddress: req.ip, userAgent: req.get('user-agent')
    });
    return res.status(202).json({
      message: 'High-risk payment submitted for independent approval. The initiator cannot approve it.',
      code: 'DUAL_APPROVAL_REQUIRED', approval_request_id: id, status: 'PENDING', risk_reasons: reasons
    });
  } catch (error) {
    console.error('High-risk payment review failed:', error);
    return res.status(500).json({ message: 'Unable to assess payment risk.', code: 'PAYMENT_RISK_CHECK_FAILED' });
  }
};
