const { storedDocumentArtifact, sendPdfResponse } = require('../services/documentPdfService');
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { logSecurityEvent } = require('../services/sessionService');
const { safeDispositionName } = require('../services/documentSecurityService');
const money = require('../utils/money');
const { paymentState, validatePaymentAmount, paymentSql } = require('../services/expensePaymentDomain');
const { expenseFilters } = require('../services/expenseRegisterFilters');
const { logAudit } = require('../services/auditService');
const { dateOnly } = require('../utils/dateOnly');
const crypto = require('crypto');

let originalSchemaPromise;
function ensureExpenseTables() {
  if (!originalSchemaPromise) originalSchemaPromise = createExpenseTablesStructures().catch((error) => { originalSchemaPromise = null; throw error; });
  return originalSchemaPromise;
}

async function createExpenseTablesStructures() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      expense_date DATE NOT NULL,
      supplier_name VARCHAR(180) NULL,
      category VARCHAR(120) NULL,
      description TEXT NULL,
      invoice_no VARCHAR(120) NULL,
      payment_method VARCHAR(80) NULL,
      amount_ex_gst DECIMAL(12,2) NOT NULL DEFAULT 0,
      gst_rate DECIMAL(5,2) NOT NULL DEFAULT 10,
      gst_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(40) NOT NULL DEFAULT 'paid',
      notes TEXT NULL,
      created_by INT NULL,
      updated_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      deleted TINYINT(1) NOT NULL DEFAULT 0
    )
  `);

  await pool.query('ALTER TABLE expenses ADD COLUMN due_date DATE NULL AFTER expense_date').catch(() => {});
  for (const [name, definition] of [['request_key', 'CHAR(64) NULL'], ['request_hash', 'CHAR(64) NULL']]) {
    try { await pool.query(`ALTER TABLE expenses ADD COLUMN ${name} ${definition}`); }
    catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
  }
  try { await pool.query('ALTER TABLE expenses ADD UNIQUE KEY uniq_expense_request_key (request_key)'); }
  catch (error) { if (error.code !== 'ER_DUP_KEYNAME') throw error; }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS expense_payments (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      expense_id INT NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      payment_date DATE NOT NULL,
      payment_method VARCHAR(80) NOT NULL,
      account_name VARCHAR(180) NULL,
      reference VARCHAR(180) NULL,
      notes TEXT NULL,
      idempotency_key VARCHAR(80) NULL,
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      voided_by INT NULL,
      voided_at DATETIME NULL,
      void_reason TEXT NULL,
      UNIQUE KEY uniq_expense_payment_idempotency (idempotency_key),
      INDEX idx_expense_payments_expense (expense_id, payment_date),
      INDEX idx_expense_payments_voided (expense_id, voided_at)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS expense_files (
      id INT AUTO_INCREMENT PRIMARY KEY,
      expense_id INT NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      file_path TEXT NOT NULL,
      mime_type VARCHAR(120) NULL,
      file_data LONGBLOB NULL,
      uploaded_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      INDEX expense_files_expense_id_idx (expense_id)
    )
  `);

  await pool.query('ALTER TABLE expense_files ADD COLUMN file_data LONGBLOB NULL').catch(() => {});
  await pool.query("ALTER TABLE expense_files ADD COLUMN classification VARCHAR(20) NOT NULL DEFAULT 'RESTRICTED'").catch(() => {});
  await pool.query("ALTER TABLE expense_files ADD COLUMN scan_status VARCHAR(20) NOT NULL DEFAULT 'UNAVAILABLE'").catch(() => {});
  await pool.query('ALTER TABLE expense_files ADD COLUMN size_bytes BIGINT NULL').catch(() => {});
}

function financialYearBounds(fy) {
  const now = new Date();
  const currentStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const startYear = Number(fy || currentStart);
  return {
    startYear,
    start: `${startYear}-07-01`,
    end: `${startYear + 1}-06-30`
  };
}

