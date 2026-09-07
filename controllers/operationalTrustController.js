const crypto = require('crypto');
const pool = require('../config/db');
const { ensureOperationalTrustSchema } = require('../services/operationalTrustSchema');
const { ensureSecurityOperationsSchema } = require('../services/securityOperationsSchema');
const { createApiToken } = require('../services/apiTokenService');
const { effectivePermissions } = require('../services/authorizationService');
const { logAudit } = require('../services/auditService');
const { logSecurityEvent } = require('../services/sessionService');
const { sanitizeAiValue, enforceAiAction } = require('../services/aiSecurityPolicy');
const { evaluateSecurityAlerts } = require('../services/securityAlertService');

const EXPORT_TYPES = new Set(['FINANCE', 'BANKING', 'PAYROLL', 'STAFF', 'CUSTOMERS', 'ACCOUNTANT_PACK']);
const SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);
const RETENTION_CATEGORIES = new Set(['AUTH_SESSIONS', 'SECURITY_EVENTS', 'API_TOKENS', 'WEBHOOK_RECEIPTS', 'SECURITY_REPORTS']);
const RETENTION_TABLES = Object.freeze({
  AUTH_SESSIONS: ['auth_sessions', 'created_at'], SECURITY_EVENTS: ['security_events', 'created_at'],
  API_TOKENS: ['user_api_tokens', 'created_at'], WEBHOOK_RECEIPTS: ['webhook_receipts', 'received_at'],
  SECURITY_REPORTS: ['security_report_snapshots', 'created_at']
});

function text(value, max = 500) { return String(value || '').trim().slice(0, max); }
function jsonArray(value) { return [...new Set((Array.isArray(value) ? value : []).map((item) => text(item, 100).toUpperCase()).filter(Boolean))]; }
function isSuperAdmin(req) { return String(req.user?.role || '').toLowerCase() === 'super_admin'; }
function digest(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }

async function schemas() { await Promise.all([ensureOperationalTrustSchema(), ensureSecurityOperationsSchema()]); }
async function audit(req, action, recordType, recordId, value) {
  await logAudit(pool, { actorId: req.user.id, action, module: 'security', recordType, recordId, newValue: sanitizeAiValue(value), ipAddress: req.ip, userAgent: req.get('user-agent') });
  await logSecurityEvent({ actorId: req.user.id, eventType: action, req, sessionId: req.session?.id, metadata: sanitizeAiValue(value) });
}

exports.summary = async (req, res, next) => {
  try {
    await schemas();
    const [results] = await Promise.all([
      pool.query('SELECT COUNT(*) count FROM user_api_tokens WHERE revoked_at IS NULL AND expires_at > NOW()'),
      pool.query('SELECT COUNT(*) count FROM webhook_sources WHERE active = 1'),
      pool.query("SELECT COUNT(*) count FROM sensitive_export_requests WHERE status = 'PENDING_APPROVAL' AND expires_at > NOW()"),
      pool.query('SELECT COUNT(*) count FROM retention_holds WHERE active = 1'),
      pool.query("SELECT COUNT(*) count FROM secure_documents WHERE deleted_at IS NULL AND scan_status IN ('UNAVAILABLE','PENDING_SCAN','QUARANTINED')"),
      pool.query("SELECT COUNT(*) count FROM backup_attestations WHERE status = 'VERIFIED' AND backup_completed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)"),
      pool.query('SELECT COUNT(*) count FROM security_alert_rules WHERE active = 1'),
      pool.query('SELECT COUNT(*) count FROM trusted_devices WHERE revoked_at IS NULL AND expires_at > NOW()')
    ]);
    const triggeredAlerts = await evaluateSecurityAlerts();
    return res.json({ generated_at: new Date().toISOString(), metrics: {
      active_api_tokens: Number(results[0][0][0].count), active_webhooks: Number(results[1][0][0].count),
      pending_exports: Number(results[2][0][0].count), legal_holds: Number(results[3][0][0].count),
      documents_requiring_scan_review: Number(results[4][0][0].count), verified_backups_7d: Number(results[5][0][0].count),
      active_alert_rules: Number(results[6][0][0].count), trusted_devices: Number(results[7][0][0].count), triggered_alerts: triggeredAlerts.length
    }, controls: {
      webhook_signing_configured: Buffer.byteLength(process.env.WEBHOOK_SIGNING_KEY || '') >= 32,
      malware_provider_configured: Boolean(process.env.MALWARE_SCANNER_PROVIDER),
      backup_provider_attested: process.env.BACKUP_STATUS_PROVIDER === 'configured',
      outbound_allowlist_configured: Boolean(process.env.OUTBOUND_ALLOWED_HOSTS)
    }, triggered_alerts: triggeredAlerts });
  } catch (error) { next(error); }
};

