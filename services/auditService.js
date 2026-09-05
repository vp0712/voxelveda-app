const { redactSensitive } = require('../utils/securityRedaction');

function serialize(value) {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' ? value.slice(0, 4000) : JSON.stringify(redactSensitive(value));
}

async function logAudit(db, entry) {
  await db.query(
    `
    INSERT INTO audit_logs
    (actor_id, action, module, record_type, record_id, old_value, new_value, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      entry.actorId || null,
      entry.action,
      entry.module,
      entry.recordType || null,
      String(entry.recordId || ''),
      serialize(redactSensitive(entry.oldValue)),
      serialize(redactSensitive(entry.newValue)),
      entry.ipAddress || null,
      entry.userAgent || null
    ]
  );
}

async function logActivity(db, entry) {
  await db.query(
    `
    INSERT INTO activity_logs
    (module, record_id, event_type, message, actor_id, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      entry.module,
      String(entry.recordId || ''),
      entry.eventType,
      entry.message || null,
      entry.actorId || null,
      serialize(redactSensitive(entry.metadata))
    ]
  );
}

module.exports = { logAudit, logActivity };