function cleanMoney(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

async function getExpenseRows(input = {}) {
  const { page=1, limit=25 }=input;
  const safeLimit=Math.min(Math.max(Math.floor(Number(limit)||25),5),200);
  const safePage=Math.max(Math.floor(Number(page)||1),1);
  const offset=(safePage-1)*safeLimit;
  const {where,params}=expenseFilters(input);
  const {join}=paymentSql();
  const sortColumns = { id: 'e.id', date: 'e.expense_date', supplier: 'e.supplier_name', amount: 'e.total_amount', due: 'e.due_date' };
  const sort = Object.hasOwn(sortColumns, input.sort) ? sortColumns[input.sort] : 'e.id';
  const direction = String(input.direction || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const [[countRow]]=await pool.query(`SELECT COUNT(*) AS total FROM expenses e ${join} ${where}`,params);

  const [rows] = await pool.query(
    `
    SELECT e.*, cu.name AS created_by_name, uu.name AS updated_by_name,
      COALESCE(f.file_count, 0) AS file_count,
      COALESCE(p.payment_count, 0) AS payment_count,
      COALESCE(p.payment_total, 0) AS recorded_payment_total
    FROM expenses e
    LEFT JOIN users cu ON cu.id = e.created_by
    LEFT JOIN users uu ON uu.id = e.updated_by
    LEFT JOIN (
      SELECT expense_id, COUNT(*) AS file_count
      FROM expense_files
      WHERE deleted = 0
      GROUP BY expense_id
    ) f ON f.expense_id = e.id
    LEFT JOIN (
      SELECT expense_id, COUNT(*) AS payment_count, SUM(amount) AS payment_total
      FROM expense_payments
      WHERE voided_at IS NULL
      GROUP BY expense_id
    ) p ON p.expense_id = e.id
    ${where}
    ORDER BY ${sort} ${direction}, e.id ${direction}
    LIMIT ? OFFSET ?
    `,
    [...params, safeLimit, offset]
  );

  const ids = rows.map((row) => Number(row.id)).filter(Boolean);
  if (ids.length) {
    const [files] = await pool.query(
      `
      SELECT ef.id, ef.expense_id, ef.original_name, ef.mime_type, ef.classification, ef.scan_status,
             ef.size_bytes, ef.uploaded_by, ef.created_at, u.name AS uploaded_by_name
      FROM expense_files ef
      LEFT JOIN users u ON u.id = ef.uploaded_by
      WHERE ef.deleted = 0
      AND ef.expense_id IN (?)
      ORDER BY ef.id ASC
      `,
      [ids]
    );

    const filesByExpense = files.reduce((acc, file) => {
      const key = String(file.expense_id);
      if (!acc[key]) acc[key] = [];
      acc[key].push({ ...file, download_url: `/api/expenses/files/${file.id}/view` });
      return acc;
    }, {});

    rows.forEach((row) => {
      row.files = filesByExpense[String(row.id)] || [];
      row.file_count = row.files.length;
      const state = paymentState(row, row.recorded_payment_total, row.payment_count);
      row.total_paid = Number(state.totalPaid);
      row.balance_due = Number(state.balanceDue);
      row.calculated_status = state.status;
      row.status = state.status;
    });
  } else {
    rows.forEach((row) => {
      row.files = [];
      const state = paymentState(row, row.recorded_payment_total, row.payment_count);
      row.total_paid = Number(state.totalPaid);
      row.balance_due = Number(state.balanceDue);
      row.calculated_status = state.status;
      row.status = state.status;
    });
  }

  return {
    rows,
    total: Number(countRow.total || 0),
    page: safePage,
    limit: safeLimit
  };
}

async function getExpenseSummary(input = {}) {
  if (typeof input==='string') input={fy:input};
  const {where,params}=expenseFilters(input),{paid,due,join}=paymentSql();
  const bounds=financialYearBounds(input.fy),hasFinancialYear=Boolean(input.fy);
  const [[expenses]]=await pool.query(`SELECT COUNT(*) AS expense_count,
    COALESCE(SUM(e.total_amount),0) AS total_expense,COALESCE(SUM(e.gst_amount),0) AS gst_paid,
    COALESCE(SUM(${paid}),0) AS total_paid,COALESCE(SUM(${due}),0) AS outstanding_debt,
    COALESCE(SUM(CASE WHEN e.due_date IS NOT NULL AND e.due_date<CURDATE() THEN ${due} ELSE 0 END),0) AS overdue_debt
    FROM expenses e ${join} ${where}`,params);
  // Invoice GST is a separate tax-register metric, explicitly scoped to the period only.
  const invoiceWhere=hasFinancialYear?'AND created_at>=? AND created_at<DATE_ADD(?,INTERVAL 1 DAY)':'';
  const [[invoices]]=await pool.query(`SELECT COALESCE(SUM(total-(total/(1+(gst_rate/100)))),0) AS gst_collected,COALESCE(SUM(total),0) AS invoice_value
    FROM invoices WHERE (deleted=0 OR deleted IS NULL) ${invoiceWhere}`,hasFinancialYear?[bounds.start,bounds.end]:[]);
  const [categoryRows]=await pool.query(`SELECT COALESCE(NULLIF(TRIM(e.category),''),'Uncategorised') AS category,
    COUNT(*) AS bill_count,COALESCE(SUM(e.total_amount),0) AS total_amount,COALESCE(SUM(${paid}),0) AS paid_value,COALESCE(SUM(${due}),0) AS pending_value
    FROM expenses e ${join} ${where} GROUP BY 1 ORDER BY total_amount DESC`,params);
  const [monthRows]=await pool.query(`SELECT DATE_FORMAT(e.expense_date,'%Y-%m') AS month,COALESCE(SUM(e.total_amount),0) AS total_amount
    FROM expenses e ${join} ${where} GROUP BY 1 ORDER BY month`,params);
  return { financial_year:hasFinancialYear?`${bounds.startYear}-${bounds.startYear+1}`:'All years',
    start:input.from||(hasFinancialYear?bounds.start:null),end:input.to||(hasFinancialYear?bounds.end:null),
    currency:'AUD',basis:'Recorded supplier bills',filters:input,
    expense_count:Number(expenses.expense_count||0),total_expense:expenses.total_expense||'0.00',
    outstanding_debt:expenses.outstanding_debt||'0.00',overdue_debt:expenses.overdue_debt||'0.00',total_paid:expenses.total_paid||'0.00',
    gst_paid:expenses.gst_paid||'0.00',gst_collected:invoices.gst_collected||'0.00',
    gst_position:money.subtract(invoices.gst_collected||0,expenses.gst_paid||0),invoice_value:invoices.invoice_value||'0.00',categories:categoryRows,months:monthRows };
}

exports.getExpenses = async (req, res) => {
  try {
    await ensureExpenseTables();

    const filters={...req.query,search:String(req.query.search||'').trim()};
    const result=await getExpenseRows(filters);
    const summary=await getExpenseSummary(filters);

    res.json({ expenses: result.rows, total: result.total, page: result.page, limit: result.limit, summary });
  } catch (error) {
    console.error('getExpenses error:', error);
    res.status(error instanceof TypeError?400:500).json({ message:error instanceof TypeError?error.message:'Failed to load expenses' });
  }
};

exports.saveExpense = async (req, res) => {
  let connection;
  try {
    const id = Number(req.body.id || 0);
    const expenseDate = dateOnly(req.body.expense_date), dueDate = req.body.due_date ? dateOnly(req.body.due_date) : null;
    const supplierName = String(req.body.supplier_name || '').trim(), category = String(req.body.category || '').trim();
    const description = String(req.body.description || '').trim(), invoiceNo = String(req.body.invoice_no || '').trim();
    const paymentMethod = String(req.body.payment_method || '').trim(), notes = String(req.body.notes || '').trim();
    const status = String(req.body.status || 'unpaid').trim().toLowerCase();
    const fields = {};
    if (!Number.isSafeInteger(id) || id < 0) fields.id = 'Choose a valid expense';
    if (!expenseDate) fields.expense_date = 'Enter a real calendar date';
    if (req.body.due_date && !dueDate) fields.due_date = 'Enter a real calendar date';
    if (!supplierName || supplierName.length > 180) fields.supplier_name = 'Enter a supplier name of 1 to 180 characters';
    if (!description || description.length > 10000) fields.description = 'Enter a description of 1 to 10,000 characters';
    if (category.length > 120) fields.category = 'Maximum 120 characters';
    if (invoiceNo.length > 120) fields.invoice_no = 'Maximum 120 characters';
    if (paymentMethod.length > 80) fields.payment_method = 'Maximum 80 characters';
    if (notes.length > 10000) fields.notes = 'Maximum 10,000 characters';
    if (!['paid', 'unpaid', 'reimbursed', 'disputed', 'partially_paid', 'overdue'].includes(status)) fields.status = 'Choose a supported expense status';
    let amountExGst;
    try {
      const rawAmount = money.normalizeDecimal(req.body.amount_ex_gst);
      if (!/^\d+(?:\.\d{1,2})?$/.test(rawAmount) || money.toCents(rawAmount) <= 0n) throw new TypeError();
      amountExGst = money.fromCents(money.toCents(rawAmount));
    } catch { fields.amount_ex_gst = 'Enter a positive amount with at most two decimal places'; }
    const gstRate = Number(req.body.gst_rate ?? 0);
    if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100 || !/^\d+(?:\.\d{1,2})?$/.test(String(req.body.gst_rate ?? 0))) fields.gst_rate = 'Enter a GST rate from 0 to 100 with at most two decimal places';
    const retryKey = String(req.get?.('Idempotency-Key') || '').trim();
    if (retryKey && !/^[A-Za-z0-9._:-]{8,120}$/.test(retryKey)) fields.idempotency_key = 'Use a retry key of 8 to 120 safe characters';
    if (Object.keys(fields).length) return res.status(400).json({ message: 'Check the highlighted expense fields.', fields });
    const gstAmount = money.percentageOf(amountExGst, String(gstRate)), totalAmount = money.add(amountExGst, gstAmount);
    if (money.toCents(totalAmount) > 999999999999n) return res.status(400).json({ message: 'Expense total exceeds the supported amount', fields: { amount_ex_gst: 'Total including GST must not exceed 9,999,999,999.99' } });
    await ensureExpenseTables();
    connection = await pool.getConnection(); await connection.beginTransaction();
    let previous = null, recordId = id, savedStatus = status;
    const requestKey = !id && retryKey ? crypto.createHash('sha256').update(`expense:${req.user.id}:${retryKey}`).digest('hex') : null;
    const requestHash = requestKey ? crypto.createHash('sha256').update(JSON.stringify([expenseDate, dueDate, supplierName, category, description, invoiceNo, paymentMethod, amountExGst, gstRate, gstAmount, totalAmount, status, notes])).digest('hex') : null;
    if (requestKey) {
      await connection.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [req.user.id]);
      const [[existing]] = await connection.query('SELECT * FROM expenses WHERE request_key = ? FOR UPDATE', [requestKey]);
      if (existing) {
        if (existing.request_hash !== requestHash || Number(existing.deleted)) { await connection.rollback(); return res.status(409).json({ message: 'This retry key was already used for a different or archived expense', code: 'IDEMPOTENCY_CONFLICT' }); }
        await connection.commit(); return res.json({ message: 'The existing expense was returned safely', expense_id: existing.id, status: existing.status, duplicate: true });
      }
    }
    if (id) {
      const [[row]] = await connection.query('SELECT * FROM expenses WHERE id = ? AND deleted = 0 FOR UPDATE', [id]);
      if (!row) { await connection.rollback(); return res.status(404).json({ message: 'Expense not found' }); }
      previous = row;
      const [[payments]] = await connection.query('SELECT COUNT(*) AS payment_count, COALESCE(SUM(amount), 0) AS payment_total FROM expense_payments WHERE expense_id = ? AND voided_at IS NULL', [id]);
      if (money.toCents(payments.payment_total) > money.toCents(totalAmount)) { await connection.rollback(); return res.status(409).json({ message: 'Expense total cannot be less than payments already recorded', fields: { amount_ex_gst: 'Keep the total at or above recorded payments' } }); }
      if (Number(payments.payment_count) > 0) savedStatus = paymentState({ total_amount: totalAmount, due_date: dueDate, status: 'unpaid' }, payments.payment_total, payments.payment_count).status;
      await connection.query(`UPDATE expenses SET expense_date = ?, due_date = ?, supplier_name = ?, category = ?, description = ?, invoice_no = ?,
        payment_method = ?, amount_ex_gst = ?, gst_rate = ?, gst_amount = ?, total_amount = ?, status = ?, notes = ?, updated_by = ? WHERE id = ? AND deleted = 0`,
        [expenseDate, dueDate, supplierName, category, description, invoiceNo, paymentMethod, amountExGst, gstRate, gstAmount, totalAmount, savedStatus, notes, req.user.id, id]);
    } else {
      const [result] = await connection.query(`INSERT INTO expenses
        (expense_date, due_date, supplier_name, category, description, invoice_no, payment_method, amount_ex_gst, gst_rate, gst_amount, total_amount, status, notes, created_by, request_key, request_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [expenseDate, dueDate, supplierName, category, description, invoiceNo, paymentMethod, amountExGst, gstRate, gstAmount, totalAmount, savedStatus, notes, req.user.id, requestKey, requestHash]);
      recordId = result.insertId;
    }
    await logAudit(connection, { actorId: req.user.id, action: id ? 'EXPENSE_UPDATED' : 'EXPENSE_CREATED', module: 'expenses', recordType: 'expense', recordId,
      oldValue: previous, newValue: { expense_date: expenseDate, due_date: dueDate, supplier_name: supplierName, category, description, invoice_no: invoiceNo, payment_method: paymentMethod, amount_ex_gst: amountExGst, gst_rate: gstRate, gst_amount: gstAmount, total_amount: totalAmount, status: savedStatus, notes },
      ipAddress: req.ip, userAgent: req.get?.('user-agent') });
    await connection.commit();
    return res.json({ message: id ? 'Expense updated successfully' : 'Expense saved successfully', expense_id: recordId, status: savedStatus });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('Expense save failed:', error.code || error.name);
    return res.status(500).json({ message: 'Expense could not be saved. Refresh before retrying.', code: 'EXPENSE_SAVE_FAILED' });
  } finally { if (connection) connection.release(); }
};

exports.getExpensePayments = async (req, res) => {
  try {
    await ensureExpenseTables();
    const expenseId = Number(req.params.id || 0);
    const [[expense]] = await pool.query('SELECT * FROM expenses WHERE id = ? AND deleted = 0 LIMIT 1', [expenseId]);
    if (!expense) return res.status(404).json({ message: 'Expense not found' });
    const [payments] = await pool.query(`
      SELECT ep.*, u.name AS created_by_name, vu.name AS voided_by_name
      FROM expense_payments ep
      LEFT JOIN users u ON u.id = ep.created_by
      LEFT JOIN users vu ON vu.id = ep.voided_by
      WHERE ep.expense_id = ? ORDER BY ep.payment_date DESC, ep.id DESC
    `, [expenseId]);
    const active = payments.filter((entry) => !entry.voided_at);
    const paid = active.reduce((sum, entry) => money.add(sum, entry.amount), '0.00');
    const state = paymentState(expense, paid, active.length);
    res.json({ expense: { ...expense, total_paid: Number(state.totalPaid), balance_due: Number(state.balanceDue), status: state.status }, payments });
  } catch (error) {
    console.error('getExpensePayments error:', error);
    res.status(500).json({ message: 'Failed to load expense payments', error: error.message });
  }
};

exports.recordExpensePayment = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await ensureExpenseTables();
    const expenseId = Number(req.params.id || 0);
    const paymentDate = require('../utils/dateOnly').dateOnly(req.body.payment_date);
    const paymentMethod = String(req.body.payment_method || '').trim();
    const accountName = String(req.body.account_name || '').trim();
    const reference = String(req.body.reference || '').trim();
    const notes = String(req.body.notes || '').trim();
    const idempotencyKey = String(req.body.idempotency_key || req.get?.('Idempotency-Key') || '').trim() || null;
    if (idempotencyKey && !/^[A-Za-z0-9._:-]{8,80}$/.test(idempotencyKey)) return res.status(400).json({ message: 'Payment retry key must contain 8 to 80 safe characters', fields: { idempotency_key: 'Use 8 to 80 safe characters' } });
    if (!Number.isSafeInteger(expenseId) || expenseId <= 0 || !paymentDate || !paymentMethod || !accountName || paymentMethod.length > 80 || accountName.length > 180 || reference.length > 180 || notes.length > 10000) {
      return res.status(400).json({ message: 'Expense, payment date, payment method and paid-from account are required' });
    }

    await connection.beginTransaction();
    const [[expense]] = await connection.query('SELECT * FROM expenses WHERE id = ? AND deleted = 0 FOR UPDATE', [expenseId]);
    if (!expense) { await connection.rollback(); return res.status(404).json({ message: 'Expense not found' }); }
    const [[totals]] = await connection.query('SELECT COUNT(*) AS payment_count, COALESCE(SUM(amount), 0) AS payment_total FROM expense_payments WHERE expense_id = ? AND voided_at IS NULL', [expenseId]);
    const state = paymentState(expense, totals.payment_total, totals.payment_count);
    if (idempotencyKey) {
      const [[existing]] = await connection.query('SELECT * FROM expense_payments WHERE idempotency_key = ? FOR UPDATE', [idempotencyKey]);
      if (existing) {
        const existingDate = require('../utils/dateOnly').dateOnly(existing.payment_date);
        let sameAmount = false;
        try { sameAmount = money.toCents(existing.amount) === money.toCents(req.body.amount); } catch {}
        if (Number(existing.expense_id) !== expenseId || Number(existing.created_by) !== Number(req.user.id) || !sameAmount || existingDate !== paymentDate || existing.payment_method !== paymentMethod || (existing.account_name || '') !== accountName || (existing.reference || '') !== reference || (existing.notes || '') !== notes || existing.voided_at) {
          await connection.rollback(); return res.status(409).json({ message: 'This retry key was already used for a different or reversed payment', code: 'IDEMPOTENCY_CONFLICT' });
        }
        await connection.commit();
        return res.json({ message: 'The existing payment was returned safely', payment_id: existing.id, duplicate: true, total_paid: Number(state.totalPaid), balance_due: Number(state.balanceDue), status: state.status });
      }
    }

    let amount;
    try { amount = validatePaymentAmount(req.body.amount, state.balanceDue); }
    catch (error) { await connection.rollback(); return res.status(400).json({ message: error.message }); }

    const [result] = await connection.query(`
      INSERT INTO expense_payments
      (expense_id, amount, payment_date, payment_method, account_name, reference, notes, idempotency_key, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [expenseId, amount, paymentDate, paymentMethod, accountName || null, reference || null, notes || null, idempotencyKey, req.user.id]);
    const newPaid = money.add(state.totalPaid, amount);
    const newState = paymentState({ ...expense, status: 'unpaid' }, newPaid, Number(totals.payment_count || 0) + 1);
    await connection.query('UPDATE expenses SET status = ?, payment_method = ?, updated_by = ? WHERE id = ?', [newState.status, paymentMethod, req.user.id, expenseId]);
    await logAudit(connection, {
      actorId: req.user.id, action: 'PAYMENT_RECORDED', module: 'expenses', recordType: 'expense_payment', recordId: result.insertId,
      oldValue: { balance_due: state.balanceDue }, newValue: { expense_id: expenseId, amount, total_paid: newState.totalPaid, balance_due: newState.balanceDue },
      ipAddress: req.ip, userAgent: req.get('user-agent')
    });
    await connection.commit();
    res.json({ message: 'Payment recorded successfully', payment_id: result.insertId, total_paid: Number(newState.totalPaid), balance_due: Number(newState.balanceDue), status: newState.status });
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'This payment has already been recorded' });
    console.error('recordExpensePayment error:', error);
    res.status(500).json({ message: 'Failed to record payment', error: error.message });
  } finally { connection.release(); }
};

