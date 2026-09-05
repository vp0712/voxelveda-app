const crypto = require('crypto');
const pool = require('../config/db');
const { ensureFinanceSchema } = require('../services/financeSchema');
const { logAudit } = require('../services/auditService');
const money = require('../utils/money');
const { FinanceError, dateOnly, basQuarterForDate } = require('../services/financeDomain');

const BILL_STATUSES = new Set(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID']);
const PERIOD_STATUSES = new Set(['OPEN', 'REVIEWING', 'READY', 'LOCKED']);

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function audit(req, values) {
  return {
    actorId: req.user?.id,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
    ...values
  };
}

function fail(res, error, message) {
  if (error instanceof FinanceError) {
    return res.status(error.statusCode).json({ message: error.message, code: error.code, issues: error.issues });
  }
  if (error?.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ message: 'A matching finance record already exists.', code: 'DUPLICATE_RECORD' });
  }
  console.error(`${message}:`, error);
  return res.status(500).json({ message, error: error.message });
}

function dateOnlyText(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

function normalizeDateFields(row, fields) {
  if (!row) return row;
  fields.forEach((field) => {
    if (row[field] !== null && row[field] !== undefined) row[field] = dateOnlyText(row[field]);
  });
  return row;
}

async function yearAndPeriod(effectiveDate, db = pool) {
  const value = dateOnly(effectiveDate);
  if (!value) throw new FinanceError('A valid effective date is required.', 400, 'DATE_REQUIRED');
  const [[row]] = await db.query(
    `SELECT ap.*, fy.label AS financial_year_label, fy.status AS financial_year_status
     FROM accounting_periods ap
     JOIN financial_years fy ON fy.id = ap.financial_year_id
     WHERE ? BETWEEN ap.start_date AND ap.end_date LIMIT 1`,
    [value]
  );
  if (!row) throw new FinanceError('No accounting period is configured for this date.', 409, 'PERIOD_NOT_CONFIGURED');
  if (row.status === 'LOCKED' || ['LOCKED', 'ARCHIVED'].includes(row.financial_year_status)) {
    throw new FinanceError('This accounting period is locked. Use a controlled adjustment or ask Finance Admin to unlock it.', 423, 'PERIOD_LOCKED');
  }
  return row;
}

async function accountByCode(code, db) {
  const [[row]] = await db.query(`SELECT id FROM chart_of_accounts WHERE account_code = ? AND active = 1`, [code]);
  if (!row) throw new FinanceError(`Required ledger account ${code} is not configured.`, 409, 'ACCOUNT_NOT_CONFIGURED');
  return row.id;
}

async function taxByCode(code, db = pool) {
  const [[row]] = await db.query(`SELECT * FROM tax_codes WHERE code = ? AND active = 1`, [String(code || '').toUpperCase()]);
  if (!row) throw new FinanceError('Select a valid GST treatment.', 400, 'TAX_CODE_REQUIRED');
  return row;
}

function pageValues(req, defaultLimit = 25, max = 200) {
  const limit = Math.min(max, Math.max(1, Number(req.query.limit || defaultLimit)));
  const page = Math.max(1, Number(req.query.page || 1));
  return { page, limit, offset: (page - 1) * limit };
}

function calculateBillLines(inputLines, taxCode) {
  if (!Array.isArray(inputLines) || !inputLines.length) {
    throw new FinanceError('Add at least one supplier bill line.', 400, 'BILL_LINES_REQUIRED');
  }
  let billNet = 0n;
  let billGst = 0n;
  let billTotal = 0n;
  const lines = inputLines.map((line, index) => {
    const description = String(line.description || '').trim();
    if (!description) throw new FinanceError(`Description is required on line ${index + 1}.`, 400, 'LINE_DESCRIPTION_REQUIRED');
    let total;
    try {
      total = money.multiplyQuantity(line.unit_price, line.quantity);
    } catch {
      throw new FinanceError(`Enter a valid quantity and unit price on line ${index + 1}.`, 400, 'INVALID_BILL_LINE_AMOUNT');
    }
    const gst = Number(taxCode.gst_reportable) && Number(taxCode.rate) > 0
      ? money.gstFromGross(total, taxCode.rate)
      : '0.00';
    const net = money.subtract(total, gst);
    billNet += money.toCents(net);
    billGst += money.toCents(gst);
    billTotal += money.toCents(total);
    return {
      line_no: index + 1,
      description,
      quantity: String(line.quantity),
      unit_price: money.fromCents(money.toCents(line.unit_price)),
      net_amount: net,
      gst_amount: gst,
      total_amount: total,
      account_id: Number(line.account_id || 0) || null,
      tax_code_id: Number(line.tax_code_id || taxCode.id)
    };
  });
  return {
    lines,
    net: money.fromCents(billNet),
    gst: money.fromCents(billGst),
    total: money.fromCents(billTotal)
  };
}

exports.getSupplierBills = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const { page, limit, offset } = pageValues(req);
    const clauses = ['1 = 1'];
    const params = [];
    if (req.query.status) { clauses.push('sb.status = ?'); params.push(String(req.query.status).toUpperCase()); }
    if (req.query.financial_year_id) {
      clauses.push('sb.issue_date BETWEEN fy.start_date AND fy.end_date');
      clauses.push('fy.id = ?');
      params.push(Number(req.query.financial_year_id));
    }
    if (req.query.search) {
      clauses.push('(sb.bill_uid LIKE ? OR sb.supplier_invoice_no LIKE ? OR s.supplier_name LIKE ?)');
      const value = `%${String(req.query.search).trim()}%`;
      params.push(value, value, value);
    }
    const fromSql = `FROM supplier_bills sb
      JOIN suppliers s ON s.id = sb.supplier_id
      LEFT JOIN financial_years fy ON sb.issue_date BETWEEN fy.start_date AND fy.end_date
      WHERE ${clauses.join(' AND ')}`;
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total ${fromSql}`, params);
    const [rows] = await pool.query(
      `SELECT sb.*, s.supplier_name, fy.label AS financial_year_label,
       (sb.total_amount - sb.paid_amount) AS balance,
       (SELECT COUNT(*) FROM supplier_bill_items bi WHERE bi.supplier_bill_id = sb.id) AS item_count,
       (SELECT COUNT(*) FROM finance_documents fd WHERE fd.module = 'supplier_bill' AND CAST(fd.record_id AS UNSIGNED) = sb.id AND fd.deleted_at IS NULL) AS document_count
       ${fromSql} ORDER BY sb.issue_date ASC, sb.id ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({
      bills: rows.map((row) => normalizeDateFields(row, ['issue_date', 'due_date'])),
      page,
      limit,
      total: Number(count.total || 0)
    });
  } catch (error) {
    return fail(res, error, 'Failed to load supplier bills');
  }
};

