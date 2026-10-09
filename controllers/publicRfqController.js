const pool = require('../config/db');
const { publicRfqContract } = require('../middleware/publicEndpointProtection');

// Public enquiries retain the existing intake contract and pending RFQ records.
// Operational listing and approval belong to the retired ERP and are not exposed here.
exports.createRFQ = async (req, res) => {
  let valid = false;
  publicRfqContract(req, res, () => { valid = true; });
  if (!valid) return;

  const body = req.body;
  const values = [
    body.customer_name.trim(),
    body.email.trim(),
    typeof body.phone === 'string' ? body.phone.trim() : '',
    typeof body.material === 'string' ? body.material.trim() : '',
    Number(body.quantity),
    typeof body.application === 'string' ? body.application.trim() : '',
    'pending'
  ];

  try {
    const [result] = await pool.query(
      `INSERT INTO rfqs
       (customer_name, email, phone, material, quantity, application, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      values
    );
    return res.json({ message: 'RFQ created successfully', rfq_id: result.insertId });
  } catch (error) {
    // Neither enquiry contents nor provider/database details belong in public errors.
    console.error('Public RFQ intake failed:', error?.code || 'RFQ_INSERT_FAILED');
    return res.status(500).json({ message: 'RFQ submission could not be saved. Please try again.' });
  }
};
