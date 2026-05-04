const pool = require('../config/db');

exports.createRFQ = async (req, res) => {
  try {
    const { customer_name, email, phone, material, quantity, application } = req.body;

    const [result] = await pool.query(
      `INSERT INTO rfqs (customer_name, email, phone, material, quantity, application, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [customer_name, email, phone, material, quantity || 1, application]
    );

    res.json({ message: 'RFQ created successfully', rfq_id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: 'RFQ creation failed', error: err.message });
  }
};

exports.getRFQs = async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM rfqs ORDER BY id DESC');
  res.json({ rfqs: rows });
};

exports.approveRFQ = async (req, res) => {
  try {
    const { rfq_id } = req.body;

    const [[rfq]] = await pool.query(
      'SELECT * FROM rfqs WHERE id = ?',
      [rfq_id]
    );

    if (!rfq) {
      return res.status(404).json({ message: 'RFQ not found' });
    }

    if (String(rfq.status).toLowerCase() !== 'pending') {
      return res.status(400).json({
        message: `Cannot approve RFQ from status ${rfq.status}`
      });
    }

    await pool.query(
      "UPDATE rfqs SET status = 'approved' WHERE id = ?",
      [rfq_id]
    );

    res.json({ message: 'RFQ approved successfully' });
  } catch (err) {
    res.status(500).json({
      message: 'RFQ approval failed',
      error: err.message
    });
  }
};