exports.getSupplierBill = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const [[bill]] = await pool.query(
      `SELECT sb.*, s.supplier_name, tc.code AS tax_code,
       (sb.total_amount - sb.paid_amount) AS balance
       FROM supplier_bills sb
       JOIN suppliers s ON s.id = sb.supplier_id
       LEFT JOIN tax_codes tc ON tc.id = sb.tax_code_id
       WHERE sb.id = ?`, [req.params.id]
    );
    if (!bill) throw new FinanceError('Supplier bill not found.', 404, 'BILL_NOT_FOUND');
    const [items] = await pool.query(`SELECT * FROM supplier_bill_items WHERE supplier_bill_id = ? ORDER BY line_no`, [bill.id]);
    const [payments] = await pool.query(
      `SELECT p.*, ba.nickname AS bank_account_name FROM supplier_bill_payments p
       LEFT JOIN bank_accounts ba ON ba.id = p.bank_account_id
       WHERE p.supplier_bill_id = ? AND p.voided_at IS NULL ORDER BY p.payment_date, p.id`, [bill.id]
    );
    res.json({
      bill: normalizeDateFields(bill, ['issue_date', 'due_date']),
      items,
      payments: payments.map((row) => normalizeDateFields(row, ['payment_date']))
    });
  } catch (error) {
    return fail(res, error, 'Failed to load supplier bill');
  }
};