exports.listApiTokens = async (req, res, next) => {
  try {
    await schemas();
    const [tokens] = await pool.query(`SELECT t.id, t.token_name, t.token_prefix, t.scopes_json, t.expires_at, t.last_used_at,
      t.revoked_at, t.created_at, u.name AS user_name, u.email AS user_email
      FROM user_api_tokens t JOIN users u ON u.id = t.user_id ORDER BY t.created_at DESC LIMIT 100`);
    return res.json({ tokens });
  } catch (error) { next(error); }
};

exports.createApiToken = async (req, res, next) => {
  try {
    await schemas();
    const targetUserId = Number(req.body.user_id || req.user.id);
    const [[target]] = await pool.query('SELECT id, role, permissions, active, account_status FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1', [targetUserId]);
    if (!target || Number(target.active) !== 1 || String(target.account_status).toUpperCase() !== 'ACTIVE') return res.status(409).json({ message: 'API tokens require an active user' });
    if (String(target.role).toLowerCase() === 'super_admin' && !isSuperAdmin(req)) return res.status(403).json({ message: 'Only a super administrator can issue that token' });
    const name = text(req.body.name, 120);
    if (name.length < 3) return res.status(400).json({ message: 'A descriptive token name is required' });
    const result = await createApiToken({ user: target, name, scopes: req.body.scopes, expiresAt: req.body.expires_at, createdBy: req.user.id });
    await audit(req, 'API_TOKEN_CREATED', 'api_token', result.id, { target_user_id: target.id, token_prefix: result.token_prefix, scopes: result.scopes, expires_at: result.expires_at });
    return res.status(201).json({ ...result, notice: 'Copy this token now. It will never be displayed again.' });
  } catch (error) { return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'API token could not be created' }); }
};

exports.revokeApiToken = async (req, res, next) => {
  try {
    await schemas();
    const reason = text(req.body.reason, 500);
    if (reason.length < 5) return res.status(400).json({ message: 'A revocation reason is required' });
    const [result] = await pool.query("UPDATE user_api_tokens SET revoked_at = COALESCE(revoked_at, NOW()), revoked_reason = ? WHERE id = ?", [reason.slice(0, 100), req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ message: 'API token not found' });
    await audit(req, 'API_TOKEN_REVOKED', 'api_token', req.params.id, { reason });
    return res.json({ message: 'API token revoked.' });
  } catch (error) { next(error); }
};

exports.upsertWebhookSource = async (req, res, next) => {
  try {
    await schemas();
    const sourceKey = text(req.body.source_key, 80).toLowerCase();
    const displayName = text(req.body.display_name, 120);
    const events = jsonArray(req.body.allowed_events);
    if (!/^[a-z0-9][a-z0-9_-]{2,79}$/.test(sourceKey) || displayName.length < 3 || !events.length) return res.status(400).json({ message: 'Valid source key, name and allowed events are required' });
    await pool.query(`INSERT INTO webhook_sources (id, source_key, display_name, allowed_events_json, active, created_by)
      VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), allowed_events_json = VALUES(allowed_events_json), active = VALUES(active)`,
    [crypto.randomUUID(), sourceKey, displayName, JSON.stringify(events), req.body.active === false ? 0 : 1, req.user.id]);
    await audit(req, 'WEBHOOK_SOURCE_CHANGED', 'webhook_source', sourceKey, { display_name: displayName, allowed_events: events, active: req.body.active !== false });
    return res.json({ message: 'Webhook source policy saved.' });
  } catch (error) { next(error); }
};

