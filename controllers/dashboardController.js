const pool = require('../config/db');

exports.getDashboardStats = async (req, res) => {
  try {
    const [[rfqStats]] = await pool.query(`
      SELECT
        COUNT(*) AS total_rfqs,
        SUM(status = 'Pending') AS pending_rfqs,
        SUM(status = 'Approved') AS approved_rfqs,
        SUM(status = 'Quoted') AS quoted_rfqs
      FROM rfqs
    `);

    const [[invoiceStats]] = await pool.query(`
      SELECT
        COUNT(*) AS total_invoices,
        SUM(status = 'Draft') AS draft_invoices,
        SUM(status = 'Approved') AS approved_invoices,
        SUM(status = 'Sent') AS sent_invoices,
        SUM(status = 'Paid') AS paid_invoices,
        COALESCE(SUM(CASE WHEN status = 'Paid' THEN total ELSE 0 END), 0) AS paid_revenue,
        COALESCE(SUM(total), 0) AS total_invoice_value
      FROM invoices
    `);

    res.json({
      rfqs: rfqStats,
      invoices: invoiceStats
    });
  } catch (error) {
    console.error('getDashboardStats error:', error);
    res.status(500).json({
      message: 'Failed to load dashboard stats',
      error: error.message
    });
  }
};