exports.saveSupplierBill = async (req, res) => {
  let db;
  try {
    await ensureFinanceSchema();
    const id = Number(req.body.id || 0);
    const supplierId = Number(req.body.supplier_id || 0);
    const invoiceNo = String(req.body.supplier_invoice_no || '').trim();
    const issueDate = dateOnly(req.body.issue_date);
    const dueDate = req.body.due_date ? dateOnly(req.body.due_date) : null;
    const targetStatus = String(req.body.status || 'DRAFT').toUpperCase();
    if (!supplierId) throw new FinanceError('Supplier is required.', 400, 'SUPPLIER_REQUIRED');
    if (!invoiceNo) throw new FinanceError('Supplier invoice number is required.', 400, 'SUPPLIER_INVOICE_REQUIRED');
    if (!issueDate) throw new FinanceError('A valid issue date is required.', 400, 'DATE_REQUIRED');
    if (req.body.due_date && !dueDate) throw new FinanceError('Enter a valid due date.', 400, 'DUE_DATE_INVALID');
    if (dueDate && dueDate < issueDate) throw new FinanceError('Due date cannot be before the issue date.', 400, 'DUE_DATE_INVALID');
    if (!['DRAFT', 'PENDING_APPROVAL'].includes(targetStatus)) throw new FinanceError('Bills can be saved as draft or submitted for approval.');

    db = await pool.getConnection();
    await db.beginTransaction();
    await yearAndPeriod(issueDate, db);
    const [[supplier]] = await db.query(`SELECT id, supplier_name FROM suppliers WHERE id = ? AND deleted = 0 FOR UPDATE`, [supplierId]);
    if (!supplier) throw new FinanceError('Supplier is not active.', 404, 'SUPPLIER_NOT_FOUND');
    const tax = await taxByCode(req.body.tax_code, db);
    const calculated = calculateBillLines(req.body.items, tax);
    const [[duplicate]] = await db.query(
      `SELECT id, bill_uid FROM supplier_bills WHERE supplier_id = ? AND supplier_invoice_no = ? AND id <> ? AND status <> 'VOID' LIMIT 1`,
      [supplierId, invoiceNo, id]
    );
    if (duplicate) throw new FinanceError(`Supplier invoice ${invoiceNo} is already recorded as ${duplicate.bill_uid}.`, 409, 'DUPLICATE_SUPPLIER_INVOICE');

    let billId = id;
    let oldValue = null;
    if (id) {
      const [[existing]] = await db.query(`SELECT * FROM supplier_bills WHERE id = ? FOR UPDATE`, [id]);
      if (!existing) throw new FinanceError('Supplier bill not found.', 404, 'BILL_NOT_FOUND');
      if (!['DRAFT', 'PENDING_APPROVAL'].includes(existing.status)) {
        throw new FinanceError('Approved, paid or void supplier bills cannot be edited directly.', 409, 'BILL_IMMUTABLE');
      }
      oldValue = existing;
      await db.query(
        `UPDATE supplier_bills SET supplier_id = ?, supplier_invoice_no = ?, issue_date = ?, due_date = ?, job_reference = ?,
         tax_code_id = ?, net_amount = ?, gst_amount = ?, total_amount = ?, status = ? WHERE id = ?`,
        [supplierId, invoiceNo, issueDate, dueDate, req.body.job_reference || null, tax.id,
          calculated.net, calculated.gst, calculated.total, targetStatus, id]
      );
      await db.query(`DELETE FROM supplier_bill_items WHERE supplier_bill_id = ?`, [id]);
    } else {
      const billUid = uid('BILL');
      const [result] = await db.query(
        `INSERT INTO supplier_bills
         (bill_uid, supplier_id, supplier_invoice_no, issue_date, due_date, job_reference, tax_code_id,
          net_amount, gst_amount, total_amount, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [billUid, supplierId, invoiceNo, issueDate, dueDate, req.body.job_reference || null, tax.id,
          calculated.net, calculated.gst, calculated.total, targetStatus, req.user.id]
      );
      billId = result.insertId;
    }
    for (const line of calculated.lines) {
      await db.query(
        `INSERT INTO supplier_bill_items
         (supplier_bill_id, line_no, description, quantity, unit_price, net_amount, gst_amount, total_amount, account_id, tax_code_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [billId, line.line_no, line.description, line.quantity, line.unit_price, line.net_amount,
          line.gst_amount, line.total_amount, line.account_id, line.tax_code_id]
      );
    }
    await logAudit(db, audit(req, {
      action: id ? 'EDITED' : 'CREATED', module: 'finance', recordType: 'supplier_bill', recordId: billId,
      oldValue, newValue: { supplier_id: supplierId, supplier_name: supplier.supplier_name, supplier_invoice_no: invoiceNo, issue_date: issueDate, totals: calculated, status: targetStatus }
    }));
    await db.commit();
    res.json({ message: targetStatus === 'PENDING_APPROVAL' ? 'Supplier bill submitted for approval.' : 'Supplier bill draft saved.', bill_id: billId, totals: calculated });
  } catch (error) {
    if (db) await db.rollback();
    return fail(res, error, 'Failed to save supplier bill');
  } finally {
    if (db) db.release();
  }
};

exports.updateSupplierBillStatus = async (req, res) => {
  let db;
  try {
    await ensureFinanceSchema();
    const nextStatus = String(req.body.status || '').toUpperCase();
    const reason = String(req.body.reason || '').trim();
    if (!['PENDING_APPROVAL', 'APPROVED', 'VOID'].includes(nextStatus)) throw new FinanceError('Invalid supplier bill action.');
    db = await pool.getConnection();
    await db.beginTransaction();
    const [[bill]] = await db.query(`SELECT * FROM supplier_bills WHERE id = ? FOR UPDATE`, [req.params.id]);
    if (!bill) throw new FinanceError('Supplier bill not found.', 404, 'BILL_NOT_FOUND');
    await yearAndPeriod(bill.issue_date, db);
    if (nextStatus === 'APPROVED' && bill.status !== 'PENDING_APPROVAL') {
      throw new FinanceError('Only a bill awaiting approval can be approved.', 409, 'BILL_NOT_READY');
    }
    if (nextStatus === 'VOID' && !reason) throw new FinanceError('A void reason is required.', 400, 'REASON_REQUIRED');
    if (bill.status === 'PAID' && nextStatus === 'VOID') throw new FinanceError('Void the payment through a controlled reversal before voiding this bill.', 409, 'PAID_BILL');
    await db.query(
      `UPDATE supplier_bills SET status = ?, approval_note = ?, approved_by = ?, approved_at = ?, voided_by = ?, voided_at = ?, void_reason = ? WHERE id = ?`,
      [nextStatus, nextStatus === 'APPROVED' ? reason || null : bill.approval_note,
        nextStatus === 'APPROVED' ? req.user.id : bill.approved_by, nextStatus === 'APPROVED' ? new Date() : bill.approved_at,
        nextStatus === 'VOID' ? req.user.id : null, nextStatus === 'VOID' ? new Date() : null, nextStatus === 'VOID' ? reason : null, bill.id]
    );
    await logAudit(db, audit(req, { action: nextStatus, module: 'finance', recordType: 'supplier_bill', recordId: bill.id, oldValue: bill, newValue: { status: nextStatus, reason } }));
    await db.commit();
    res.json({ message: `Supplier bill changed to ${nextStatus.replaceAll('_', ' ')}.` });
  } catch (error) {
    if (db) await db.rollback();
    return fail(res, error, 'Failed to update supplier bill');
  } finally {
    if (db) db.release();
  }
};

exports.recordSupplierPayment = async (req, res) => {
  let db;
  try {
    await ensureFinanceSchema();
    const paymentDate = dateOnly(req.body.payment_date);
    const amount = money.fromCents(money.toCents(req.body.amount));
    const amountCents = money.toCents(amount);
    if (!paymentDate) throw new FinanceError('Payment date is required.', 400, 'DATE_REQUIRED');
    if (amountCents <= 0n) throw new FinanceError('Payment amount must be greater than zero.', 400, 'AMOUNT_REQUIRED');
    db = await pool.getConnection();
    await db.beginTransaction();
    if (req.paymentApprovalId) {
      const [[approval]] = await db.query(`SELECT * FROM payment_approval_requests WHERE id = ? FOR UPDATE`, [req.paymentApprovalId]);
      if (!approval || approval.status !== 'APPROVED') throw new FinanceError('This payment approval is no longer valid.', 409, 'PAYMENT_NOT_APPROVED');
      if (Number(approval.initiated_by) !== Number(req.user.id) || !approval.approved_by || Number(approval.approved_by) === Number(approval.initiated_by)) {
        throw new FinanceError('Independent approval is required before payment execution.', 403, 'DUAL_APPROVAL_REQUIRED');
      }
    }
    const period = await yearAndPeriod(paymentDate, db);
    const [[bill]] = await db.query(
      `SELECT sb.*, s.supplier_name FROM supplier_bills sb JOIN suppliers s ON s.id = sb.supplier_id WHERE sb.id = ? FOR UPDATE`,
      [req.params.id]
    );
    if (!bill) throw new FinanceError('Supplier bill not found.', 404, 'BILL_NOT_FOUND');
    if (!['APPROVED', 'PARTIALLY_PAID', 'OVERDUE'].includes(bill.status)) throw new FinanceError('Only approved supplier bills can be paid.', 409, 'BILL_NOT_APPROVED');
    const balance = money.toCents(bill.total_amount) - money.toCents(bill.paid_amount);
    if (balance <= 0n) throw new FinanceError('This supplier bill is already fully paid.', 409, 'BILL_ALREADY_PAID');
    if (amountCents > balance) throw new FinanceError(`Payment exceeds the outstanding balance of $${money.fromCents(balance)}.`, 409, 'PAYMENT_EXCEEDS_BALANCE');
    const bankAccountId = Number(req.body.bank_account_id || 0) || null;
    if (bankAccountId) {
      const [[bank]] = await db.query(`SELECT id FROM bank_accounts WHERE id = ? AND status = 'ACTIVE'`, [bankAccountId]);
      if (!bank) throw new FinanceError('Payment bank account is not active.', 400, 'BANK_ACCOUNT_REQUIRED');
    }
    const paymentUid = uid('SPAY');
    const [result] = await db.query(
      `INSERT INTO supplier_bill_payments
       (payment_uid, supplier_bill_id, payment_date, amount, bank_account_id, reference, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [paymentUid, bill.id, paymentDate, amount, bankAccountId, req.body.reference || null, req.body.notes || null, req.user.id]
    );
    const newPaidCents = money.toCents(bill.paid_amount) + amountCents;
    const nextStatus = newPaidCents === money.toCents(bill.total_amount) ? 'PAID' : 'PARTIALLY_PAID';
    await db.query(`UPDATE supplier_bills SET paid_amount = ?, status = ? WHERE id = ?`, [money.fromCents(newPaidCents), nextStatus, bill.id]);

    const debitAccountId = await accountByCode('2000', db);
    const creditAccountId = await accountByCode('1000', db);
    const tax = await taxByCode('OUT_OF_SCOPE', db);
    const transactionUid = uid('FTX');
    const [transactionResult] = await db.query(
      `INSERT INTO finance_transactions
       (transaction_uid, reference, effective_date, transaction_type, description, party_name, supplier_id,
        debit_account_id, credit_account_id, net_amount, gst_amount, gross_amount, tax_code_id, payment_method,
        bank_account_id, source_module, source_record_id, invoice_bill_reference, status, financial_year_id,
        bas_quarter, posted_at, posted_by, created_by, updated_by)
       VALUES (?, ?, ?, 'SUPPLIER_PAYMENT', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'supplier_bill_payment', ?, ?, 'POSTED', ?, ?, NOW(), ?, ?, ?)`,
      [transactionUid, req.body.reference || paymentUid, paymentDate, `Payment of ${bill.bill_uid}`,
        bill.supplier_name, bill.supplier_id, debitAccountId, creditAccountId, amount, amount, tax.id,
        req.body.payment_method || 'Bank', bankAccountId, String(result.insertId), bill.supplier_invoice_no,
        period.financial_year_id, basQuarterForDate(paymentDate), req.user.id, req.user.id, req.user.id]
    );
    const journalUid = uid('JRN');
    const [journalResult] = await db.query(
      `INSERT INTO journal_entries
       (journal_uid, entry_date, reference, description, financial_year_id, source_transaction_id, status,
        total_debit, total_credit, posted_at, posted_by, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'POSTED', ?, ?, NOW(), ?, ?)`,
      [journalUid, paymentDate, req.body.reference || paymentUid, `Supplier payment ${bill.bill_uid}`,
        period.financial_year_id, transactionResult.insertId, amount, amount, req.user.id, req.user.id]
    );
    await db.query(
      `INSERT INTO journal_lines (journal_entry_id, line_no, account_id, description, debit, credit, supplier_id)
       VALUES (?, 1, ?, ?, ?, 0, ?), (?, 2, ?, ?, 0, ?, ?)`,
      [journalResult.insertId, debitAccountId, `Accounts payable ${bill.bill_uid}`, amount, bill.supplier_id,
        journalResult.insertId, creditAccountId, `Payment ${paymentUid}`, amount, bill.supplier_id]
    );
    await logAudit(db, audit(req, { action: 'PAYMENT_RECORDED', module: 'finance', recordType: 'supplier_bill', recordId: bill.id, oldValue: { paid_amount: bill.paid_amount, status: bill.status }, newValue: { payment_uid: paymentUid, amount, paid_amount: money.fromCents(newPaidCents), status: nextStatus } }));
    if (req.paymentApprovalId) {
      await db.query(`UPDATE payment_approval_requests SET status = 'EXECUTED', executed_at = NOW() WHERE id = ? AND status = 'APPROVED'`, [req.paymentApprovalId]);
      await logAudit(db, audit(req, { action: 'PAYMENT_EXECUTED', module: 'finance', recordType: 'payment_approval_request', recordId: req.paymentApprovalId, newValue: { payment_uid: paymentUid, supplier_bill_id: bill.id, amount } }));
    }
    await db.commit();
    res.json({ message: 'Supplier payment recorded and posted to the ledger.', payment_uid: paymentUid, status: nextStatus });
  } catch (error) {
    if (db) await db.rollback();
    return fail(res, error, 'Failed to record supplier payment');
  } finally {
    if (db) db.release();
  }
};

exports.getBankAccounts = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const [rows] = await pool.query(
      `SELECT ba.*,
       (SELECT COUNT(*) FROM bank_transactions bt WHERE bt.bank_account_id = ba.id AND bt.reconciliation_status = 'UNRECONCILED') AS unreconciled_count
       FROM bank_accounts ba ORDER BY ba.status = 'ACTIVE' DESC, ba.nickname`
    );
    res.json({ bank_accounts: rows });
  } catch (error) {
    return fail(res, error, 'Failed to load bank accounts');
  }
};

exports.saveBankAccount = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const nickname = String(req.body.nickname || '').trim();
    if (!nickname) throw new FinanceError('Account nickname is required.', 400, 'BANK_NICKNAME_REQUIRED');
    const opening = money.fromCents(money.toCents(req.body.opening_balance || 0));
    const currency = String(req.body.currency || 'AUD').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new FinanceError('Enter a valid three-letter currency code.');
    const id = Number(req.body.id || 0);
    let result;
    if (id) {
      const [[existing]] = await pool.query(`SELECT * FROM bank_accounts WHERE id = ?`, [id]);
      if (!existing) throw new FinanceError('Bank account not found.', 404);
      await pool.query(
        `UPDATE bank_accounts SET nickname = ?, institution = ?, bsb_masked = ?, account_number_masked = ?, currency = ?, status = ? WHERE id = ?`,
        [nickname, req.body.institution || null, req.body.bsb_masked || null, req.body.account_number_masked || null, currency, req.body.status || 'ACTIVE', id]
      );
      result = id;
      await logAudit(pool, audit(req, { action: 'EDITED', module: 'finance', recordType: 'bank_account', recordId: id, oldValue: existing, newValue: req.body }));
    } else {
      const [insert] = await pool.query(
        `INSERT INTO bank_accounts
         (nickname, institution, bsb_masked, account_number_masked, currency, opening_balance, current_ledger_balance, reconciled_balance, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [nickname, req.body.institution || null, req.body.bsb_masked || null, req.body.account_number_masked || null,
          currency, opening, opening, opening, req.user.id]
      );
      result = insert.insertId;
      await logAudit(pool, audit(req, { action: 'CREATED', module: 'finance', recordType: 'bank_account', recordId: result, newValue: { ...req.body, opening_balance: opening } }));
    }
    res.json({ message: 'Bank account saved successfully.', bank_account_id: result });
  } catch (error) {
    return fail(res, error, 'Failed to save bank account');
  }
};

function bankRowHash(accountId, row) {
  return crypto.createHash('sha256').update([
    accountId, dateOnly(row.transaction_date), String(row.description || '').trim().toLowerCase(),
    String(row.reference || '').trim().toLowerCase(), money.fromCents(money.toCents(row.debit || 0)),
    money.fromCents(money.toCents(row.credit || 0)), row.running_balance === '' || row.running_balance === null || row.running_balance === undefined
      ? '' : money.fromCents(money.toCents(row.running_balance))
  ].join('|')).digest('hex');
}

exports.importBankTransactions = async (req, res) => {
  let db;
  try {
    await ensureFinanceSchema();
    const accountId = Number(req.params.id || 0);
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rows.length) throw new FinanceError('No bank statement rows were supplied.', 400, 'IMPORT_ROWS_REQUIRED');
    if (rows.length > 5000) throw new FinanceError('Import is limited to 5,000 rows per batch.', 413, 'IMPORT_TOO_LARGE');
    db = await pool.getConnection();
    await db.beginTransaction();
    const [[account]] = await db.query(`SELECT * FROM bank_accounts WHERE id = ? AND status = 'ACTIVE' FOR UPDATE`, [accountId]);
    if (!account) throw new FinanceError('Active bank account not found.', 404, 'BANK_ACCOUNT_NOT_FOUND');
    const batchUid = uid('BANK');
    let imported = 0;
    let duplicates = 0;
    const rejected = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      try {
        const transactionDate = dateOnly(row.transaction_date);
        if (!transactionDate) throw new Error('Invalid date');
        const debit = money.fromCents(money.toCents(row.debit || 0));
        const credit = money.fromCents(money.toCents(row.credit || 0));
        if ((money.toCents(debit) > 0n) === (money.toCents(credit) > 0n)) throw new Error('Enter either debit or credit');
        const hash = bankRowHash(accountId, { ...row, transaction_date: transactionDate, debit, credit });
        const [insert] = await db.query(
          `INSERT IGNORE INTO bank_transactions
           (bank_account_id, import_batch_uid, row_hash, transaction_date, description, reference, debit, credit, running_balance, imported_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [accountId, batchUid, hash, transactionDate, String(row.description || '').trim() || null,
            String(row.reference || '').trim() || null, debit, credit,
            row.running_balance === '' || row.running_balance === null || row.running_balance === undefined
              ? null : money.fromCents(money.toCents(row.running_balance)), req.user.id]
        );
        if (insert.affectedRows) imported += 1;
        else duplicates += 1;
      } catch (error) {
        rejected.push({ row: index + 1, message: error.message });
      }
    }
    await db.query(
      `INSERT INTO bank_import_batches
       (batch_uid, bank_account_id, original_name, imported_rows, duplicate_rows, rejected_rows, imported_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [batchUid, accountId, req.body.original_name || null, imported, duplicates, rejected.length, req.user.id]
    );
    await logAudit(db, audit(req, { action: 'IMPORTED', module: 'finance', recordType: 'bank_import', recordId: batchUid, newValue: { bank_account_id: accountId, imported, duplicates, rejected: rejected.length } }));
    await db.commit();
    res.json({ message: `Bank import complete: ${imported} imported, ${duplicates} duplicates, ${rejected.length} rejected.`, batch_uid: batchUid, imported, duplicates, rejected });
  } catch (error) {
    if (db) await db.rollback();
    return fail(res, error, 'Failed to import bank transactions');
  } finally {
    if (db) db.release();
  }
};

exports.getBankTransactions = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const { page, limit, offset } = pageValues(req, 25, 500);
    const clauses = ['bt.bank_account_id = ?'];
    const params = [Number(req.params.id)];
    if (req.query.status) { clauses.push('bt.reconciliation_status = ?'); params.push(String(req.query.status).toUpperCase()); }
    const where = clauses.join(' AND ');
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM bank_transactions bt WHERE ${where}`, params);
    const [rows] = await pool.query(
      `SELECT bt.*,
       COALESCE((SELECT SUM(rm.matched_amount) FROM reconciliation_matches rm WHERE rm.bank_transaction_id = bt.id), 0) AS matched_amount
       FROM bank_transactions bt WHERE ${where} ORDER BY bt.transaction_date ASC, bt.id ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({
      bank_transactions: rows.map((row) => normalizeDateFields(row, ['transaction_date'])),
      page,
      limit,
      total: Number(count.total || 0)
    });
  } catch (error) {
    return fail(res, error, 'Failed to load bank transactions');
  }
};

