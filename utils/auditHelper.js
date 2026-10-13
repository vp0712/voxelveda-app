const pool = require('../config/db');

async function logAudit({
  entity_type,
  entity_id,
  action,
  old_status = null,
  new_status = null,
  user_id = null,
  meta = {}
}) {
  await pool.query(
    `INSERT INTO audit_logs
    (entity_type, entity_id, action, old_status, new_status, user_id, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      entity_type,
      entity_id,
      action,
      old_status,
      new_status,
      user_id,
      JSON.stringify(meta)
    ]
  );
}

module.exports = { logAudit };