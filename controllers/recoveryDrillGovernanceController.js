const pool = require('../config/db');

function parseJson(value, fallback = []) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function daysUntil(value, now = new Date()) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - now.getTime()) / 86400000);
}

function classify(row, now = new Date()) {
  const nextDays = daysUntil(row.next_drill_at, now);
  const evidence = parseJson(row.evidence_refs_json, []);
  const findings = parseJson(row.findings_json, []);
  const reasons = [];
  let severity = 'OK';

  if (row.final_decision === 'FAILED') { severity = 'CRITICAL'; reasons.push('Last finalized drill failed.'); }
  if (row.final_decision === 'PASS_OBJECTIVES_MISSED') { if (severity !== 'CRITICAL') severity = 'HIGH'; reasons.push('Restore passed but RPO/RTO objective was missed.'); }
  if (row.finalized_at && evidence.length < 2) { severity = 'CRITICAL'; reasons.push('Finalized drill has insufficient evidence references.'); }
  if (!row.finalized_at && row.created_at && (now - new Date(row.created_at)) > 7 * 86400000) { if (!['CRITICAL','HIGH'].includes(severity)) severity = 'MEDIUM'; reasons.push('Open drill has remained unfinished for more than 7 days.'); }
  if (nextDays !== null && nextDays < 0) { if (!['CRITICAL','HIGH'].includes(severity)) severity = 'HIGH'; reasons.push(`Next drill is overdue by ${Math.abs(nextDays)} day(s).`); }
  else if (nextDays !== null && nextDays <= 14) { if (severity === 'OK') severity = 'MEDIUM'; reasons.push(`Next drill is due in ${nextDays} day(s).`); }
  if (findings.length && row.finalized_at) { if (severity === 'OK') severity = 'LOW'; reasons.push(`${findings.length} finding(s) recorded for follow-up.`); }

  return {
    id: row.id,
    title: row.title,
    status: row.status,
    final_decision: row.final_decision || null,
    severity,
    reasons,
    next_drill_at: row.next_drill_at || null,
    days_until_next_drill: nextDays,
    finalized_at: row.finalized_at || null,
    actual_rpo_hours: row.actual_rpo_hours === null ? null : Number(row.actual_rpo_hours),
    actual_rto_hours: row.actual_rto_hours === null ? null : Number(row.actual_rto_hours),
    evidence_ref_count: evidence.length,
    finding_count: findings.length
  };
}

exports.status = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM recovery_drill_records ORDER BY created_at DESC LIMIT 100');
    const items = rows.map((row) => classify(row));
    const rank = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, OK: 1 };
    items.sort((a, b) => (rank[b.severity] - rank[a.severity]) || String(b.finalized_at || '').localeCompare(String(a.finalized_at || '')));
    const attention = items.filter((item) => item.severity !== 'OK');
    const highest = items[0]?.severity || 'OK';
    return res.json({
      state: highest === 'CRITICAL' ? 'CRITICAL' : highest === 'HIGH' ? 'ACTION_REQUIRED' : attention.length ? 'WATCH' : 'HEALTHY',
      summary: {
        total: items.length,
        critical: items.filter((x) => x.severity === 'CRITICAL').length,
        high: items.filter((x) => x.severity === 'HIGH').length,
        medium: items.filter((x) => x.severity === 'MEDIUM').length,
        low: items.filter((x) => x.severity === 'LOW').length,
        overdue: items.filter((x) => x.days_until_next_drill !== null && x.days_until_next_drill < 0).length,
        objective_misses: items.filter((x) => x.final_decision === 'PASS_OBJECTIVES_MISSED').length,
        failed_drills: items.filter((x) => x.final_decision === 'FAILED').length
      },
      attention,
      guidance: [
        'Critical and failed recovery drills require documented remediation before the next formal assurance claim.',
        'Objective misses are not treated as successful recovery performance even when the restore technically completed.',
        'Schedule the next isolated drill before the due date and retain evidence references with the finalized record.'
      ],
      provider_telemetry_verified_by_this_view: false,
      production_restore_available: false,
      checked_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Recovery drill governance status failed.', error);
    return res.status(500).json({ message: 'Recovery drill governance status is unavailable.', code: 'RECOVERY_DRILL_GOVERNANCE_FAILED' });
  }
};

exports._test = { classify, daysUntil };