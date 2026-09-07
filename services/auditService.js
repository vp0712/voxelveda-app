const crypto = require('crypto');
const { redactSensitive } = require('../utils/securityRedaction');
const { ensureSecurityGovernanceSchema } = require('./securityGovernanceSchema');

function stableJsonText(value) {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return `[${value.map((item) => stableJsonText(item) ?? 'null').join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value).sort().map((key) => [key, stableJsonText(value[key])]).filter(([, encoded]) => encoded !== undefined);
    return `{${entries.map(([key, encoded]) => `${JSON.stringify(key)}:${encoded}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function serialize(value) {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' ? value.slice(0, 4000) : stableJsonText(redactSensitive(value));
}

function canonicalAuditPayload(entry) {
  return {
    previousHash: entry.previousHash || null,
    actorId: entry.actorId === undefined || entry.actorId === null ? null : Number(entry.actorId),
    action: String(entry.action),
    module: String(entry.module),
    recordType: entry.recordType ? String(entry.recordType) : null,
    recordId: String(entry.recordId || ''),
    oldValue: entry.oldValue ?? null,
    newValue: entry.newValue ?? null,
    requestId: entry.requestId ? String(entry.requestId) : null,
    sessionId: entry.sessionId ? String(entry.sessionId) : null,
    result: String(entry.result || 'SUCCESS'),
    metadata: entry.metadata ?? null
  };
}

async function logAudit(db, entry) {
  await ensureSecurityGovernanceSchema();
  const connection = typeof db.getConnection === 'function' ? await db.getConnection() : db;
  const shouldRelease = connection !== db;
  const oldValue = serialize(redactSensitive(entry.oldValue));
  const newValue = serialize(redactSensitive(entry.newValue));
  const metadata = serialize(redactSensitive(entry.metadata));
  let locked = false;
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK('voxelveda_audit_chain', 5) AS acquired");
    locked = Number(lock?.acquired) === 1;
    if (!locked) throw new Error('Audit integrity lock unavailable');
    // The row lock remains held until the caller commits, preventing two concurrent
    // transactions from creating sibling hashes even after the advisory lock is released.
    const [[previous]] = await connection.query('SELECT integrity_hash FROM audit_logs WHERE integrity_hash IS NOT NULL ORDER BY id DESC LIMIT 1 FOR UPDATE');
    const previousHash = previous?.integrity_hash || null;
    const payload = canonicalAuditPayload({ ...entry, previousHash, oldValue, newValue, metadata });
    const canonical = JSON.stringify(payload);
    const integrityHash = crypto.createHash('sha256').update(canonical).digest('hex');
    await connection.query(
    `
    INSERT INTO audit_logs
    (actor_id,action,module,record_type,record_id,old_value,new_value,ip_address,user_agent,
     request_id,session_id,result,metadata_json,previous_integrity_hash,integrity_hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `,
    [
      payload.actorId,
      payload.action,
      payload.module,
      payload.recordType,
      payload.recordId,
      oldValue,
      newValue,
      entry.ipAddress || null,
      entry.userAgent || null,
      payload.requestId,
      payload.sessionId,
      payload.result,
      metadata,
      previousHash,
      integrityHash
    ]
    );
    return integrityHash;
  } finally {
    if (locked) await connection.query("SELECT RELEASE_LOCK('voxelveda_audit_chain')").catch(() => {});
    if (shouldRelease) connection.release();
  }
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

module.exports = { canonicalAuditPayload, logAudit, logActivity, stableJsonText };