exports.listWebhooks = async (req, res, next) => {
  try { await schemas(); const [sources] = await pool.query('SELECT source_key, display_name, allowed_events_json, active, created_at, updated_at FROM webhook_sources ORDER BY source_key'); return res.json({ sources }); }
  catch (error) { next(error); }
};

exports.saveRetentionPolicy = async (req, res, next) => {
  try {
    await schemas();
    const category = text(req.body.data_category, 80).toUpperCase();
    const days = Number(req.body.retention_days);
    const basis = text(req.body.legal_basis, 500);
    if (!RETENTION_CATEGORIES.has(category) || !Number.isInteger(days) || days < 30 || days > 3650 || basis.length < 10) return res.status(400).json({ message: 'Valid category, 30-3650 day period and legal basis are required' });
    await pool.query(`INSERT INTO data_retention_policies (id, data_category, retention_days, action, legal_basis, active, updated_by)
      VALUES (?, ?, ?, 'ARCHIVE', ?, ?, ?) ON DUPLICATE KEY UPDATE retention_days=VALUES(retention_days), legal_basis=VALUES(legal_basis), active=VALUES(active), updated_by=VALUES(updated_by)`,
    [crypto.randomUUID(), category, days, basis, req.body.active === false ? 0 : 1, req.user.id]);
    await audit(req, 'DATA_RETENTION_POLICY_CHANGED', 'retention_policy', category, { retention_days: days, action: 'ARCHIVE', legal_basis: basis, active: req.body.active !== false });
    return res.json({ message: 'Archive-only retention policy saved.' });
  } catch (error) { next(error); }
};

exports.previewRetention = async (req, res, next) => {
  try {
    await schemas();
    const category = text(req.params.category, 80).toUpperCase();
    const target = RETENTION_TABLES[category];
    if (!target) return res.status(404).json({ message: 'Retention category not found' });
    const [[policy]] = await pool.query('SELECT * FROM data_retention_policies WHERE data_category = ? AND active = 1 LIMIT 1', [category]);
    if (!policy) return res.status(409).json({ message: 'An active retention policy is required' });
    const [table, dateColumn] = target;
    const [[result]] = await pool.query(`SELECT COUNT(*) count FROM ${table} WHERE ${dateColumn} < DATE_SUB(NOW(), INTERVAL ? DAY)`, [Number(policy.retention_days)]);
    const runId = crypto.randomUUID();
    await pool.query('INSERT INTO retention_runs (id, policy_id, mode, eligible_records, requested_by, reason) VALUES (?, ?, ?, ?, ?, ?)', [runId, policy.id, 'PREVIEW', Number(result.count), req.user.id, text(req.body.reason, 500) || 'Retention preview']);
    await audit(req, 'DATA_RETENTION_PREVIEWED', 'retention_run', runId, { category, eligible_records: Number(result.count), archive_only: true });
    return res.json({ run_id: runId, category, eligible_records: Number(result.count), action: 'ARCHIVE', execution_enabled: false, notice: 'No records were deleted. Execution requires a separately reviewed archival adapter.' });
  } catch (error) { next(error); }
};

exports.createRetentionHold = async (req, res, next) => {
  try {
    await schemas(); const scopeType = text(req.body.scope_type, 40).toUpperCase(); const scopeId = text(req.body.scope_id, 120); const reason = text(req.body.reason, 500);
    if (!scopeType || !scopeId || reason.length < 10) return res.status(400).json({ message: 'Hold scope and detailed reason are required' });
    const id = crypto.randomUUID();
    await pool.query('INSERT INTO retention_holds (id, scope_type, scope_id, reason, created_by) VALUES (?, ?, ?, ?, ?)', [id, scopeType, scopeId, reason, req.user.id]);
    await audit(req, 'RETENTION_HOLD_CREATED', 'retention_hold', id, { scope_type: scopeType, scope_id: scopeId, reason });
    return res.status(201).json({ message: 'Retention hold created.', id });
  } catch (error) { next(error); }
};