exports.reconcileBankTransaction = async (req, res) => {
  let db;
  try {
    await ensureFinanceSchema();
    const bankTransactionId = Number(req.params.id);
    const financeTransactionId = Number(req.body.finance_transaction_id || 0);
    const matched = money.fromCents(money.toCents(req.body.matched_amount));
    if (!financeTransactionId || money.toCents(matched) <= 0n) throw new FinanceError('Select a posted finance transaction and positive match amount.');
    db = await pool.getConnection();
    await db.beginTransaction();
    const [[bank]] = await db.query(`SELECT * FROM bank_transactions WHERE id = ? FOR UPDATE`, [bankTransactionId]);
    if (!bank) throw new FinanceError('Bank transaction not found.', 404);
    if (bank.reconciliation_status === 'IGNORED') throw new FinanceError('Ignored bank transactions must be reopened before matching.', 409);
    const [[transaction]] = await db.query(`SELECT * FROM finance_transactions WHERE id = ? AND status = 'POSTED' FOR UPDATE`, [financeTransactionId]);
    if (!transaction) throw new FinanceError('Only posted finance transactions can be reconciled.', 409, 'TRANSACTION_NOT_POSTED');
    const bankTotal = money.toCents(bank.credit) - money.toCents(bank.debit);
    const absoluteBank = bankTotal < 0n ? -bankTotal : bankTotal;
    const [[sum]] = await db.query(`SELECT COALESCE(SUM(matched_amount), 0) AS total FROM reconciliation_matches WHERE bank_transaction_id = ?`, [bank.id]);
    const matchedTotal = money.toCents(sum.total) + money.toCents(matched);
    if (matchedTotal > absoluteBank) throw new FinanceError(`Match exceeds the bank transaction amount of $${money.fromCents(absoluteBank)}.`, 409, 'MATCH_EXCEEDS_BANK_AMOUNT');
    await db.query(
      `INSERT INTO reconciliation_matches (bank_transaction_id, finance_transaction_id, matched_amount, match_type, match_note, matched_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [bank.id, transaction.id, matched, req.body.match_type || 'MATCH', req.body.note || null, req.user.id]
    );
    const completed = matchedTotal === absoluteBank;
    await db.query(`UPDATE bank_transactions SET reconciliation_status = ? WHERE id = ?`, [completed ? 'RECONCILED' : 'PARTIAL', bank.id]);
    if (completed) await db.query(`UPDATE finance_transactions SET reconciliation_status = 'RECONCILED', status = 'RECONCILED' WHERE id = ?`, [transaction.id]);
    await logAudit(db, audit(req, { action: 'RECONCILED', module: 'finance', recordType: 'bank_transaction', recordId: bank.id, newValue: { finance_transaction_id: transaction.id, matched_amount: matched, completed } }));
    await db.commit();
    res.json({ message: completed ? 'Bank transaction reconciled.' : 'Partial bank match saved.', reconciliation_status: completed ? 'RECONCILED' : 'PARTIAL' });
  } catch (error) {
    if (db) await db.rollback();
    return fail(res, error, 'Failed to reconcile bank transaction');
  } finally {
    if (db) db.release();
  }
};

exports.ignoreBankTransaction = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const reason = String(req.body.reason || '').trim();
    if (!reason) throw new FinanceError('A reason is required to ignore a bank transaction.', 400, 'REASON_REQUIRED');
    const [[row]] = await pool.query(`SELECT * FROM bank_transactions WHERE id = ?`, [req.params.id]);
    if (!row) throw new FinanceError('Bank transaction not found.', 404);
    if (row.reconciliation_status === 'RECONCILED') throw new FinanceError('Reconciled bank transactions cannot be ignored.', 409);
    await pool.query(`UPDATE bank_transactions SET reconciliation_status = 'IGNORED', ignored_reason = ? WHERE id = ?`, [reason, row.id]);
    await logAudit(pool, audit(req, { action: 'IGNORED', module: 'finance', recordType: 'bank_transaction', recordId: row.id, oldValue: row, newValue: { reason } }));
    res.json({ message: 'Bank transaction ignored with an audit reason.' });
  } catch (error) {
    return fail(res, error, 'Failed to ignore bank transaction');
  }
};

exports.getAccountingPeriods = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const [rows] = await pool.query(
      `SELECT ap.*, fy.label AS financial_year_label FROM accounting_periods ap
       JOIN financial_years fy ON fy.id = ap.financial_year_id
       WHERE (? = 0 OR ap.financial_year_id = ?) ORDER BY ap.start_date`,
      [Number(req.query.financial_year_id || 0), Number(req.query.financial_year_id || 0)]
    );
    res.json({
      accounting_periods: rows.map((row) => normalizeDateFields(row, ['start_date', 'end_date']))
    });
  } catch (error) {
    return fail(res, error, 'Failed to load accounting periods');
  }
};

exports.updateAccountingPeriod = async (req, res) => {
  let db;
  try {
    await ensureFinanceSchema();
    const status = String(req.body.status || '').toUpperCase();
    const reason = String(req.body.reason || '').trim();
    const confirmation = String(req.body.confirmation || '').trim();
    if (!PERIOD_STATUSES.has(status)) throw new FinanceError('Invalid accounting-period status.');
    db = await pool.getConnection();
    await db.beginTransaction();
    const [[period]] = await db.query(`SELECT * FROM accounting_periods WHERE id = ? FOR UPDATE`, [req.params.id]);
    if (!period) throw new FinanceError('Accounting period not found.', 404);
    if (status === 'LOCKED') {
      if (!reason) throw new FinanceError('A lock reason is required.', 400, 'REASON_REQUIRED');
      if (confirmation !== `LOCK ${period.period_key}`) throw new FinanceError(`Type LOCK ${period.period_key} to confirm.`, 400, 'CONFIRMATION_REQUIRED');
      const [[unreconciled]] = await db.query(
        `SELECT COUNT(*) AS count FROM finance_transactions WHERE effective_date BETWEEN ? AND ? AND status = 'POSTED' AND reconciliation_status = 'UNRECONCILED'`,
        [period.start_date, period.end_date]
      );
      if (Number(unreconciled.count || 0)) throw new FinanceError('This period has unreconciled posted transactions.', 409, 'PERIOD_NOT_READY');
    }
    if (period.status === 'LOCKED' && status !== 'LOCKED' && !reason) throw new FinanceError('An unlock reason is required.');
    await db.query(
      `UPDATE accounting_periods SET status = ?, locked_at = ?, locked_by = ?, lock_reason = ? WHERE id = ?`,
      [status, status === 'LOCKED' ? new Date() : null, status === 'LOCKED' ? req.user.id : null, reason || period.lock_reason, period.id]
    );
    await logAudit(db, audit(req, { action: status === 'LOCKED' ? 'LOCKED' : period.status === 'LOCKED' ? 'UNLOCKED' : 'STATUS_CHANGED', module: 'finance', recordType: 'accounting_period', recordId: period.id, oldValue: period, newValue: { status, reason } }));
    await db.commit();
    res.json({ message: `Accounting period changed to ${status}.` });
  } catch (error) {
    if (db) await db.rollback();
    return fail(res, error, 'Failed to update accounting period');
  } finally {
    if (db) db.release();
  }
};

exports.getAccountantQueries = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const clauses = ['1 = 1'];
    const params = [];
    if (req.query.financial_year_id) { clauses.push('aq.financial_year_id = ?'); params.push(Number(req.query.financial_year_id)); }
    if (req.query.status) { clauses.push('aq.status = ?'); params.push(String(req.query.status).toUpperCase()); }
    const [rows] = await pool.query(
      `SELECT aq.*, ru.name AS raised_by_name, au.name AS assigned_to_name, ans.name AS answered_by_name
       FROM accountant_queries aq
       LEFT JOIN users ru ON ru.id = aq.raised_by LEFT JOIN users au ON au.id = aq.assigned_to LEFT JOIN users ans ON ans.id = aq.answered_by
       WHERE ${clauses.join(' AND ')} ORDER BY aq.raised_at ASC, aq.id ASC`, params
    );
    res.json({ queries: rows });
  } catch (error) {
    return fail(res, error, 'Failed to load accountant queries');
  }
};

exports.saveAccountantQuery = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const question = String(req.body.question || '').trim();
    if (!question) throw new FinanceError('Question is required.', 400, 'QUESTION_REQUIRED');
    const queryUid = uid('CAQ');
    const [result] = await pool.query(
      `INSERT INTO accountant_queries
       (query_uid, financial_year_id, module, record_id, question, raised_by, assigned_to)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [queryUid, Number(req.body.financial_year_id || 0) || null, req.body.module || 'finance', req.body.record_id || null,
        question, req.user.id, Number(req.body.assigned_to || 0) || null]
    );
    await logAudit(pool, audit(req, { action: 'CREATED', module: 'finance', recordType: 'accountant_query', recordId: result.insertId, newValue: { query_uid: queryUid, question } }));
    res.json({ message: 'Accountant query recorded.', query_id: result.insertId });
  } catch (error) {
    return fail(res, error, 'Failed to create accountant query');
  }
};

