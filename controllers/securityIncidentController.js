const crypto = require('crypto');
const pool = require('../config/db');
const { ensureSecurityOperationsSchema } = require('../services/securityOperationsSchema');
const { transitionAccount } = require('../services/userSecurityService');
const { issueToken } = require('../services/authActionTokenService');
const { queueSecurityLink } = require('../services/securityEmailService');
const { logSecurityEvent } = require('../services/sessionService');
const { logAudit } = require('../services/auditService');
const { buildSecurityReport, parsePeriod, persistSecurityReport } = require('../services/securityReportService');

const SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
const STATUSES = new Set(['OPEN', 'INVESTIGATING', 'CONTAINED', 'RESOLVED', 'CLOSED']);

function text(value, max) { return String(value || '').trim().slice(0, max); }
function isSuperAdmin(req) { return String(req.user?.role || '').toLowerCase() === 'super_admin'; }

async function getIncident(id, connection = pool) {
  const [[incident]] = await connection.query('SELECT * FROM security_incidents WHERE id = ? LIMIT 1', [id]);
  return incident || null;
}

async function assertTargetAuthority(req, userId) {
  const [[target]] = await pool.query('SELECT id, name, email, role, account_status FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1', [userId]);
  if (!target) throw Object.assign(new Error('Target user was not found'), { statusCode: 404 });
  if (String(target.role).toLowerCase() === 'super_admin' && !isSuperAdmin(req)) {
    throw Object.assign(new Error('Only a super administrator can contain or recover that account'), { statusCode: 403 });
  }
  if (Number(target.id) === Number(req.user.id)) {
    throw Object.assign(new Error('A different authorised administrator must handle your account incident'), { statusCode: 403 });
  }
  return target;
}

