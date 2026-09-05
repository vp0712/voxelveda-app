const crypto = require('crypto');
const pool = require('../config/db');
const { logAudit } = require('../services/auditService');
const { decryptSensitive, encryptSensitive, KEY_VERSION, maskAccount } = require('../services/financeEncryptionService');
const { ensureHighRiskFinanceSchema } = require('../services/highRiskFinanceSchema');
const { hasPermission } = require('../services/authorizationService');

const SUBJECTS = new Set(['SUPPLIER', 'EMPLOYEE']);

function audit(req, values) {
  return { actorId: req.user?.id, ipAddress: req.ip, userAgent: req.get('user-agent'), ...values };
}

function fail(res, error, fallback) {
  if (error?.statusCode) return res.status(error.statusCode).json({ message: error.message, code: error.code });
  console.error(`${fallback}:`, error);
  return res.status(500).json({ message: fallback, code: 'HIGH_RISK_FINANCE_ERROR' });
}

function controlledError(message, statusCode = 400, code = 'INVALID_REQUEST') {
  return Object.assign(new Error(message), { statusCode, code });
}

function subjectFromRequest(req) {
  const subjectType = String(req.params.subjectType || '').trim().toUpperCase();
  const subjectId = Number(req.params.subjectId || 0);
  if (!SUBJECTS.has(subjectType) || !subjectId) throw controlledError('A valid supplier or employee is required.');
  return { subjectType, subjectId };
}