exports.voidExpensePayment = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await ensureExpenseTables();
    const paymentId = Number(req.params.paymentId || 0);
    const reason = String(req.body.reason || '').trim();
    if (!Number.isSafeInteger(paymentId) || paymentId <= 0 || !reason || reason.length > 10000) return res.status(400).json({ message: 'Payment and reversal reason are required', fields: { reason: 'Enter a reason of 1 to 10,000 characters' } });
    await connection.beginTransaction();
    const [[identity]] = await connection.query('SELECT expense_id FROM expense_payments WHERE id = ?', [paymentId]);
    if (!identity) { await connection.rollback(); return res.status(404).json({ message: 'Payment not found' }); }
    const [[expense]] = await connection.query('SELECT * FROM expenses WHERE id = ? FOR UPDATE', [identity.expense_id]);
    if (!expense) { await connection.rollback(); return res.status(409).json({ message: 'The original expense must be available before reversing its payment' }); }
    const [[payment]] = await connection.query('SELECT * FROM expense_payments WHERE id = ? FOR UPDATE', [paymentId]);
    if (!payment) { await connection.rollback(); return res.status(404).json({ message: 'Payment not found' }); }
    if (payment.voided_at) { await connection.commit(); return res.json({ message: 'Payment is already reversed', payment_id: paymentId, unchanged: true }); }
    await connection.query('UPDATE expense_payments SET voided_by = ?, voided_at = NOW(), void_reason = ? WHERE id = ?', [req.user.id, reason, paymentId]);
    const [[totals]] = await connection.query('SELECT COUNT(*) AS payment_count, COALESCE(SUM(amount), 0) AS payment_total FROM expense_payments WHERE expense_id = ? AND voided_at IS NULL', [payment.expense_id]);
    const state = paymentState({ ...expense, status: 'unpaid' }, totals.payment_total, totals.payment_count);
    await connection.query('UPDATE expenses SET status = ?, updated_by = ? WHERE id = ?', [state.status, req.user.id, payment.expense_id]);
    await logAudit(connection, {
      actorId: req.user.id, action: 'PAYMENT_REVERSED', module: 'expenses', recordType: 'expense_payment', recordId: paymentId,
      oldValue: payment, newValue: { void_reason: reason, balance_due: state.balanceDue }, ipAddress: req.ip, userAgent: req.get('user-agent')
    });
    await connection.commit();
    res.json({ message: 'Payment reversed successfully', balance_due: Number(state.balanceDue), status: state.status });
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error('voidExpensePayment error:', error);
    res.status(500).json({ message: 'Failed to reverse payment', error: error.message });
  } finally { connection.release(); }
};