async function addIncidentAction({ incidentId, actionType, actorId, targetUserId, reason, result = 'SUCCESS', req, metadata, connection = pool }) {
  await connection.query(
    `INSERT INTO security_incident_actions
     (incident_id, action_type, actor_id, target_user_id, reason, result, request_id, ip_address, user_agent, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [incidentId, actionType, actorId, targetUserId || null, text(reason, 1000), result,
      req.requestId || null, req.ip || null, text(req.get?.('user-agent'), 255), metadata ? JSON.stringify(metadata) : null]
  );
}

exports.list = async (req, res, next) => {
  try {
    await ensureSecurityOperationsSchema();
    const status = text(req.query.status, 30).toUpperCase();
    const params = [];
    let where = '1=1';
    if (status && STATUSES.has(status)) { where += ' AND si.status = ?'; params.push(status); }
    const [incidents] = await pool.query(
      `SELECT si.id, si.title, si.severity, si.status, si.scope, si.summary, si.opened_at, si.updated_at,
              opener.name AS opened_by_name, commander.name AS commander_name,
              (SELECT COUNT(*) FROM security_incident_actions a WHERE a.incident_id = si.id) AS action_count
       FROM security_incidents si
       LEFT JOIN users opener ON opener.id = si.opened_by
       LEFT JOIN users commander ON commander.id = si.incident_commander_id
       WHERE ${where} ORDER BY FIELD(si.status, 'OPEN','INVESTIGATING','CONTAINED','RESOLVED','CLOSED'),
       FIELD(si.severity, 'CRITICAL','HIGH','MEDIUM','LOW'), si.opened_at DESC LIMIT 100`, params
    );
    return res.json({ incidents });
  } catch (error) { return next(error); }
};

exports.detail = async (req, res, next) => {
  try {
    await ensureSecurityOperationsSchema();
    const incident = await getIncident(req.params.id);
    if (!incident) return res.status(404).json({ message: 'Security incident not found' });
    const [actions] = await pool.query(
      `SELECT a.id, a.action_type, a.reason, a.result, a.created_at, a.target_user_id,
              actor.name AS actor_name, target.name AS target_name
       FROM security_incident_actions a LEFT JOIN users actor ON actor.id = a.actor_id
       LEFT JOIN users target ON target.id = a.target_user_id
       WHERE a.incident_id = ? ORDER BY a.id ASC`, [incident.id]
    );
    return res.json({ incident, actions });
  } catch (error) { return next(error); }
};

exports.create = async (req, res, next) => {
  try {
    await ensureSecurityOperationsSchema();
    const title = text(req.body.title, 180);
    const summary = text(req.body.summary, 2000);
    const severity = text(req.body.severity, 20).toUpperCase();
    const scope = text(req.body.scope || 'ACCOUNT', 40).toUpperCase();
    if (title.length < 5 || summary.length < 10 || !SEVERITIES.has(severity)) {
      return res.status(400).json({ message: 'Title, incident summary and valid severity are required' });
    }
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO security_incidents (id, title, severity, scope, summary, opened_by, incident_commander_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, title, severity, scope, summary, req.user.id, req.user.id]
    );
    await addIncidentAction({ incidentId: id, actionType: 'INCIDENT_OPENED', actorId: req.user.id, reason: summary, req, metadata: { severity, scope } });
    await logSecurityEvent({ actorId: req.user.id, eventType: 'SECURITY_INCIDENT_OPENED', req, metadata: { incident_id: id, severity, scope } });
    return res.status(201).json({ message: 'Security incident opened.', incident_id: id });
  } catch (error) { return next(error); }
};

exports.addNote = async (req, res, next) => {
  try {
    await ensureSecurityOperationsSchema();
    const reason = text(req.body.note, 1000);
    if (reason.length < 3) return res.status(400).json({ message: 'An incident note is required' });
    const incident = await getIncident(req.params.id);
    if (!incident) return res.status(404).json({ message: 'Security incident not found' });
    if (incident.status === 'CLOSED') return res.status(409).json({ message: 'Closed incidents are immutable' });
    await addIncidentAction({ incidentId: incident.id, actionType: 'NOTE_ADDED', actorId: req.user.id, reason, req });
    await pool.query("UPDATE security_incidents SET status = IF(status = 'OPEN', 'INVESTIGATING', status) WHERE id = ?", [incident.id]);
    return res.json({ message: 'Incident note added.' });
  } catch (error) { return next(error); }
};

exports.containUser = async (req, res, next) => {
  try {
    await ensureSecurityOperationsSchema();
    const incident = await getIncident(req.params.id);
    if (!incident) return res.status(404).json({ message: 'Security incident not found' });
    if (['RESOLVED', 'CLOSED'].includes(incident.status)) return res.status(409).json({ message: 'Reopen the incident before containment actions' });
    const targetUserId = Number(req.body.target_user_id);
    const reason = text(req.body.reason, 1000);
    if (!targetUserId || reason.length < 5) return res.status(400).json({ message: 'Target user and containment reason are required' });
    await assertTargetAuthority(req, targetUserId);
    await transitionAccount({ actorId: req.user.id, targetUserId, state: 'LOCKED', reason, req, compromised: true });
    await addIncidentAction({ incidentId: incident.id, actionType: 'ACCOUNT_CONTAINED', actorId: req.user.id, targetUserId, reason, req });
    await pool.query("UPDATE security_incidents SET status = 'CONTAINED', contained_at = COALESCE(contained_at, NOW()) WHERE id = ?", [incident.id]);
    await logSecurityEvent({ actorId: req.user.id, targetUserId, eventType: 'INCIDENT_ACCOUNT_CONTAINED', req, metadata: { incident_id: incident.id } });
    return res.json({ message: 'Account contained. Sessions, tokens, trusted devices, MFA and recovery codes were revoked.' });
  } catch (error) { return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Account containment failed' }); }
};

exports.prepareRecovery = async (req, res, next) => {
  try {
    await ensureSecurityOperationsSchema();
    const incident = await getIncident(req.params.id);
    if (!incident) return res.status(404).json({ message: 'Security incident not found' });
    const targetUserId = Number(req.body.target_user_id);
    const reason = text(req.body.reason, 1000);
    if (!targetUserId || reason.length < 5) return res.status(400).json({ message: 'Target user and recovery reason are required' });
    const target = await assertTargetAuthority(req, targetUserId);
    await transitionAccount({ actorId: req.user.id, targetUserId, state: 'PASSWORD_RESET_REQUIRED', reason, req });
    const token = await issueToken({ userId: targetUserId, type: 'PASSWORD_RESET', minutes: 30, createdBy: req.user.id });
    let delivered = true;
    try { await queueSecurityLink({ user: target, token, type: 'PASSWORD_RESET', createdBy: req.user.id }); }
    catch (error) { delivered = false; console.error('Incident recovery email delivery failed:', error.message); }
    await addIncidentAction({ incidentId: incident.id, actionType: 'RECOVERY_INITIATED', actorId: req.user.id, targetUserId, reason, result: delivered ? 'SUCCESS' : 'PARTIAL', req, metadata: { delivery_queued: delivered } });
    await logSecurityEvent({ actorId: req.user.id, targetUserId, eventType: 'INCIDENT_RECOVERY_INITIATED', result: delivered ? 'SUCCESS' : 'PARTIAL', req, metadata: { incident_id: incident.id } });
    return res.status(delivered ? 200 : 202).json({ message: delivered ? 'Controlled recovery link queued.' : 'Recovery state applied, but email delivery failed.', delivery_queued: delivered });
  } catch (error) { return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Recovery could not be initiated' }); }
};

exports.updateStatus = async (req, res, next) => {
  try {
    await ensureSecurityOperationsSchema();
    const status = text(req.body.status, 30).toUpperCase();
    const reason = text(req.body.reason, 1000);
    if (!['INVESTIGATING', 'CONTAINED', 'RESOLVED', 'CLOSED'].includes(status) || reason.length < 5) {
      return res.status(400).json({ message: 'Valid status and reason are required' });
    }
    const incident = await getIncident(req.params.id);
    if (!incident) return res.status(404).json({ message: 'Security incident not found' });
    if (incident.status === 'CLOSED') return res.status(409).json({ message: 'Closed incidents are immutable' });
    if (status === 'CLOSED' && incident.status !== 'RESOLVED') return res.status(409).json({ message: 'Resolve the incident before closing it' });
    await pool.query(
      `UPDATE security_incidents SET status = ?, resolved_at = CASE WHEN ? = 'RESOLVED' THEN NOW() ELSE resolved_at END,
       closed_at = CASE WHEN ? = 'CLOSED' THEN NOW() ELSE closed_at END WHERE id = ?`,
      [status, status, status, incident.id]
    );
    await addIncidentAction({ incidentId: incident.id, actionType: `STATUS_${status}`, actorId: req.user.id, reason, req, metadata: { previous_status: incident.status } });
    await logSecurityEvent({ actorId: req.user.id, eventType: 'SECURITY_INCIDENT_STATUS_CHANGED', req, metadata: { incident_id: incident.id, previous_status: incident.status, status } });
    return res.json({ message: `Incident changed to ${status}.`, status });
  } catch (error) { return next(error); }
};

exports.revokeOrganisationSessions = async (req, res, next) => {
  let connection;
  try {
    await ensureSecurityOperationsSchema();
    if (!isSuperAdmin(req)) return res.status(403).json({ message: 'Only a super administrator can revoke organisation sessions' });
    const incident = await getIncident(req.body.incident_id);
    const reason = text(req.body.reason, 1000);
    if (!incident || ['RESOLVED', 'CLOSED'].includes(incident.status)) return res.status(409).json({ message: 'An active security incident is required' });
    if (req.body.confirmation !== 'REVOKE ALL SESSIONS' || reason.length < 10) {
      return res.status(400).json({ message: 'Exact confirmation and emergency reason are required' });
    }
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [revoked] = await connection.query("UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, NOW()), revoke_reason = COALESCE(revoke_reason, 'ORGANISATION_SECURITY_EVENT') WHERE revoked_at IS NULL");
    await connection.query('UPDATE users SET session_version = session_version + 1 WHERE active = 1 AND deleted_at IS NULL');
    await addIncidentAction({ incidentId: incident.id, actionType: 'ORGANISATION_SESSIONS_REVOKED', actorId: req.user.id, reason, req, metadata: { sessions_revoked: revoked.affectedRows }, connection });
    await connection.query("UPDATE security_incidents SET status = 'CONTAINED', contained_at = COALESCE(contained_at, NOW()) WHERE id = ?", [incident.id]);
    await connection.commit();
    await logSecurityEvent({ actorId: req.user.id, eventType: 'ORGANISATION_SESSIONS_REVOKED', req, metadata: { incident_id: incident.id, sessions_revoked: revoked.affectedRows } });
    return res.json({ message: 'Every active organisation session was revoked.', sessions_revoked: revoked.affectedRows });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    return next(error);
  } finally { connection?.release(); }
};

exports.report = async (req, res, next) => {
  try {
    const period = parsePeriod(req.query);
    return res.json(await buildSecurityReport(period));
  } catch (error) { return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Security report could not be generated' }); }
};

function csvCell(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }

exports.exportReport = async (req, res, next) => {
  try {
    const period = parsePeriod(req.query);
    const report = await buildSecurityReport(period);
    const snapshot = await persistSecurityReport(report, req.user.id);
    const rows = [
      ['Section', 'Metric', 'Result'],
      ['Period', 'Start', report.period.start], ['Period', 'End', report.period.end],
      ['Identity', 'Privileged users', report.identity.privileged_users],
      ['Identity', 'Privileged MFA coverage', `${report.identity.privileged_mfa_coverage}%`],
      ['Sessions', 'Created', report.sessions.created], ['Sessions', 'Revoked', report.sessions.revoked],
      ['Risk', 'Failed logins', report.risk.failed_logins], ['Risk', 'High-risk actions', report.risk.high_risk_actions],
      ...report.incidents.map((item) => ['Incidents', `${item.severity}/${item.status}`, item.count]),
      ...report.security_events.map((item) => ['Security event', `${item.event_type}/${item.result}`, item.count]),
      ['Integrity', 'Snapshot SHA-256', snapshot.content_sha256], ['Notice', 'Disclaimer', report.disclaimer]
    ];
    await logAudit(pool, { actorId: req.user.id, action: 'SECURITY_REPORT_EXPORTED', module: 'security', recordType: 'security_report', recordId: snapshot.id, newValue: { period: report.period, content_sha256: snapshot.content_sha256 }, ipAddress: req.ip, userAgent: req.get('user-agent') });
    await logSecurityEvent({ actorId: req.user.id, eventType: 'SENSITIVE_EXPORT', req, metadata: { export_type: 'SECURITY_REPORT', report_id: snapshot.id } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Voxel-Veda-Security-Review-${report.period.end.slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.send(rows.map((row) => row.map(csvCell).join(',')).join('\n'));
  } catch (error) { return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Security report export failed' }); }
};

module.exports.addIncidentAction = addIncidentAction;
