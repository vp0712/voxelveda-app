const pool = require('../config/db');

exports.getDashboardStats = async (req, res) => {
  try {
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
