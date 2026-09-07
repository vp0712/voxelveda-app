const crypto = require('crypto');
const pool = require('../config/db');
const { ensureSecurityOperationsSchema } = require('./securityOperationsSchema');

const PRIVILEGED_ROLES = ['super_admin', 'admin', 'finance_admin', 'accountant', 'hr'];

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parsePeriod(query = {}) {
  const end = query.end ? new Date(query.end) : new Date();
  const start = query.start ? new Date(query.start) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
    throw Object.assign(new Error('A valid report period is required'), { statusCode: 400 });
  }
  if (end.getTime() - start.getTime() > 366 * 24 * 60 * 60 * 1000) {
    throw Object.assign(new Error('Security reports are limited to 366 days'), { statusCode: 400 });
  }
  return { start, end };
}

async function buildSecurityReport(period) {
  await ensureSecurityOperationsSchema();
  const placeholders = PRIVILEGED_ROLES.map(() => '?').join(',');
  const params = [period.start, period.end];
  const [results] = await Promise.all([
    pool.query('SELECT event_type, result, COUNT(*) AS count FROM security_events WHERE created_at >= ? AND created_at < ? GROUP BY event_type, result ORDER BY count DESC', params),
    pool.query('SELECT action, module, COUNT(*) AS count FROM audit_logs WHERE created_at >= ? AND created_at < ? GROUP BY action, module ORDER BY count DESC LIMIT 50', params),
    pool.query(`SELECT COUNT(*) AS total, SUM(mfa_enabled = 1) AS mfa_enabled FROM users WHERE active = 1 AND deleted_at IS NULL AND LOWER(role) IN (${placeholders})`, PRIVILEGED_ROLES),
    pool.query("SELECT severity, status, COUNT(*) AS count FROM security_incidents WHERE opened_at < ? AND (closed_at IS NULL OR closed_at >= ?) GROUP BY severity, status", [period.end, period.start]),
    pool.query("SELECT COUNT(*) AS count FROM auth_sessions WHERE created_at >= ? AND created_at < ?", params),
    pool.query("SELECT COUNT(*) AS count FROM auth_sessions WHERE revoked_at >= ? AND revoked_at < ?", params),
    pool.query("SELECT COUNT(*) AS count FROM security_events WHERE event_type = 'LOGIN_FAILURE' AND created_at >= ? AND created_at < ?", params),
    pool.query("SELECT COUNT(*) AS count FROM security_events WHERE event_type IN ('ROLE_OR_PERMISSION_CHANGED','BANK_DETAILS_CHANGED','PAYMENT_APPROVED','SENSITIVE_EXPORT','ORGANISATION_SESSIONS_REVOKED') AND created_at >= ? AND created_at < ?", params)
  ]);
  const privileged = results[2][0][0];
  return {
    generated_at: new Date().toISOString(),
    period: { start: iso(period.start), end: iso(period.end) },
    identity: {
      privileged_users: Number(privileged.total || 0),
      privileged_mfa_coverage: Number(privileged.total) ? Math.round((Number(privileged.mfa_enabled || 0) / Number(privileged.total)) * 100) : 100
    },
    sessions: { created: Number(results[4][0][0].count || 0), revoked: Number(results[5][0][0].count || 0) },
    risk: { failed_logins: Number(results[6][0][0].count || 0), high_risk_actions: Number(results[7][0][0].count || 0) },
    incidents: results[3][0].map((row) => ({ severity: row.severity, status: row.status, count: Number(row.count) })),
    security_events: results[0][0].map((row) => ({ event_type: row.event_type, result: row.result, count: Number(row.count) })),
    audit_summary: results[1][0].map((row) => ({ action: row.action, module: row.module, count: Number(row.count) })),
    disclaimer: 'Operational security review data only; this report is not a certification or guarantee.'
  };
}

async function persistSecurityReport(report, actorId) {
  const id = crypto.randomUUID();
  const serialized = JSON.stringify(report);
  const hash = crypto.createHash('sha256').update(serialized).digest('hex');
  await pool.query(
    'INSERT INTO security_report_snapshots (id, period_start, period_end, generated_by, summary_json, content_sha256) VALUES (?, ?, ?, ?, ?, ?)',
    [id, new Date(report.period.start), new Date(report.period.end), actorId, serialized, hash]
  );
  return { id, content_sha256: hash };
}

module.exports = { buildSecurityReport, parsePeriod, persistSecurityReport };
