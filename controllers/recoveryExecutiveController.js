const pool = require('../config/db');
const { buildExecutiveOversight } = require('../services/recoveryExecutiveOversight');

function safeError(res, error) {
  console.error('Recovery executive oversight failed.', error);
  return res.status(500).json({ message: 'Recovery executive oversight is temporarily unavailable.', code: 'RECOVERY_EXECUTIVE_OVERSIGHT_FAILED' });
}

exports.status = async (req, res) => {
  try {
    const [remediationRows] = await pool.query(`
      SELECT id,drill_id,title,source_severity,priority,status,owner_label,due_at,created_at,updated_at,closed_at
      FROM recovery_remediation_items
      ORDER BY created_at DESC
      LIMIT 500
    `);
    const [drillRows] = await pool.query(`
      SELECT id,title,status,final_decision,rpo_objective_status,rto_objective_status,created_at,finalized_at
      FROM recovery_drill_records
      ORDER BY created_at DESC
      LIMIT 300
    `);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return res.json(buildExecutiveOversight({ remediationRows, drillRows }));
  } catch (error) {
    return safeError(res, error);
  }
};