exports.updateAccountantQuery = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const [[row]] = await pool.query(`SELECT * FROM accountant_queries WHERE id = ?`, [req.params.id]);
    if (!row) throw new FinanceError('Accountant query not found.', 404);
    const status = String(req.body.status || (req.body.answer ? 'ANSWERED' : row.status)).toUpperCase();
    if (!['QUESTION', 'ANSWERED', 'RESOLVED'].includes(status)) throw new FinanceError('Invalid query status.');
    const answer = req.body.answer === undefined ? row.answer : String(req.body.answer || '').trim();
    if (status === 'ANSWERED' && !answer) throw new FinanceError('Answer is required.');
    await pool.query(
      `UPDATE accountant_queries SET answer = ?, status = ?, answered_by = ?, answered_at = ?, resolved_at = ? WHERE id = ?`,
      [answer || null, status, answer ? req.user.id : row.answered_by, answer ? new Date() : row.answered_at,
        status === 'RESOLVED' ? new Date() : null, row.id]
    );
    await logAudit(pool, audit(req, { action: status, module: 'finance', recordType: 'accountant_query', recordId: row.id, oldValue: row, newValue: { answer, status } }));
    res.json({ message: `Accountant query changed to ${status}.` });
  } catch (error) {
    return fail(res, error, 'Failed to update accountant query');
  }
};

