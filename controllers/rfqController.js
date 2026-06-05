const pool = require('../config/db');

exports.getRFQs = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM rfqs ORDER BY id ASC');
    res.json({ rfqs: rows });
  } catch (err) {
    console.error('GET RFQS ERROR FULL:', err);
    res.status(500).json({
      message: 'Failed to load RFQs',
      error: err.message
    });
  }
};

exports.createRFQ = async (req, res) => {
  try {
    const customer_name = req.body.customer_name?.trim();
    const email = req.body.email?.trim();
    const phone = req.body.phone?.trim() || '';
    const material = req.body.material?.trim() || '';
    const quantity = Number(req.body.quantity || 1);
    const application = req.body.application?.trim() || '';

    if (!customer_name || !email) {
      return res.status(400).json({
        message: 'Customer name and email are required'
      });
    }

    if (Number.isNaN(quantity) || quantity <= 0) {
      return res.status(400).json({
        message: 'Quantity must be a valid number'
      });
    }

    const [result] = await pool.query(
      `
      INSERT INTO rfqs
      (customer_name, email, phone, material, quantity, application, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        customer_name,
        email,
        phone,
        material,
        quantity,
        application,
        'pending'
      ]
    );

    res.json({
      message: 'RFQ created successfully',
      rfq_id: result.insertId
    });
  } catch (err) {
    console.error('CREATE RFQ ERROR FULL:', err);
    res.status(500).json({
      message: 'RFQ creation failed',
      error: err.message
    });
  }
};

exports.approveRFQ = async (req, res) => {
  try {
    const { rfq_id } = req.body;

    if (!rfq_id) {
      return res.status(400).json({
        message: 'RFQ ID is required'
      });
    }

    const [result] = await pool.query(
      "UPDATE rfqs SET status = 'approved' WHERE id = ?",
      [rfq_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: 'RFQ not found'
      });
    }

    res.json({
      message: 'RFQ approved successfully'
    });
  } catch (err) {
    console.error('APPROVE RFQ ERROR FULL:', err);
    res.status(500).json({
      message: 'RFQ approval failed',
      error: err.message
    });
  }
};

exports.rejectRFQ = async (req, res) => {
  try {
    const { rfq_id } = req.body;

    if (!rfq_id) {
      return res.status(400).json({
        message: 'RFQ ID is required'
      });
    }

    const [result] = await pool.query(
      "UPDATE rfqs SET status = 'rejected' WHERE id = ?",
      [rfq_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: 'RFQ not found'
      });
    }

    res.json({
      message: 'RFQ rejected successfully'
    });
  } catch (err) {
    console.error('REJECT RFQ ERROR FULL:', err);
    res.status(500).json({
      message: 'RFQ rejection failed',
      error: err.message
    });
  }
};

exports.closeRFQ = async (req, res) => {
  try {
    const { rfq_id } = req.body;

    if (!rfq_id) {
      return res.status(400).json({
        message: 'RFQ ID is required'
      });
    }

    const [result] = await pool.query(
      "UPDATE rfqs SET status = 'closed' WHERE id = ?",
      [rfq_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: 'RFQ not found'
      });
    }

    res.json({
      message: 'RFQ closed successfully'
    });
  } catch (err) {
    console.error('CLOSE RFQ ERROR FULL:', err);
    res.status(500).json({
      message: 'RFQ close failed',
      error: err.message
    });
  }
};
