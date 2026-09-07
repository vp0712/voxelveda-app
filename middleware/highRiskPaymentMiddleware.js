const crypto = require('crypto');
const pool = require('../config/db');
const money = require('../utils/money');
const { ensureHighRiskFinanceSchema } = require('../services/highRiskFinanceSchema');
const { logAudit } = require('../services/auditService');
const { approvalTtlHours, assessSupplierPayment } = require('../services/paymentRiskService');

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
    const risk = await assessSupplierPayment({ billId, amount, actorId: req.user.id, connection: pool });
    if (!risk) return res.status(404).json({ message: 'Supplier bill not found.', code: 'BILL_NOT_FOUND' });
    if (!risk.requireApproval) return next();

    const [[existing]] = await pool.query(
      `SELECT id FROM payment_approval_requests
       WHERE supplier_bill_id = ? AND initiated_by = ? AND amount = ? AND status = 'PENDING'
       ORDER BY initiated_at DESC LIMIT 1`, [billId, req.user.id, amount]
    );
    if (existing) {
      return res.status(202).json({
        message: 'This high-risk payment is already awaiting independent approval.',
        code: 'DUAL_APPROVAL_REQUIRED', approval_request_id: existing.id, status: 'PENDING', risk_reasons: risk.reasons,
        risk_score: risk.score, risk_level: risk.level
      });
    }

    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO payment_approval_requests
       (id, supplier_bill_id, payment_date, amount, bank_account_id, payment_method, reference, notes,
        risk_reasons, risk_score, risk_level, risk_snapshot, bank_detail_id, initiated_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))`,
      [id, billId, req.body.payment_date, amount, Number(req.body.bank_account_id || 0) || null,
        String(req.body.payment_method || 'Bank').slice(0, 60), String(req.body.reference || '').slice(0, 180) || null,
        String(req.body.notes || '').slice(0, 2000) || null, JSON.stringify(risk.reasons), risk.score, risk.level,
        JSON.stringify(risk.snapshot), risk.bankDetailId, req.user.id, approvalTtlHours()]
    );
    await logAudit(pool, {
      actorId: req.user.id, action: 'PAYMENT_APPROVAL_REQUESTED', module: 'finance', recordType: 'payment_approval_request', recordId: id,
      newValue: { supplier_bill_id: billId, amount, risk_reasons: risk.reasons, risk_score: risk.score, risk_level: risk.level, status: 'PENDING' }, ipAddress: req.ip, userAgent: req.get('user-agent')
    });
    return res.status(202).json({
      message: 'High-risk payment submitted for independent approval. The initiator cannot approve it.',
      code: 'DUAL_APPROVAL_REQUIRED', approval_request_id: id, status: 'PENDING', risk_reasons: risk.reasons,
      risk_score: risk.score, risk_level: risk.level, expires_in_hours: approvalTtlHours()
    });
  } catch (error) {
    console.error('High-risk payment review failed:', error);
    return res.status(500).json({ message: 'Unable to assess payment risk.', code: 'PAYMENT_RISK_CHECK_FAILED' });
  }
};
