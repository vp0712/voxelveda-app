const pool = require('../config/db');

async function ensureDashboardTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      invoice_no VARCHAR(80) NULL,
      rfq_id INT NULL,
      customer_name VARCHAR(255) NULL,
      customer_email VARCHAR(255) NULL,
      description TEXT NULL,
      quantity DECIMAL(12,3) NOT NULL DEFAULT 1,
      unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      gst_rate DECIMAL(5,2) NOT NULL DEFAULT 10,
      total DECIMAL(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(40) NOT NULL DEFAULT 'draft',
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`ALTER TABLE invoices ADD COLUMN deleted TINYINT(1) NOT NULL DEFAULT 0`).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS invoice_payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      invoice_id INT NOT NULL,
      amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      payment_date DATE NULL,
      method VARCHAR(80) NULL,
      reference VARCHAR(120) NULL,
      notes TEXT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_invoice_payments_invoice_id (invoice_id)
    )
  `);

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
      INDEX idx_expense_payments_expense (expense_id, payment_date)
    )
  `);
}

exports.getDashboardStats = async (req, res) => {
  try {
    await ensureDashboardTables();
    const now = new Date();
    const fyStartYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    const fyStart = `${fyStartYear}-07-01`;
    const fyEnd = `${fyStartYear + 1}-06-30`;

    const [[rfqStats]] = await pool.query(`
      SELECT
        COUNT(*) AS total_rfqs,
        SUM(LOWER(status) = 'pending') AS pending_rfqs,
        SUM(LOWER(status) = 'approved') AS approved_rfqs,
        SUM(LOWER(status) = 'quoted') AS quoted_rfqs
      FROM rfqs
    `);

    const [[invoiceStats]] = await pool.query(`
      SELECT
        COUNT(*) AS total_invoices,
        SUM(LOWER(status) = 'draft') AS draft_invoices,
        SUM(LOWER(status) = 'approved') AS approved_invoices,
        SUM(LOWER(status) = 'sent') AS sent_invoices,
        SUM(LOWER(status) = 'paid') AS paid_invoices,
        COALESCE(SUM(CASE WHEN LOWER(status) = 'paid' THEN total ELSE 0 END), 0) AS paid_revenue,
        COALESCE(SUM(total), 0) AS total_invoice_value
      FROM invoices
      WHERE deleted = 0 OR deleted IS NULL
    `);

    const [[paymentStats]] = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) AS collected_revenue
      FROM invoice_payments
      WHERE payment_date BETWEEN ? AND ?
    `, [fyStart, fyEnd]);

    const [[expenseStats]] = await pool.query(`
      SELECT
        COUNT(*) AS total_expenses,
        COALESCE(SUM(total_amount), 0) AS total_expense_value,
        COALESCE(SUM(gst_amount), 0) AS gst_paid
      FROM expenses
      WHERE deleted = 0
      AND expense_date BETWEEN ? AND ?
    `, [fyStart, fyEnd]);

    const [[gstCollectedRow]] = await pool.query(`
      SELECT COALESCE(SUM(total - (total / (1 + (gst_rate / 100)))), 0) AS gst_collected
      FROM invoices
      WHERE (deleted = 0 OR deleted IS NULL)
      AND created_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)
    `, [fyStart, fyEnd]);

    const [financeMonths] = await pool.query(`
      SELECT month_key, SUM(revenue) AS revenue, SUM(expenses) AS expenses
      FROM (
        SELECT DATE_FORMAT(payment_date, '%Y-%m') AS month_key, SUM(amount) AS revenue, 0 AS expenses
        FROM invoice_payments
        WHERE payment_date BETWEEN ? AND ?
        GROUP BY DATE_FORMAT(payment_date, '%Y-%m')
        UNION ALL
        SELECT DATE_FORMAT(expense_date, '%Y-%m') AS month_key, 0 AS revenue, SUM(total_amount) AS expenses
        FROM expenses
        WHERE deleted = 0
        AND expense_date BETWEEN ? AND ?
        GROUP BY DATE_FORMAT(expense_date, '%Y-%m')
      ) x
      GROUP BY month_key
      ORDER BY month_key ASC
    `, [fyStart, fyEnd, fyStart, fyEnd]);

    const paidStatusSql = `LOWER(COALESCE(e.status, '')) IN ('paid', 'settled', 'complete', 'completed', 'reimbursed', 'closed')`;
    const paidAmountSql = `CASE WHEN COALESCE(p.payment_count, 0) > 0 THEN LEAST(e.total_amount, COALESCE(p.payment_total, 0)) WHEN ${paidStatusSql} THEN e.total_amount ELSE 0 END`;
    const balanceDueSql = `GREATEST(e.total_amount - (${paidAmountSql}), 0)`;
    const paymentJoinSql = `LEFT JOIN (SELECT expense_id, COUNT(*) AS payment_count, SUM(amount) AS payment_total FROM expense_payments WHERE voided_at IS NULL GROUP BY expense_id) p ON p.expense_id = e.id`;
    const [[supplierPayableSummary]] = await pool.query(`
      SELECT
        COUNT(*) AS bill_count,
        COUNT(DISTINCT NULLIF(TRIM(e.supplier_name), '')) AS supplier_count,
        COALESCE(SUM(${paidAmountSql}), 0) AS paid_value,
        COALESCE(SUM(${balanceDueSql}), 0) AS pending_value,
        COALESCE(SUM(CASE WHEN ${balanceDueSql} > 0 AND COALESCE(e.due_date, DATE_ADD(e.expense_date, INTERVAL 30 DAY)) < CURDATE() THEN ${balanceDueSql} ELSE 0 END), 0) AS overdue_value,
        COALESCE(SUM(CASE WHEN ${balanceDueSql} > 0 AND COALESCE(e.due_date, DATE_ADD(e.expense_date, INTERVAL 30 DAY)) >= CURDATE() THEN ${balanceDueSql} ELSE 0 END), 0) AS upcoming_value,
        SUM(CASE WHEN ${balanceDueSql} > 0 THEN 1 ELSE 0 END) AS pending_count,
        MIN(CASE WHEN ${balanceDueSql} > 0 THEN COALESCE(e.due_date, DATE_ADD(e.expense_date, INTERVAL 30 DAY)) ELSE NULL END) AS next_due_date
      FROM expenses e
      ${paymentJoinSql}
      WHERE e.deleted = 0
      AND e.expense_date BETWEEN ? AND ?
    `, [fyStart, fyEnd]);

    const [[nextSupplierPayment]] = await pool.query(`
      SELECT
        COALESCE(NULLIF(TRIM(e.supplier_name), ''), 'Unassigned supplier') AS supplier_name,
        e.category, e.invoice_no, e.total_amount, ${balanceDueSql} AS balance_due, e.expense_date,
        COALESCE(e.due_date, DATE_ADD(e.expense_date, INTERVAL 30 DAY)) AS due_date
      FROM expenses e
      ${paymentJoinSql}
      WHERE e.deleted = 0
      AND e.expense_date BETWEEN ? AND ?
      AND ${balanceDueSql} > 0
      ORDER BY COALESCE(e.due_date, DATE_ADD(e.expense_date, INTERVAL 30 DAY)) ASC, e.id ASC
      LIMIT 1
    `, [fyStart, fyEnd]);

    const [supplierCategories] = await pool.query(`
      SELECT
        CASE
          WHEN LOWER(COALESCE(e.category, '')) LIKE '%raw%' THEN 'Raw Material'
          WHEN LOWER(COALESCE(e.category, '')) LIKE '%pack%' THEN 'Packaging'
          WHEN LOWER(COALESCE(e.category, '')) LIKE '%fuel%' THEN 'Fuel'
          WHEN LOWER(COALESCE(e.category, '')) LIKE '%machin%' THEN 'Machinery'
          WHEN LOWER(COALESCE(e.category, '')) LIKE '%tool%' THEN 'Tools'
          WHEN LOWER(COALESCE(e.category, '')) LIKE '%freight%' OR LOWER(COALESCE(e.category, '')) LIKE '%delivery%' THEN 'Freight'
          ELSE COALESCE(NULLIF(TRIM(e.category), ''), 'Other')
        END AS category,
        COUNT(*) AS bill_count,
        COALESCE(SUM(${paidAmountSql}), 0) AS paid_value,
        COALESCE(SUM(${balanceDueSql}), 0) AS pending_value
      FROM expenses e
      ${paymentJoinSql}
      WHERE e.deleted = 0
      AND e.expense_date BETWEEN ? AND ?
      GROUP BY 1
      ORDER BY pending_value DESC, paid_value DESC
      LIMIT 8
    `, [fyStart, fyEnd]);

    const [supplierExposure] = await pool.query(`
      SELECT
        COALESCE(NULLIF(TRIM(e.supplier_name), ''), 'Unassigned supplier') AS supplier_name,
        COUNT(*) AS bill_count,
        COALESCE(SUM(${paidAmountSql}), 0) AS paid_value,
        COALESCE(SUM(${balanceDueSql}), 0) AS pending_value,
        MIN(CASE WHEN ${balanceDueSql} > 0 THEN COALESCE(e.due_date, DATE_ADD(e.expense_date, INTERVAL 30 DAY)) ELSE NULL END) AS next_due_date
      FROM expenses e
      ${paymentJoinSql}
      WHERE e.deleted = 0
      AND e.expense_date BETWEEN ? AND ?
      GROUP BY 1
      ORDER BY pending_value DESC, paid_value DESC
      LIMIT 6
    `, [fyStart, fyEnd]);

    const [upcomingSupplierPayments] = await pool.query(`
      SELECT
        e.id,
        COALESCE(NULLIF(TRIM(e.supplier_name), ''), 'Unassigned supplier') AS supplier_name,
        COALESCE(NULLIF(TRIM(e.category), ''), 'Other') AS category,
        e.invoice_no, e.total_amount, ${balanceDueSql} AS balance_due, e.expense_date,
        COALESCE(e.due_date, DATE_ADD(e.expense_date, INTERVAL 30 DAY)) AS due_date
      FROM expenses e
      ${paymentJoinSql}
      WHERE e.deleted = 0
      AND e.expense_date BETWEEN ? AND ?
      AND ${balanceDueSql} > 0
      ORDER BY COALESCE(e.due_date, DATE_ADD(e.expense_date, INTERVAL 30 DAY)) ASC, ${balanceDueSql} DESC
      LIMIT 6
    `, [fyStart, fyEnd]);

    const collectedRevenue = Number(paymentStats.collected_revenue || 0);
    const expenses = Number(expenseStats.total_expense_value || 0);

    res.json({
      rfqs: rfqStats,
      invoices: invoiceStats,
      finance: {
        financial_year: `${fyStartYear}-${fyStartYear + 1}`,
        fy_start: fyStart,
        fy_end: fyEnd,
        revenue: collectedRevenue,
        expenses,
        net_worth: collectedRevenue - expenses,
        gst_paid: Number(expenseStats.gst_paid || 0),
        gst_collected: Number(gstCollectedRow.gst_collected || 0),
        gst_position: Number(gstCollectedRow.gst_collected || 0) - Number(expenseStats.gst_paid || 0),
        total_expenses: Number(expenseStats.total_expenses || 0),
        months: financeMonths
      },
      supplier_payables: {
        financial_year: `${fyStartYear}-${fyStartYear + 1}`,
        bill_count: Number(supplierPayableSummary.bill_count || 0),
        supplier_count: Number(supplierPayableSummary.supplier_count || 0),
        paid_value: Number(supplierPayableSummary.paid_value || 0),
        pending_value: Number(supplierPayableSummary.pending_value || 0),
        overdue_value: Number(supplierPayableSummary.overdue_value || 0),
        upcoming_value: Number(supplierPayableSummary.upcoming_value || 0),
        pending_count: Number(supplierPayableSummary.pending_count || 0),
        next_due_date: supplierPayableSummary.next_due_date,
        next_payment: nextSupplierPayment || null,
        categories: supplierCategories,
        suppliers: supplierExposure,
        upcoming: upcomingSupplierPayments
      }
    });
  } catch (error) {
    console.error('getDashboardStats error:', error);
    res.status(500).json({
      message: 'Failed to load dashboard stats',
      error: error.message
    });
  }
};