async function archiveExpense(req, res, archived) {
  let connection;
  try {
    const id = Number(req.body.id || req.params.id || 0);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ message: 'Choose a valid expense' });
    await ensureExpenseTables(); connection = await pool.getConnection(); await connection.beginTransaction();
    const [[expense]] = await connection.query('SELECT * FROM expenses WHERE id = ? FOR UPDATE', [id]);
    if (!expense) { await connection.rollback(); return res.status(404).json({ message: 'Expense not found' }); }
    if (Boolean(Number(expense.deleted)) === archived) { await connection.commit(); return res.json({ message: 'Expense archive state already saved', expense_id: id, archived, unchanged: true }); }
    await connection.query('UPDATE expenses SET deleted = ?, updated_by = ? WHERE id = ?', [archived ? 1 : 0, req.user.id, id]);
    await logAudit(connection, { actorId: req.user.id, action: archived ? 'EXPENSE_ARCHIVED' : 'EXPENSE_RESTORED', module: 'expenses', recordType: 'expense', recordId: id,
      oldValue: { deleted: expense.deleted }, newValue: { deleted: archived ? 1 : 0 }, ipAddress: req.ip, userAgent: req.get?.('user-agent') });
    await connection.commit(); return res.json({ message: archived ? 'Expense archived; payments, files and history are retained' : 'Expense restored', expense_id: id, archived });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('Expense archive failed:', error.code || error.name);
    return res.status(500).json({ message: 'Expense archive state could not be saved' });
  } finally { if (connection) connection.release(); }
}
exports.deleteExpense = (req, res) => archiveExpense(req, res, true);
exports.restoreExpense = (req, res) => archiveExpense(req, res, false);

