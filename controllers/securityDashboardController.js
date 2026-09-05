const pool = require('../config/db');
const { ensureSecuritySchema } = require('../services/securitySchema');
const { ensureSecurityOperationsSchema } = require('../services/securityOperationsSchema');
const { ensureWorkforceSchema } = require('../services/workforceSchema');
const { redactSensitive } = require('../utils/securityRedaction');

const PRIVILEGED_ROLES = ['super_admin', 'admin', 'finance_admin', 'accountant', 'hr'];
const HIGH_RISK_EVENTS = ['ROLE_CHANGED', 'PERMISSION_CHANGED', 'USER_DISABLED', 'ACCOUNT_TERMINATED', 'BANK_DETAILS_CHANGED', 'PAYMENT_APPROVED', 'SENSITIVE_EXPORT', 'MFA_DISABLED', 'SECURITY_SETTING_CHANGED'];

async function ensureSchemas() {
  await Promise.all([ensureSecuritySchema(), ensureSecurityOperationsSchema(), ensureWorkforceSchema()]);
}

function safePage(query) {
  return { page: Math.max(1, Number.parseInt(query.page, 10) || 1), limit: Math.min(100, Math.max(10, Number.parseInt(query.limit, 10) || 25)) };
}

function issue(key, severity, title, detail, count = 1) {
  return { key, severity, title, detail, count };
}

async function collectIssues() {
  const issues = [];
  const placeholders = PRIVILEGED_ROLES.map(() => '?').join(',');
  const [[noMfa]] = await pool.query(
    `SELECT COUNT(*) AS count FROM users WHERE active = 1 AND deleted_at IS NULL AND LOWER(role) IN (${placeholders}) AND mfa_enabled = 0`,
    PRIVILEGED_ROLES
  );
  if (Number(noMfa.count)) issues.push(issue('privileged-without-mfa', 'CRITICAL', 'Privileged users without MFA', 'Mandatory MFA enrolment is incomplete.', Number(noMfa.count)));

  const [[stale]] = await pool.query(
    `SELECT COUNT(*) AS count FROM users WHERE active = 1 AND deleted_at IS NULL
     AND COALESCE(last_login_at, created_at) < DATE_SUB(NOW(), INTERVAL 90 DAY)`
  );
  if (Number(stale.count)) issues.push(issue('stale-active-accounts', 'MEDIUM', 'Stale accounts remain active', 'Review accounts with no activity for more than 90 days.', Number(stale.count)));

  const [[oldSessions]] = await pool.query(
    `SELECT COUNT(*) AS count FROM auth_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.revoked_at IS NULL AND s.expires_at > NOW() AND s.created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
     AND LOWER(u.role) IN (${placeholders})`, PRIVILEGED_ROLES
  );
  if (Number(oldSessions.count)) issues.push(issue('old-privileged-sessions', 'HIGH', 'Old privileged sessions', 'Revoke or review privileged sessions older than 24 hours.', Number(oldSessions.count)));

  const [[failed]] = await pool.query("SELECT COUNT(*) AS count FROM security_events WHERE event_type = 'LOGIN_FAILURE' AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)");
  if (Number(failed.count) >= 10) issues.push(issue('repeated-login-failures', 'HIGH', 'Repeated failed logins', 'Investigate the elevated failed-login volume in the last 24 hours.', Number(failed.count)));

  const [[unscanned]] = await pool.query("SELECT COUNT(*) AS count FROM secure_documents WHERE deleted_at IS NULL AND scan_status = 'UNAVAILABLE'");
  if (!process.env.MALWARE_SCANNER_PROVIDER || Number(unscanned.count)) {
    issues.push(issue('malware-scanner-unavailable', 'MEDIUM', 'Malware scanner not configured', 'Uploaded files are type-validated but are not malware-scanned.', Math.max(1, Number(unscanned.count))));
  }

  if (!process.env.ALLOWED_ORIGINS && !process.env.CORS_ORIGINS && !process.env.APP_ORIGIN) {
    issues.push(issue('cors-default-origins', 'LOW', 'Explicit production origins not configured', 'Set ALLOWED_ORIGINS so production trust boundaries are deployment-controlled.'));
  }
  return issues;
}