async function assertSubject(db, subjectType, subjectId, lock = false) {
  const table = subjectType === 'SUPPLIER' ? 'suppliers' : 'users';
  const deleted = subjectType === 'SUPPLIER' ? 'deleted = 0' : 'active = 1 AND deleted_at IS NULL';
  const [[row]] = await db.query(`SELECT id FROM ${table} WHERE id = ? AND ${deleted} LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [subjectId]);
  if (!row) throw controlledError(`${subjectType === 'SUPPLIER' ? 'Supplier' : 'Employee'} not found.`, 404, 'BANK_DETAIL_SUBJECT_NOT_FOUND');
}

function validateBankInput(body) {
  const accountName = String(body.account_name || '').trim();
  const bankName = String(body.bank_name || '').trim();
  const bsb = String(body.bsb || '').replace(/\D/g, '');
  const accountNumber = String(body.account_number || '').replace(/\s/g, '');
  const reason = String(body.reason || '').trim();
  if (accountName.length < 2 || accountName.length > 160) throw controlledError('Enter the bank account name.');
  if (bankName.length > 160) throw controlledError('Bank name is too long.');
  if (!/^\d{6}$/.test(bsb)) throw controlledError('Enter a valid six-digit Australian BSB.');
  if (!/^\d{4,12}$/.test(accountNumber)) throw controlledError('Enter a valid account number containing 4–12 digits.');
  if (reason.length < 5 || reason.length > 500) throw controlledError('Enter a clear reason for this bank-detail change.');
  return { accountName, bankName: bankName || null, bsb, accountNumber, reason };
}

exports.getBankDetailSummary = async (req, res) => {
  try {
    await ensureHighRiskFinanceSchema();
    const { subjectType, subjectId } = subjectFromRequest(req);
    await assertSubject(pool, subjectType, subjectId);
    const [[active]] = await pool.query(
      `SELECT id, bank_name, account_last_four, activated_at, activated_by
       FROM sensitive_bank_details WHERE subject_type = ? AND subject_id = ? AND status = 'ACTIVE'
       ORDER BY activated_at DESC, id DESC LIMIT 1`, [subjectType, subjectId]
    );
    const [[pending]] = await pool.query(
      `SELECT id, bank_name, account_last_four, reason, initiated_by, initiated_at, status
       FROM bank_detail_change_requests WHERE subject_type = ? AND subject_id = ? AND status = 'PENDING'
       ORDER BY initiated_at DESC LIMIT 1`, [subjectType, subjectId]
    );
    const recentDays = Math.max(1, Number(process.env.BANK_DETAIL_RECENT_DAYS || 7));
    const recentlyChanged = Boolean(active && Date.now() - new Date(active.activated_at).getTime() <= recentDays * 86400000);
    return res.json({
      bank_detail: active ? { ...active, account_number_masked: maskAccount(active.account_last_four), recently_changed: recentlyChanged } : null,
      pending_change: pending ? { ...pending, account_number_masked: maskAccount(pending.account_last_four) } : null,
      reveal_requires_step_up: true
    });
  } catch (error) { return fail(res, error, 'Unable to load bank-detail status.'); }
};

exports.requestBankDetailChange = async (req, res) => {
  let db;
  try {
    await ensureHighRiskFinanceSchema();
    const { subjectType, subjectId } = subjectFromRequest(req);
    const input = validateBankInput(req.body);
    db = await pool.getConnection();
    await db.beginTransaction();
    await assertSubject(db, subjectType, subjectId, true);
    const [[pending]] = await db.query(
      `SELECT id FROM bank_detail_change_requests WHERE subject_type = ? AND subject_id = ? AND status = 'PENDING' LIMIT 1`,
      [subjectType, subjectId]
    );
    if (pending) throw controlledError('A bank-detail change is already awaiting independent approval.', 409, 'BANK_CHANGE_ALREADY_PENDING');
    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO bank_detail_change_requests
       (id, subject_type, subject_id, bank_name, account_name_ciphertext, bsb_ciphertext,
        account_number_ciphertext, account_last_four, key_version, reason, initiated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, subjectType, subjectId, input.bankName, encryptSensitive(input.accountName), encryptSensitive(input.bsb),
        encryptSensitive(input.accountNumber), input.accountNumber.slice(-4), KEY_VERSION, input.reason, req.user.id]
    );
    await logAudit(db, audit(req, {
      action: 'BANK_DETAILS_CHANGE_REQUESTED', module: subjectType === 'SUPPLIER' ? 'finance' : 'payroll',
      recordType: 'bank_detail_change_request', recordId: id,
      newValue: { subject_type: subjectType, subject_id: subjectId, bank_name: input.bankName, account_number_masked: maskAccount(input.accountNumber.slice(-4)), reason: input.reason, status: 'PENDING' }
    }));
    await db.commit();
    return res.status(202).json({ message: 'Bank-detail change submitted for independent approval.', request_id: id, status: 'PENDING' });
  } catch (error) {
    if (db) await db.rollback();
    return fail(res, error, 'Unable to submit bank-detail change.');
  } finally { if (db) db.release(); }
};

exports.revealBankDetails = async (req, res) => {
  try {
    await ensureHighRiskFinanceSchema();
    const { subjectType, subjectId } = subjectFromRequest(req);
    const [[row]] = await pool.query(
      `SELECT * FROM sensitive_bank_details WHERE subject_type = ? AND subject_id = ? AND status = 'ACTIVE'
       ORDER BY activated_at DESC, id DESC LIMIT 1`, [subjectType, subjectId]
    );
    if (!row) throw controlledError('No active bank details are recorded.', 404, 'BANK_DETAILS_NOT_FOUND');
    await logAudit(pool, audit(req, {
      action: subjectType === 'EMPLOYEE' ? 'PAYROLL_BANK_DETAILS_VIEWED' : 'BANK_DETAILS_VIEWED',
      module: subjectType === 'EMPLOYEE' ? 'payroll' : 'finance', recordType: 'sensitive_bank_detail', recordId: row.id,
      newValue: { subject_type: subjectType, subject_id: subjectId, account_number_masked: maskAccount(row.account_last_four) }
    }));
    return res.json({
      bank_detail: {
        bank_name: row.bank_name,
        account_name: decryptSensitive(row.account_name_ciphertext),
        bsb: decryptSensitive(row.bsb_ciphertext),
        account_number: decryptSensitive(row.account_number_ciphertext),
        activated_at: row.activated_at
      },
      warning: 'Restricted banking information. Do not copy or share unless required for an authorised business purpose.'
    });
  } catch (error) { return fail(res, error, 'Unable to reveal bank details.'); }
};

exports.listApprovalQueue = async (req, res) => {
  try {
    await ensureHighRiskFinanceSchema();
    const status = String(req.query.status || 'PENDING').toUpperCase();
    if (!['PENDING', 'APPROVED', 'REJECTED', 'EXECUTED'].includes(status)) throw controlledError('Invalid approval status.');
    const bankTypes = [];
    if (hasPermission(req.user, 'APPROVE_PAYMENT')) bankTypes.push('SUPPLIER');
    if (hasPermission(req.user, 'APPROVE_PAYROLL_BANK_CHANGE')) bankTypes.push('EMPLOYEE');
    const placeholders = bankTypes.map(() => '?').join(',');
    const [bankChanges] = bankTypes.length ? await pool.query(
      `SELECT r.id, r.subject_type, r.subject_id, r.bank_name, r.account_last_four, r.reason, r.status,
        r.initiated_by, r.initiated_at, u.name AS initiated_by_name,
        CASE WHEN r.subject_type = 'SUPPLIER'
          THEN (SELECT s.supplier_name FROM suppliers s WHERE s.id = r.subject_id LIMIT 1)
          ELSE (SELECT employee.name FROM users employee WHERE employee.id = r.subject_id LIMIT 1)
        END AS subject_label
       FROM bank_detail_change_requests r LEFT JOIN users u ON u.id = r.initiated_by
       WHERE r.status = ? AND r.subject_type IN (${placeholders}) ORDER BY r.initiated_at ASC`, [status, ...bankTypes]
    ) : [[]];
    const canApprovePayments = hasPermission(req.user, 'APPROVE_PAYMENT');
    const canInitiatePayments = hasPermission(req.user, 'POST_TRANSACTION');
    const [payments] = (canApprovePayments || canInitiatePayments) ? await pool.query(
      `SELECT r.id, r.supplier_bill_id, r.payment_date, r.amount, r.reference, r.risk_reasons, r.status,
        r.initiated_by, r.initiated_at, u.name AS initiated_by_name, s.supplier_name, b.bill_uid, b.supplier_invoice_no
       FROM payment_approval_requests r
       JOIN supplier_bills b ON b.id = r.supplier_bill_id JOIN suppliers s ON s.id = b.supplier_id
       LEFT JOIN users u ON u.id = r.initiated_by WHERE r.status = ? AND (? = 1 OR r.initiated_by = ?) ORDER BY r.initiated_at ASC`,
      [status, canApprovePayments ? 1 : 0, req.user.id]
    ) : [[]];
    return res.json({
      bank_changes: bankChanges.map((row) => ({ ...row, account_number_masked: maskAccount(row.account_last_four), account_last_four: undefined })),
      payments
    });
  } catch (error) { return fail(res, error, 'Unable to load high-risk approval queue.'); }
};

exports.reviewBankDetailChange = async (req, res) => {
  let db;
  try {
    await ensureHighRiskFinanceSchema();
    const decision = String(req.body.decision || '').toUpperCase();
    const rejectionReason = String(req.body.reason || '').trim();
    if (!['APPROVE', 'REJECT'].includes(decision)) throw controlledError('Choose approve or reject.');
    if (decision === 'REJECT' && rejectionReason.length < 5) throw controlledError('Enter a reason for rejection.');
    db = await pool.getConnection();
    await db.beginTransaction();
    const [[request]] = await db.query(`SELECT * FROM bank_detail_change_requests WHERE id = ? FOR UPDATE`, [req.params.id]);
    if (!request) throw controlledError('Bank-detail request not found.', 404, 'BANK_CHANGE_NOT_FOUND');
    const approvalPermission = request.subject_type === 'EMPLOYEE' ? 'APPROVE_PAYROLL_BANK_CHANGE' : 'APPROVE_PAYMENT';
    if (!hasPermission(req.user, approvalPermission)) throw controlledError('You do not have authority to approve this bank-detail change.', 403, 'PERMISSION_DENIED');
    if (request.status !== 'PENDING') throw controlledError('This bank-detail request has already been reviewed.', 409, 'BANK_CHANGE_ALREADY_REVIEWED');
    if (Number(request.initiated_by) === Number(req.user.id)) throw controlledError('The initiator cannot approve or reject their own bank-detail change.', 403, 'SELF_APPROVAL_FORBIDDEN');
    if (decision === 'REJECT') {
      await db.query(`UPDATE bank_detail_change_requests SET status = 'REJECTED', rejected_by = ?, rejected_at = NOW(), rejection_reason = ? WHERE id = ?`, [req.user.id, rejectionReason, request.id]);
    } else {
      await db.query(`UPDATE sensitive_bank_details SET status = 'SUPERSEDED', superseded_at = NOW() WHERE subject_type = ? AND subject_id = ? AND status = 'ACTIVE'`, [request.subject_type, request.subject_id]);
      await db.query(
        `INSERT INTO sensitive_bank_details
         (subject_type, subject_id, bank_name, account_name_ciphertext, bsb_ciphertext, account_number_ciphertext,
          account_last_four, key_version, activated_from_request_id, activated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [request.subject_type, request.subject_id, request.bank_name, request.account_name_ciphertext, request.bsb_ciphertext,
          request.account_number_ciphertext, request.account_last_four, request.key_version, request.id, req.user.id]
      );
      await db.query(`UPDATE bank_detail_change_requests SET status = 'APPROVED', approved_by = ?, approved_at = NOW() WHERE id = ?`, [req.user.id, request.id]);
    }
    await logAudit(db, audit(req, {
      action: decision === 'APPROVE' ? 'BANK_DETAILS_CHANGED' : 'BANK_DETAILS_CHANGE_REJECTED',
      module: request.subject_type === 'EMPLOYEE' ? 'payroll' : 'finance', recordType: 'bank_detail_change_request', recordId: request.id,
      oldValue: { status: 'PENDING' }, newValue: { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', subject_type: request.subject_type, subject_id: request.subject_id, account_number_masked: maskAccount(request.account_last_four), reason: rejectionReason || request.reason }
    }));
    await db.commit();
    return res.json({ message: decision === 'APPROVE' ? 'Bank details approved and activated.' : 'Bank-detail change rejected.', status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED' });
  } catch (error) {
    if (db) await db.rollback();
    return fail(res, error, 'Unable to review bank-detail change.');
  } finally { if (db) db.release(); }
};

exports.reviewPaymentApproval = async (req, res) => {
  let db;
  try {
    await ensureHighRiskFinanceSchema();
    const decision = String(req.body.decision || '').toUpperCase();
    const reason = String(req.body.reason || '').trim();
    if (!['APPROVE', 'REJECT'].includes(decision)) throw controlledError('Choose approve or reject.');
    if (decision === 'REJECT' && reason.length < 5) throw controlledError('Enter a reason for rejection.');
    db = await pool.getConnection();
    await db.beginTransaction();
    const [[request]] = await db.query(`SELECT * FROM payment_approval_requests WHERE id = ? FOR UPDATE`, [req.params.id]);
    if (!request) throw controlledError('Payment approval request not found.', 404, 'PAYMENT_APPROVAL_NOT_FOUND');
    if (request.status !== 'PENDING') throw controlledError('This payment request has already been reviewed.', 409, 'PAYMENT_ALREADY_REVIEWED');
    if (Number(request.initiated_by) === Number(req.user.id)) throw controlledError('The payment initiator cannot approve their own request.', 403, 'SELF_APPROVAL_FORBIDDEN');
    if (decision === 'APPROVE') {
      await db.query(`UPDATE payment_approval_requests SET status = 'APPROVED', approved_by = ?, approved_at = NOW() WHERE id = ? AND status = 'PENDING'`, [req.user.id, request.id]);
    } else {
      await db.query(`UPDATE payment_approval_requests SET status = 'REJECTED', rejected_by = ?, rejected_at = NOW(), rejection_reason = ? WHERE id = ? AND status = 'PENDING'`, [req.user.id, reason, request.id]);
    }
    await logAudit(db, audit(req, {
      action: decision === 'APPROVE' ? 'PAYMENT_APPROVED' : 'PAYMENT_REJECTED', module: 'finance', recordType: 'payment_approval_request', recordId: request.id,
      oldValue: { status: 'PENDING' }, newValue: { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', amount: request.amount, supplier_bill_id: request.supplier_bill_id, reason: reason || null }
    }));
    await db.commit();
    return res.json({ message: decision === 'APPROVE' ? 'Payment approved. The initiator can now execute it.' : 'Payment request rejected.', status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED' });
  } catch (error) {
    if (db) await db.rollback();
    return fail(res, error, 'Unable to review payment request.');
  } finally { if (db) db.release(); }
};

exports.prepareApprovedPayment = async (req, res, next) => {
  try {
    await ensureHighRiskFinanceSchema();
    const [[request]] = await pool.query(`SELECT * FROM payment_approval_requests WHERE id = ?`, [req.params.id]);
    if (!request) throw controlledError('Payment approval request not found.', 404, 'PAYMENT_APPROVAL_NOT_FOUND');
    if (request.status !== 'APPROVED') throw controlledError('This payment is not approved for execution.', 409, 'PAYMENT_NOT_APPROVED');
    if (Number(request.initiated_by) !== Number(req.user.id)) throw controlledError('Only the original initiator can execute this approved payment.', 403, 'PAYMENT_EXECUTOR_MISMATCH');
    if (!request.approved_by || Number(request.approved_by) === Number(request.initiated_by)) throw controlledError('Independent approval is required.', 409, 'DUAL_APPROVAL_REQUIRED');
    req.params.id = String(request.supplier_bill_id);
    req.body = {
      payment_date: request.payment_date,
      amount: request.amount,
      bank_account_id: request.bank_account_id,
      payment_method: request.payment_method,
      reference: request.reference,
      notes: request.notes
    };
    req.paymentApprovalId = request.id;
    return next();
  } catch (error) { return fail(res, error, 'Unable to prepare approved payment.'); }
};

module.exports.controlledError = controlledError;