exports.expenseHistory = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ message: 'Choose a valid expense' });
    const [[expense]] = await pool.query('SELECT id FROM expenses WHERE id = ?', [id]);
    if (!expense) return res.status(404).json({ message: 'Expense not found' });
    const [history] = await pool.query(`SELECT a.action, a.old_value, a.new_value, a.created_at, u.name AS actor_name
      FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      WHERE LOWER(a.module) = 'expenses' AND a.record_type = 'expense' AND a.record_id = ? ORDER BY a.id DESC LIMIT 100`, [String(id)]);
    return res.json({ expense_id: id, history });
  } catch (error) { console.error('Expense history failed:', error.code || error.name); return res.status(500).json({ message: 'Expense history could not be loaded' }); }
};

exports.saveExpenseFile = async (req, res) => {
  try {
    await ensureExpenseTables();

    const expenseId = Number(req.params.id || 0);
    if (!expenseId) return res.status(400).json({ message: 'Expense ID is required' });
    if (!req.file) return res.status(400).json({ message: 'Choose a bill photo or file' });

    const [[expense]] = await pool.query('SELECT id FROM expenses WHERE id = ? AND deleted = 0 LIMIT 1', [expenseId]);
    if (!expense) return res.status(404).json({ message: 'Expense not found' });

    const fileData = req.file?.path ? await fs.promises.readFile(req.file.path).catch(() => null) : null;

    const [result] = await pool.query(
      `
      INSERT INTO expense_files
      (expense_id, original_name, file_path, mime_type, file_data, uploaded_by, classification, scan_status, size_bytes)
      VALUES (?, ?, ?, ?, ?, ?, 'RESTRICTED', 'UNAVAILABLE', ?)
      `,
      [expenseId, req.file.originalname, `/uploads/expenses/${req.file.filename}`, req.file.mimetype, fileData, req.user.id, Number(req.file.size || fileData?.length || 0)]
    );

    res.json({ message: 'Bill file uploaded successfully', file_id: result.insertId });
  } catch (error) {
    console.error('saveExpenseFile error:', error);
    res.status(500).json({ message: 'Failed to upload bill file', error: error.message });
  }
};