exports.requestExport = async (req, res, next) => {
  try {
    await schemas(); const type = text(req.body.export_type, 60).toUpperCase(); const reason = text(req.body.reason, 500);
    if (!EXPORT_TYPES.has(type) || reason.length < 10) return res.status(400).json({ message: 'Valid export type and business reason are required' });
    const id = crypto.randomUUID(); const params = sanitizeAiValue(req.body.parameters || {});
    await pool.query(`INSERT INTO sensitive_export_requests (id, export_type, parameters_json, requested_by, reason, expires_at)
      VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))`, [id, type, JSON.stringify(params), req.user.id, reason]);
    await audit(req, 'SENSITIVE_EXPORT_REQUESTED', 'sensitive_export', id, { export_type: type, reason });
    return res.status(201).json({ message: 'Sensitive export requires approval from a different authorised user.', id, status: 'PENDING_APPROVAL' });
  } catch (error) { next(error); }
};

exports.listExports = async (req, res, next) => {
  try {
    await schemas();
    const [requests] = await pool.query(`SELECT e.id, e.export_type, e.reason, e.status, e.expires_at, e.approved_at, e.consumed_at, e.created_at,
      requester.name requested_by_name, approver.name approved_by_name
      FROM sensitive_export_requests e LEFT JOIN users requester ON requester.id=e.requested_by
      LEFT JOIN users approver ON approver.id=e.approved_by ORDER BY e.created_at DESC LIMIT 100`);
    return res.json({ requests });
  } catch (error) { next(error); }
};

exports.approveExport = async (req, res, next) => {
  try {
    await schemas(); const reason = text(req.body.reason, 500);
    const [[item]] = await pool.query('SELECT * FROM sensitive_export_requests WHERE id = ? LIMIT 1', [req.params.id]);
    if (!item) return res.status(404).json({ message: 'Export request not found' });
    if (Number(item.requested_by) === Number(req.user.id)) return res.status(403).json({ message: 'The initiator cannot approve their own export' });
    if (item.status !== 'PENDING_APPROVAL' || new Date(item.expires_at) <= new Date()) return res.status(409).json({ message: 'Export request is no longer approvable' });
    if (reason.length < 10 || req.body.confirmation !== 'APPROVE SENSITIVE EXPORT') return res.status(400).json({ message: 'Exact confirmation and approval reason are required' });
    await pool.query("UPDATE sensitive_export_requests SET status='APPROVED', approved_by=?, approved_at=NOW() WHERE id=? AND status='PENDING_APPROVAL'", [req.user.id, item.id]);
    await audit(req, 'SENSITIVE_EXPORT_APPROVED', 'sensitive_export', item.id, { export_type: item.export_type, requested_by: item.requested_by, reason });
    return res.json({ message: 'Sensitive export approved. The producing module must consume this approval once.', status: 'APPROVED' });
  } catch (error) { next(error); }
};

exports.upsertSecretInventory = async (req, res, next) => {
  try {
    await schemas(); const name = text(req.body.secret_name, 100).toUpperCase(); const purpose = text(req.body.purpose, 300); const version = text(req.body.key_version || 'v1', 30); const days = Number(req.body.rotate_after_days || 180);
    if (!/^[A-Z][A-Z0-9_]{2,99}$/.test(name) || purpose.length < 10 || !Number.isInteger(days) || days < 30 || days > 730) return res.status(400).json({ message: 'Valid secret metadata is required' });
    await pool.query(`INSERT INTO security_secret_inventory (secret_name, purpose, owner_role, key_version, rotated_at, rotate_after_days, last_verified_at, status, updated_by)
      VALUES (?, ?, ?, ?, NOW(), ?, NOW(), 'CURRENT', ?) ON DUPLICATE KEY UPDATE purpose=VALUES(purpose), key_version=VALUES(key_version), rotated_at=NOW(), rotate_after_days=VALUES(rotate_after_days), last_verified_at=NOW(), status='CURRENT', updated_by=VALUES(updated_by)`,
    [name, purpose, 'SUPER_ADMIN', version, days, req.user.id]);
    await audit(req, 'SECRET_ROTATION_RECORDED', 'secret_inventory', name, { purpose, key_version: version, rotate_after_days: days });
    return res.json({ message: 'Secret rotation metadata recorded. No secret value was stored.' });
  } catch (error) { next(error); }
};

