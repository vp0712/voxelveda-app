const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function ensureExpenseTables() {
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

async function getExpenseRows({ page = 1, limit = 25, search = '', fy = '' }) {
  const bounds = financialYearBounds(fy);
  const safeLimit = Math.min(Math.max(Number(limit || 25), 5), 200);
  const safePage = Math.max(Number(page || 1), 1);
  const offset = (safePage - 1) * safeLimit;
  const filters = ['e.deleted = 0'];
  const params = [];

  if (fy) {
    filters.push('e.expense_date BETWEEN ? AND ?');
    params.push(bounds.start, bounds.end);
  }

  if (search) {
    filters.push('(e.supplier_name LIKE ? OR e.category LIKE ? OR e.invoice_no LIKE ? OR e.description LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  const where = `WHERE ${filters.join(' AND ')}`;

  const [[countRow]] = await pool.query(`SELECT COUNT(*) AS total FROM expenses e ${where}`, params);

  const [rows] = await pool.query(
    `
    SELECT e.*, cu.name AS created_by_name, uu.name AS updated_by_name,
      COALESCE(f.file_count, 0) AS file_count
    FROM expenses e
    LEFT JOIN users cu ON cu.id = e.created_by
    LEFT JOIN users uu ON uu.id = e.updated_by
    LEFT JOIN (
      SELECT expense_id, COUNT(*) AS file_count
      FROM expense_files
      WHERE deleted = 0
      GROUP BY expense_id
    ) f ON f.expense_id = e.id
    ${where}
    ORDER BY e.id ASC
    LIMIT ? OFFSET ?
    `,
    [...params, safeLimit, offset]
  );

  const ids = rows.map((row) => Number(row.id)).filter(Boolean);
  if (ids.length) {
    const [files] = await pool.query(
      `
      SELECT ef.*, u.name AS uploaded_by_name
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
      acc[key].push(file);
      return acc;
    }, {});

    rows.forEach((row) => {
      row.files = filesByExpense[String(row.id)] || [];
      row.file_count = row.files.length;
    });
  } else {
    rows.forEach((row) => {
      row.files = [];
    });
  }

  return {
    rows,
    total: Number(countRow.total || 0),
    page: safePage,
    limit: safeLimit
  };
}

async function getExpenseSummary(fy = '') {
  const hasFinancialYear = String(fy || '').trim() !== '';
  const bounds = financialYearBounds(fy);
  const expenseDateWhere = hasFinancialYear ? 'AND expense_date BETWEEN ? AND ?' : '';
  const invoiceDateWhere = hasFinancialYear ? 'AND created_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)' : '';
  const expenseDateParams = hasFinancialYear ? [bounds.start, bounds.end] : [];
  const invoiceDateParams = hasFinancialYear ? [bounds.start, bounds.end] : [];

  const [[expenses]] = await pool.query(
    `
    SELECT
      COALESCE(SUM(total_amount), 0) AS total_expense,
      COALESCE(SUM(gst_amount), 0) AS gst_paid,
      COUNT(*) AS expense_count
    FROM expenses
    WHERE deleted = 0
    ${expenseDateWhere}
    `,
    expenseDateParams
  );

  const [[invoices]] = await pool.query(
    `
    SELECT
      COALESCE(SUM(total - (total / (1 + (gst_rate / 100)))), 0) AS gst_collected,
      COALESCE(SUM(total), 0) AS invoice_value
    FROM invoices
    WHERE (deleted = 0 OR deleted IS NULL)
    ${invoiceDateWhere}
    `,
    invoiceDateParams
  ).catch(() => [[{ gst_collected: 0, invoice_value: 0 }]]);

  const [categoryRows] = await pool.query(
    `
    SELECT COALESCE(NULLIF(category, ''), 'Uncategorised') AS category,
           COALESCE(SUM(total_amount), 0) AS total_amount
    FROM expenses
    WHERE deleted = 0
    ${expenseDateWhere}
    GROUP BY COALESCE(NULLIF(category, ''), 'Uncategorised')
    ORDER BY total_amount DESC
    LIMIT 12
    `,
    expenseDateParams
  );

  const [monthRows] = await pool.query(
    `
    SELECT DATE_FORMAT(expense_date, '%Y-%m') AS month,
           COALESCE(SUM(total_amount), 0) AS total_amount
    FROM expenses
    WHERE deleted = 0
    ${expenseDateWhere}
    GROUP BY DATE_FORMAT(expense_date, '%Y-%m')
    ORDER BY month ASC
    `,
    expenseDateParams
  );

  return {
    financial_year: hasFinancialYear ? `${bounds.startYear}-${bounds.startYear + 1}` : 'All years',
    start: hasFinancialYear ? bounds.start : null,
    end: hasFinancialYear ? bounds.end : null,
    expense_count: Number(expenses.expense_count || 0),
    total_expense: Number(expenses.total_expense || 0),
    gst_paid: Number(expenses.gst_paid || 0),
    gst_collected: Number(invoices.gst_collected || 0),
    gst_position: Number(invoices.gst_collected || 0) - Number(expenses.gst_paid || 0),
    invoice_value: Number(invoices.invoice_value || 0),
    categories: categoryRows,
    months: monthRows
  };
}

exports.getExpenses = async (req, res) => {
  try {
    await ensureExpenseTables();

    const result = await getExpenseRows({
      page: req.query.page,
      limit: req.query.limit,
      search: String(req.query.search || '').trim(),
      fy: req.query.fy
    });
    const summary = await getExpenseSummary(req.query.fy);

    res.json({ expenses: result.rows, total: result.total, page: result.page, limit: result.limit, summary });
  } catch (error) {
    console.error('getExpenses error:', error);
    res.status(500).json({ message: 'Failed to load expenses', error: error.message });
  }
};

exports.saveExpense = async (req, res) => {
  try {
    await ensureExpenseTables();

    const id = Number(req.body.id || 0);
    const expenseDate = String(req.body.expense_date || '').trim();
    const supplierName = String(req.body.supplier_name || '').trim();
    const category = String(req.body.category || '').trim();
    const description = String(req.body.description || '').trim();
    const invoiceNo = String(req.body.invoice_no || '').trim();
    const paymentMethod = String(req.body.payment_method || '').trim();
    const amountExGst = cleanMoney(req.body.amount_ex_gst);
    const gstRate = cleanMoney(req.body.gst_rate);
    const gstAmount = cleanMoney(req.body.gst_amount || (amountExGst * (gstRate / 100)));
    const totalAmount = cleanMoney(req.body.total_amount || (amountExGst + gstAmount));
    const status = String(req.body.status || 'paid').trim().toLowerCase();
    const notes = String(req.body.notes || '').trim();

    if (!expenseDate || !supplierName || !description) {
      return res.status(400).json({ message: 'Expense date, supplier and description are required' });
    }

    if (totalAmount <= 0) {
      return res.status(400).json({ message: 'Expense amount must be greater than zero' });
    }

    if (id) {
      const [result] = await pool.query(
        `
        UPDATE expenses
        SET expense_date = ?, supplier_name = ?, category = ?, description = ?, invoice_no = ?,
            payment_method = ?, amount_ex_gst = ?, gst_rate = ?, gst_amount = ?, total_amount = ?,
            status = ?, notes = ?, updated_by = ?
        WHERE id = ? AND deleted = 0
        `,
        [expenseDate, supplierName, category, description, invoiceNo, paymentMethod, amountExGst, gstRate, gstAmount, totalAmount, status, notes, req.user.id, id]
      );

      if (result.affectedRows === 0) return res.status(404).json({ message: 'Expense not found' });
      return res.json({ message: 'Expense updated successfully', expense_id: id });
    }

    const [result] = await pool.query(
      `
      INSERT INTO expenses
      (expense_date, supplier_name, category, description, invoice_no, payment_method,
       amount_ex_gst, gst_rate, gst_amount, total_amount, status, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [expenseDate, supplierName, category, description, invoiceNo, paymentMethod, amountExGst, gstRate, gstAmount, totalAmount, status, notes, req.user.id]
    );

    res.json({ message: 'Expense saved successfully', expense_id: result.insertId });
  } catch (error) {
    console.error('saveExpense error:', error);
    res.status(500).json({ message: 'Failed to save expense', error: error.message });
  }
};

exports.deleteExpense = async (req, res) => {
  try {
    await ensureExpenseTables();

    const id = Number(req.body.id || 0);
    if (!id) return res.status(400).json({ message: 'Expense ID is required' });

    const [result] = await pool.query(
      'UPDATE expenses SET deleted = 1, updated_by = ? WHERE id = ?',
      [req.user.id, id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ message: 'Expense not found' });
    res.json({ message: 'Expense deleted successfully' });
  } catch (error) {
    console.error('deleteExpense error:', error);
    res.status(500).json({ message: 'Failed to delete expense', error: error.message });
  }
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
      (expense_id, original_name, file_path, mime_type, file_data, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [expenseId, req.file.originalname, `/uploads/expenses/${req.file.filename}`, req.file.mimetype, fileData, req.user.id]
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

    const mimeType = file.mime_type || 'application/octet-stream';
    const safeName = String(file.original_name || `expense-bill-${id}`).replace(/"/g, '');
    const dbBuffer = file.file_data && Buffer.isBuffer(file.file_data) ? file.file_data : null;

    if (dbBuffer && dbBuffer.length) {
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
      return res.send(dbBuffer);
    }

    const filePath = file.file_path ? path.join(__dirname, '..', file.file_path.replace(/^\//, '')) : '';
    if (filePath && filePath.includes(`${path.sep}uploads${path.sep}expenses${path.sep}`) && fs.existsSync(filePath)) {
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
      return fs.createReadStream(filePath).pipe(res);
    }

    return res.status(404).json({
      message: 'This bill photo is no longer available on the server. Please upload the bill again so it can be stored permanently.'
    });
  } catch (error) {
    console.error('viewExpenseFile error:', error);
    res.status(500).json({ message: 'Failed to open bill file', error: error.message });
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

    const filePath = file?.file_path ? path.join(__dirname, '..', file.file_path.replace(/^\//, '')) : '';
    if (filePath && filePath.includes(`${path.sep}uploads${path.sep}expenses${path.sep}`)) {
      fs.unlink(filePath, () => {});
    }

    res.json({ message: 'Bill file deleted successfully' });
  } catch (error) {
    console.error('deleteExpenseFile error:', error);
    res.status(500).json({ message: 'Failed to delete bill file', error: error.message });
  }
};