exports.viewExpenseFile = async (req, res) => {
  try {
    await ensureExpenseTables();

    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ message: 'File ID is required' });

    const [[file]] = await pool.query(
      'SELECT original_name, file_path, mime_type, file_data FROM expense_files WHERE id = ? AND deleted = 0 LIMIT 1',
      [id]
    );

    if (!file) return res.status(404).json({ message: 'Bill file not found' });

    let body = Buffer.isBuffer(file.file_data) && file.file_data.length ? file.file_data : null;
    if (!body) {
      const allowed = path.resolve(__dirname, '..', 'uploads', 'expenses') + path.sep;
      const candidate = path.resolve(__dirname, '..', String(file.file_path || '').replace(/^\//,''));
      if (!candidate.startsWith(allowed) || !fs.existsSync(candidate)) return res.status(404).json({message:'The original stored document bytes were not found.'});
      body = await fs.promises.readFile(candidate);
    }
    const artifact = await storedDocumentArtifact(body,file.original_name || `expense-bill-${id}`);
    await logSecurityEvent({actorId:req.user.id,eventType:'SENSITIVE_DOCUMENT_VIEWED',req,sessionId:req.session?.id,metadata:{module:'expense',fileId:id,pdfValidated:true}});
    return await sendPdfResponse(res,artifact,Boolean(req.query.download));

  } catch (error) {
    console.error('viewExpenseFile error:', error);
    res.status(error.status || 500).json({ code: error.code, message: 'Failed to open bill file', error: error.message });
  }
};

exports.deleteExpenseFile = async (req, res) => {
  try {
    await ensureExpenseTables();

    const id = Number(req.body.id || 0);
    if (!id) return res.status(400).json({ message: 'File ID is required' });

    const [[file]] = await pool.query('SELECT file_path FROM expense_files WHERE id = ? AND deleted = 0 LIMIT 1', [id]);
    const [result] = await pool.query('UPDATE expense_files SET deleted = 1 WHERE id = ?', [id]);

    if (result.affectedRows === 0) return res.status(404).json({ message: 'File not found' });

    // Archive metadata while retaining the authoritative attachment bytes.

    res.json({ message: 'Bill file deleted successfully' });
  } catch (error) {
    console.error('deleteExpenseFile error:', error);
    res.status(500).json({ message: 'Failed to delete bill file', error: error.message });
  }
};

exports.ensureExpenseTables = ensureExpenseTables;
