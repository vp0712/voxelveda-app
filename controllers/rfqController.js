const pool = require('../config/db');
const { logAudit } = require('../utils/auditHelper');

const RFQ_FLOW = {
  Pending: ['Approved', 'Rejected'],
  Approved: ['Quoted'],
  Quoted: ['Closed'],
  Rejected: [],
  Closed: []
};

function canTransition(current, next) {
  return (RFQ_FLOW[current] || []).includes(next);
}

exports.createRFQ = async (req, res) => {
  try {
    const {
      full_name,
      email,
      company_name,
      phone,
      material,
      quantity,
      dimensions,
      application,
      tolerance_req,
      surface_finish,
      deadline,
      delivery_location,
      additional_notes
    } = req.body;

    if (!full_name || !email || !material || !quantity || !application) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const [result] = await pool.query(
      `INSERT INTO rfqs
      (
        full_name,
        email,
        company_name,
        phone,
        material,
        quantity,
        dimensions,
        application,
        tolerance_req,
        surface_finish,
        deadline,
        delivery_location,
        additional_notes,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        full_name,
        email,
        company_name || '',
        phone || '',
        material,
        quantity,
        dimensions || '',
        application,
        tolerance_req || '',
        surface_finish || '',
        deadline || '',
        delivery_location || '',
        additional_notes || '',
        'Pending'
      ]
    );

    await logAudit({
      entity_type: 'rfq',
      entity_id: result.insertId,
      action: 'CREATED',
      new_status: 'Pending',
      meta: { email, material, quantity }
    });

    res.json({
      message: 'RFQ submitted successfully',
      id: result.insertId
    });
  } catch (error) {
    console.error('createRFQ error:', error);
    res.status(500).json({
      message: 'RFQ submission failed',
      error: error.message
    });
  }
};

exports.getRFQs = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM rfqs ORDER BY id DESC');
    res.json(rows);
  } catch (error) {
    console.error('getRFQs error:', error);
    res.status(500).json({
      message: 'Failed to load RFQs',
      error: error.message
    });
  }
};

exports.approveRFQ = async (req, res) => {
  try {
    const { rfq_id } = req.body;

    if (!rfq_id) {
      return res.status(400).json({ message: 'RFQ ID is required' });
    }

    const [rows] = await pool.query(
      'SELECT * FROM rfqs WHERE id = ? LIMIT 1',
      [rfq_id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'RFQ not found' });
    }

    const rfq = rows[0];

    if (!canTransition(rfq.status, 'Approved')) {
      return res.status(400).json({
        message: `Cannot approve RFQ from status ${rfq.status}`
      });
    }

    await pool.query(
      'UPDATE rfqs SET status = ?, approved_by = ?, approved_at = NOW() WHERE id = ?',
      ['Approved', req.user.id, rfq_id]
    );

    await logAudit({
      entity_type: 'rfq',
      entity_id: rfq_id,
      action: 'APPROVED',
      old_status: rfq.status,
      new_status: 'Approved',
      user_id: req.user.id
    });

    res.json({ message: 'RFQ approved successfully' });
  } catch (error) {
    console.error('approveRFQ error:', error);
    res.status(500).json({
      message: 'Failed to approve RFQ',
      error: error.message
    });
  }
};

exports.rejectRFQ = async (req, res) => {
  try {
    const { rfq_id } = req.body;

    if (!rfq_id) {
      return res.status(400).json({ message: 'RFQ ID is required' });
    }

    const [rows] = await pool.query(
      'SELECT * FROM rfqs WHERE id = ? LIMIT 1',
      [rfq_id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'RFQ not found' });
    }

    const rfq = rows[0];

    if (!canTransition(rfq.status, 'Rejected')) {
      return res.status(400).json({
        message: `Cannot reject RFQ from status ${rfq.status}`
      });
    }

    await pool.query(
      'UPDATE rfqs SET status = ? WHERE id = ?',
      ['Rejected', rfq_id]
    );

    await logAudit({
      entity_type: 'rfq',
      entity_id: rfq_id,
      action: 'REJECTED',
      old_status: rfq.status,
      new_status: 'Rejected',
      user_id: req.user.id
    });

    res.json({ message: 'RFQ rejected successfully' });
  } catch (error) {
    console.error('rejectRFQ error:', error);
    res.status(500).json({
      message: 'Failed to reject RFQ',
      error: error.message
    });
  }
};