exports.recordBackupAttestation = async (req, res, next) => {
  try {
    await schemas(); const provider = text(req.body.provider, 100); const reference = text(req.body.backup_reference, 180); const notes = text(req.body.notes, 1000); const completed = new Date(req.body.backup_completed_at);
    const restoreTested = req.body.restore_tested_at ? new Date(req.body.restore_tested_at) : null;
    const verified = req.body.status === 'VERIFIED';
    if (provider.length < 2 || reference.length < 5 || notes.length < 10 || !Number.isFinite(completed.getTime()) || completed > new Date()) return res.status(400).json({ message: 'Provider evidence, completion time and notes are required' });
    if (verified && (!restoreTested || !Number.isFinite(restoreTested.getTime()) || req.body.confirmation !== 'VERIFY BACKUP EVIDENCE')) return res.status(400).json({ message: 'Verified status requires a restore-test date and exact confirmation' });
    const id = crypto.randomUUID(); const evidenceHash = digest({ provider, reference, completed: completed.toISOString(), notes });
    await pool.query(`INSERT INTO backup_attestations (id, provider, backup_reference, backup_completed_at, restore_tested_at, evidence_sha256, status, attested_by, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, provider, reference, completed, restoreTested, evidenceHash, verified ? 'VERIFIED' : 'RECORDED', req.user.id, notes]);
    await audit(req, 'BACKUP_ATTESTATION_RECORDED', 'backup_attestation', id, { provider, backup_completed_at: completed.toISOString(), status: verified ? 'VERIFIED' : 'RECORDED', evidence_sha256: evidenceHash });
    return res.status(201).json({ message: 'Backup evidence recorded.', id, evidence_sha256: evidenceHash });
  } catch (error) { next(error); }
};

exports.quarantineDocument = async (req, res, next) => {
  try {
    await schemas(); const reason = text(req.body.reason, 500);
    if (reason.length < 10) return res.status(400).json({ message: 'A quarantine reason is required' });
    const [result] = await pool.query("UPDATE secure_documents SET scan_status='QUARANTINED' WHERE id=? AND deleted_at IS NULL", [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ message: 'Document not found' });
    await audit(req, 'DOCUMENT_QUARANTINED', 'secure_document', req.params.id, { reason });
    return res.json({ message: 'Document quarantined and downloads blocked.' });
  } catch (error) { next(error); }
};

exports.saveAlertRule = async (req, res, next) => {
  try {
    await schemas(); const key = text(req.body.rule_key, 100).toUpperCase(); const name = text(req.body.display_name, 160); const severity = text(req.body.severity, 20).toUpperCase(); const events = jsonArray(req.body.event_types); const threshold = Number(req.body.threshold_count); const windowMinutes = Number(req.body.window_minutes);
    if (!/^[A-Z0-9_]{3,100}$/.test(key) || name.length < 3 || !SEVERITIES.has(severity) || !events.length || !Number.isInteger(threshold) || threshold < 1 || threshold > 1000 || !Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 1440) return res.status(400).json({ message: 'Valid alert rule fields are required' });
    await pool.query(`INSERT INTO security_alert_rules (id, rule_key, display_name, severity, event_types_json, threshold_count, window_minutes, active, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), severity=VALUES(severity), event_types_json=VALUES(event_types_json), threshold_count=VALUES(threshold_count), window_minutes=VALUES(window_minutes), active=VALUES(active), updated_by=VALUES(updated_by)`,
    [crypto.randomUUID(), key, name, severity, JSON.stringify(events), threshold, windowMinutes, req.body.active === false ? 0 : 1, req.user.id]);
    await audit(req, 'SECURITY_ALERT_RULE_CHANGED', 'security_alert_rule', key, { severity, event_types: events, threshold_count: threshold, window_minutes: windowMinutes, active: req.body.active !== false });
    return res.json({ message: 'Security alert rule saved.' });
  } catch (error) { next(error); }
};

exports.listTrustedDevices = async (req, res, next) => {
  try { await schemas(); const [devices] = await pool.query(`SELECT d.id, d.device_label, d.user_agent, d.last_used_at, d.expires_at, d.revoked_at, d.created_at, u.name user_name, u.email user_email FROM trusted_devices d JOIN users u ON u.id=d.user_id ORDER BY d.created_at DESC LIMIT 100`); return res.json({ devices }); }
  catch (error) { next(error); }
};

exports.revokeTrustedDevice = async (req, res, next) => {
  try { await schemas(); const reason = text(req.body.reason, 500); if (reason.length < 5) return res.status(400).json({ message: 'A revocation reason is required' }); const [result] = await pool.query("UPDATE trusted_devices SET revoked_at=COALESCE(revoked_at,NOW()), revoke_reason=? WHERE id=?", [reason.slice(0,100), req.params.id]); if (!result.affectedRows) return res.status(404).json({ message: 'Trusted device not found' }); await audit(req, 'TRUSTED_DEVICE_REVOKED', 'trusted_device', req.params.id, { reason }); return res.json({ message: 'Trusted device revoked.' }); }
  catch (error) { next(error); }
};

exports.evaluateAiRequest = async (req, res) => {
  try { enforceAiAction(req.body.action); return res.json({ allowed: true, sanitized_payload: sanitizeAiValue(req.body.payload || {}) }); }
  catch (error) { return res.status(error.statusCode || 400).json({ allowed: false, message: error.message }); }
};

exports.createEvidenceSnapshot = async (req, res, next) => {
  try {
    await schemas(); const now = new Date(); const start = new Date(now.getTime() - Math.min(365, Math.max(1, Number(req.body.days || 30))) * 86400000);
    const [counts] = await Promise.all([
      pool.query('SELECT event_type, result, COUNT(*) count FROM security_events WHERE created_at BETWEEN ? AND ? GROUP BY event_type, result', [start, now]),
      pool.query('SELECT status, severity, COUNT(*) count FROM security_incidents WHERE opened_at BETWEEN ? AND ? GROUP BY status, severity', [start, now]),
      pool.query('SELECT action, COUNT(*) count FROM audit_logs WHERE created_at BETWEEN ? AND ? GROUP BY action ORDER BY count DESC LIMIT 50', [start, now]),
      pool.query('SELECT status, COUNT(*) count FROM sensitive_export_requests WHERE created_at BETWEEN ? AND ? GROUP BY status', [start, now])
    ]);
    const summary = { period: { start: start.toISOString(), end: now.toISOString() }, security_events: counts[0][0], incidents: counts[1][0], audit_actions: counts[2][0], sensitive_exports: counts[3][0], disclaimer: 'Evidence snapshot supports internal review only and is not a certification.' };
    const id = crypto.randomUUID(); const sha = digest(summary);
    await pool.query('INSERT INTO security_evidence_snapshots (id, evidence_type, period_start, period_end, summary_json, content_sha256, generated_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, 'OPERATIONAL_TRUST', start, now, JSON.stringify(summary), sha, req.user.id]);
    await audit(req, 'SECURITY_EVIDENCE_SNAPSHOT_CREATED', 'security_evidence', id, { content_sha256: sha, period: summary.period });
    return res.status(201).json({ id, content_sha256: sha, summary });
  } catch (error) { next(error); }
};

exports.catalog = async (req, res, next) => {
  try {
    await schemas();
    const [retention, secrets, backups, alerts] = await Promise.all([
      pool.query('SELECT data_category, retention_days, action, legal_basis, active, updated_at FROM data_retention_policies ORDER BY data_category'),
      pool.query('SELECT secret_name, purpose, owner_role, key_version, rotated_at, rotate_after_days, last_verified_at, status, updated_at FROM security_secret_inventory ORDER BY secret_name'),
      pool.query('SELECT id, provider, backup_reference, backup_completed_at, restore_tested_at, evidence_sha256, status, created_at FROM backup_attestations ORDER BY backup_completed_at DESC LIMIT 25'),
      pool.query('SELECT rule_key, display_name, severity, event_types_json, threshold_count, window_minutes, active, updated_at FROM security_alert_rules ORDER BY severity, rule_key')
    ]);
    return res.json({ retention: retention[0], secrets: secrets[0], backups: backups[0], alerts: alerts[0], permissions: [...effectivePermissions(req.user)].sort() });
  } catch (error) { next(error); }
};
