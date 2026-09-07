const pool = require('../config/db');
const { ensureOperationalTrustSchema } = require('./operationalTrustSchema');

function parseEvents(value) {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

async function evaluateSecurityAlerts() {
  await ensureOperationalTrustSchema();
  const [rules] = await pool.query('SELECT rule_key, display_name, severity, event_types_json, threshold_count, window_minutes FROM security_alert_rules WHERE active = 1');
  const findings = [];
  for (const rule of rules) {
    const events = parseEvents(rule.event_types_json).slice(0, 25);
    if (!events.length) continue;
    const [[row]] = await pool.query(
      `SELECT COUNT(*) count FROM security_events WHERE event_type IN (${events.map(() => '?').join(',')})
       AND created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
      [...events, Number(rule.window_minutes)]
    );
    const count = Number(row.count);
    if (count >= Number(rule.threshold_count)) findings.push({ rule_key: rule.rule_key, display_name: rule.display_name, severity: rule.severity, count, threshold: Number(rule.threshold_count), window_minutes: Number(rule.window_minutes) });
  }
  return findings;
}

module.exports = { evaluateSecurityAlerts, parseEvents };