exports.dashboard = async (req, res, next) => {
  try {
    await ensureSchemas();
    const placeholders = PRIVILEGED_ROLES.map(() => '?').join(',');
    const [rows] = await Promise.all([
      pool.query("SELECT COUNT(*) AS count FROM users WHERE active = 1 AND deleted_at IS NULL AND account_status = 'ACTIVE'"),
      pool.query(`SELECT COUNT(*) AS count FROM users WHERE active = 1 AND deleted_at IS NULL AND LOWER(role) IN (${placeholders})`, PRIVILEGED_ROLES),
      pool.query('SELECT COUNT(*) AS total, SUM(mfa_enabled = 1) AS enabled FROM users WHERE active = 1 AND deleted_at IS NULL'),
      pool.query("SELECT COUNT(*) AS count FROM security_events WHERE event_type = 'LOGIN_FAILURE' AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)"),
      pool.query("SELECT COUNT(*) AS count FROM users WHERE account_status = 'LOCKED' OR locked_until > NOW()"),
      pool.query('SELECT COUNT(*) AS count FROM auth_sessions WHERE revoked_at IS NULL AND expires_at > NOW()'),
      pool.query('SELECT COUNT(*) AS count FROM users WHERE active = 1 AND deleted_at IS NULL AND COALESCE(last_login_at, created_at) < DATE_SUB(NOW(), INTERVAL 90 DAY)'),
      pool.query(`SELECT COUNT(*) AS count FROM security_events WHERE event_type IN (${HIGH_RISK_EVENTS.map(() => '?').join(',')}) AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`, HIGH_RISK_EVENTS)
    ]);
    const issues = await collectIssues();
    const deductions = { CRITICAL: 20, HIGH: 10, MEDIUM: 5, LOW: 2, INFO: 0 };
    const score = Math.max(0, 100 - issues.reduce((sum, item) => sum + deductions[item.severity] * Math.min(item.count, 3), 0));
    const mfa = rows[2][0][0];
    res.json({
      generated_at: new Date().toISOString(),
      metrics: {
        active_users: Number(rows[0][0][0].count), privileged_users: Number(rows[1][0][0].count),
        mfa_coverage: Number(mfa.total) ? Math.round((Number(mfa.enabled || 0) / Number(mfa.total)) * 100) : 100,
        failed_logins_24h: Number(rows[3][0][0].count), locked_accounts: Number(rows[4][0][0].count),
        active_sessions: Number(rows[5][0][0].count), stale_accounts: Number(rows[6][0][0].count),
        high_risk_actions_24h: Number(rows[7][0][0].count), open_issues: issues.length
      },
      readiness: { score, label: score >= 90 ? 'Strong' : score >= 75 ? 'Needs attention' : 'Action required', disclaimer: 'Operational readiness indicator only; not a security certification.' },
      issues: issues.slice(0, 8)
    });
  } catch (error) { next(error); }
};

exports.issues = async (req, res, next) => {
  try { await ensureSchemas(); res.json({ issues: await collectIssues() }); } catch (error) { next(error); }
};

exports.events = async (req, res, next) => {
  try {
    await ensureSchemas();
    const { page, limit } = safePage(req.query);
    const filters = ['1=1']; const params = [];
    if (req.query.event_type) { filters.push('se.event_type = ?'); params.push(String(req.query.event_type).slice(0, 80)); }
    if (req.query.result) { filters.push('se.result = ?'); params.push(String(req.query.result).slice(0, 20)); }
    const where = filters.join(' AND ');
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM security_events se WHERE ${where}`, params);
    const [events] = await pool.query(
      `SELECT se.id, se.event_type, se.result, se.request_id, se.ip_address, se.user_agent, se.metadata_json,
              se.created_at, a.name AS actor_name, t.name AS target_name
       FROM security_events se LEFT JOIN users a ON a.id = se.actor_id LEFT JOIN users t ON t.id = se.target_user_id
       WHERE ${where} ORDER BY se.id DESC LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit]
    );
    res.json({ events: events.map((row) => ({ ...row, metadata_json: redactSensitive(row.metadata_json) })), page, limit, total: Number(count.total) });
  } catch (error) { next(error); }
};

exports.audit = async (req, res, next) => {
  try {
    await ensureSchemas();
    const { page, limit } = safePage(req.query);
    const filters = ['1=1']; const params = [];
    if (req.query.module) { filters.push('al.module = ?'); params.push(String(req.query.module).slice(0, 80)); }
    if (req.query.action) { filters.push('al.action = ?'); params.push(String(req.query.action).slice(0, 120)); }
    const where = filters.join(' AND ');
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM audit_logs al WHERE ${where}`, params);
    const [logs] = await pool.query(
      `SELECT al.id, al.action, al.module, al.record_type, al.record_id, al.ip_address, al.created_at,
              u.name AS actor_name, u.email AS actor_email
       FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_id
       WHERE ${where} ORDER BY al.id DESC LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit]
    );
    res.json({ logs, page, limit, total: Number(count.total) });
  } catch (error) { next(error); }
};

exports.privileged = async (req, res, next) => {
  try {
    await ensureSchemas();
    const placeholders = PRIVILEGED_ROLES.map(() => '?').join(',');
    const [users] = await pool.query(
      `SELECT u.id, u.user_uuid, u.employee_number, u.name, u.email, u.role, u.department, u.account_status,
              u.mfa_enabled, u.last_login_at, u.last_security_review_at,
              (SELECT COUNT(*) FROM auth_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > NOW()) AS active_sessions
       FROM users u WHERE u.deleted_at IS NULL AND LOWER(u.role) IN (${placeholders}) ORDER BY FIELD(LOWER(u.role), ${placeholders}), u.name`,
      [...PRIVILEGED_ROLES, ...PRIVILEGED_ROLES]
    );
    res.json({ users });
  } catch (error) { next(error); }
};
