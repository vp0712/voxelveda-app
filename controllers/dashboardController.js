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
