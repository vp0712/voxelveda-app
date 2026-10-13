const crypto = require('crypto');
const pool = require('../config/db');
const { redactSensitive } = require('../utils/securityRedaction');

async function queueSecurityEvent(eventType, payload, connection = pool) {
  const safe = redactSensitive(payload || {});
  const body = JSON.stringify(safe);
  const id = crypto.randomUUID();
  await connection.query(`INSERT INTO security_event_outbox
    (id,event_type,destination_key,payload_json,payload_sha256,status)
    VALUES (?,?,?,?,?,'PENDING')`, [id, String(eventType).slice(0,100), process.env.SECURITY_EVENT_DESTINATION || 'UNCONFIGURED', body, crypto.createHash('sha256').update(body).digest('hex')]);
  return id;
}

module.exports = { queueSecurityEvent };
