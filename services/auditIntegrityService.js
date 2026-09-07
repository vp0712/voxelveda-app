const crypto = require('crypto');
const pool = require('../config/db');
const { canonicalAuditPayload, stableJsonText } = require('./auditService');
const { ensureSecurityGovernanceSchema } = require('./securityGovernanceSchema');

function jsonText(value) {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' ? value : stableJsonText(value);
}

async function verifyAuditChain(limit = 5000) {
  await ensureSecurityGovernanceSchema();
  const safeLimit = Math.min(50000, Math.max(1, Number(limit) || 5000));
  const [descending] = await pool.query(
    `SELECT id,actor_id,action,module,record_type,record_id,old_value,new_value,request_id,session_id,
            result,metadata_json,previous_integrity_hash,integrity_hash
     FROM audit_logs WHERE integrity_hash IS NOT NULL ORDER BY id DESC LIMIT ?`, [safeLimit]
  );
  const rows = descending.reverse();
  const failures = [];
  let expectedPrevious = rows[0]?.previous_integrity_hash || null;
  for (const row of rows) {
    if (row.previous_integrity_hash !== expectedPrevious) failures.push({ id: row.id, reason: 'PREDECESSOR_MISMATCH' });
    const payload = canonicalAuditPayload({
      previousHash: row.previous_integrity_hash, actorId: row.actor_id, action: row.action,
      module: row.module, recordType: row.record_type, recordId: row.record_id,
      oldValue: row.old_value, newValue: row.new_value, requestId: row.request_id,
      sessionId: row.session_id, result: row.result, metadata: jsonText(row.metadata_json)
    });
    const calculated = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    if (calculated !== row.integrity_hash) failures.push({ id: row.id, reason: 'CONTENT_HASH_MISMATCH' });
    expectedPrevious = row.integrity_hash;
  }
  return {
    valid: failures.length === 0,
    checked_records: rows.length,
    first_audit_id: rows[0]?.id || null,
    last_audit_id: rows.at(-1)?.id || null,
    window_limited: rows.length === safeLimit,
    failures: failures.slice(0, 20)
  };
}

module.exports = { verifyAuditChain };