exports.getAssets = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const [rows] = await pool.query(
      `SELECT a.*, s.supplier_name, u.name AS assigned_to_name FROM assets a
       LEFT JOIN suppliers s ON s.id = a.supplier_id LEFT JOIN users u ON u.id = a.assigned_to
       ORDER BY COALESCE(a.purchase_date, '1900-01-01') ASC, a.id ASC`
    );
    res.json({
      assets: rows.map((row) => normalizeDateFields(row, ['purchase_date', 'disposed_date']))
    });
  } catch (error) {
    return fail(res, error, 'Failed to load asset register');
  }
};

exports.saveAsset = async (req, res) => {
  try {
    await ensureFinanceSchema();
    const assetNumber = String(req.body.asset_number || '').trim();
    const description = String(req.body.description || '').trim();
    if (!assetNumber || !description) throw new FinanceError('Asset number and description are required.');
    const purchaseCost = money.fromCents(money.toCents(req.body.purchase_cost || 0));
    const gst = money.fromCents(money.toCents(req.body.gst_amount || 0));
    const net = money.fromCents(money.toCents(req.body.net_cost || money.subtract(purchaseCost, gst)));
    if (!money.equals(money.add(net, gst), purchaseCost, 1n)) throw new FinanceError('Asset net cost plus GST must equal purchase cost.', 400, 'TOTAL_MISMATCH');
    if (req.body.purchase_date) await yearAndPeriod(req.body.purchase_date);
    const id = Number(req.body.id || 0);
    if (id) {
      const [[old]] = await pool.query(`SELECT * FROM assets WHERE id = ?`, [id]);
      if (!old) throw new FinanceError('Asset not found.', 404);
      await pool.query(
        `UPDATE assets SET asset_number = ?, description = ?, category = ?, purchase_date = ?, supplier_id = ?, purchase_cost = ?, gst_amount = ?, net_cost = ?, serial_number = ?, location = ?, assigned_to = ?, accounting_status = ?, useful_life_months = ?, depreciation_method = ?, opening_written_down_value = ?, closing_written_down_value = ? WHERE id = ?`,
        [assetNumber, description, req.body.category || null, dateOnly(req.body.purchase_date) || null, Number(req.body.supplier_id || 0) || null,
          purchaseCost, gst, net, req.body.serial_number || null, req.body.location || null, Number(req.body.assigned_to || 0) || null,
          req.body.accounting_status || 'REVIEW_REQUIRED', Number(req.body.useful_life_months || 0) || null, req.body.depreciation_method || null,
          req.body.opening_written_down_value || null, req.body.closing_written_down_value || null, id]
      );
      await logAudit(pool, audit(req, { action: 'EDITED', module: 'finance', recordType: 'asset', recordId: id, oldValue: old, newValue: req.body }));
      return res.json({ message: 'Asset updated successfully.', asset_id: id });
    }
    const [insert] = await pool.query(
      `INSERT INTO assets
       (asset_number, description, category, purchase_date, supplier_id, purchase_cost, gst_amount, net_cost, serial_number, location, assigned_to, accounting_status, useful_life_months, depreciation_method, opening_written_down_value, closing_written_down_value, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [assetNumber, description, req.body.category || null, dateOnly(req.body.purchase_date) || null, Number(req.body.supplier_id || 0) || null,
        purchaseCost, gst, net, req.body.serial_number || null, req.body.location || null, Number(req.body.assigned_to || 0) || null,
        req.body.accounting_status || 'REVIEW_REQUIRED', Number(req.body.useful_life_months || 0) || null, req.body.depreciation_method || null,
        req.body.opening_written_down_value || null, req.body.closing_written_down_value || null, req.user.id]
    );
    await logAudit(pool, audit(req, { action: 'CREATED', module: 'finance', recordType: 'asset', recordId: insert.insertId, newValue: req.body }));
    res.json({ message: 'Asset added to the register.', asset_id: insert.insertId });
  } catch (error) {
    return fail(res, error, 'Failed to save asset');
  }
};

module.exports.BILL_STATUSES = BILL_STATUSES;
