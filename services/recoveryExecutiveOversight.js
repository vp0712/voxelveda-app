function number(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function ageHours(date, nowMs) { if (!date) return 0; const ms = new Date(date).getTime(); return Number.isFinite(ms) ? Math.max(0, (nowMs - ms) / 3600000) : 0; }

const SLA_HOURS = Object.freeze({ URGENT: 24, HIGH: 72, MEDIUM: 168, LOW: 336 });
const WEIGHTS = Object.freeze({ URGENT: 25, HIGH: 15, MEDIUM: 7, LOW: 3 });

function classifyItem(row, now = new Date()) {
  const nowMs = now.getTime();
  const priority = String(row.priority || 'MEDIUM').toUpperCase();
  const closed = Boolean(row.closed_at) || String(row.status || '').toUpperCase() === 'CLOSED';
  const dueMs = row.due_at ? new Date(row.due_at).getTime() : NaN;
  const overdueHours = !closed && Number.isFinite(dueMs) && dueMs < nowMs ? (nowMs - dueMs) / 3600000 : 0;
  const age = ageHours(row.created_at, nowMs);
  const slaHours = SLA_HOURS[priority] || SLA_HOURS.MEDIUM;
  const slaBreached = !closed && age > slaHours;
  const ownerMissing = !closed && !String(row.owner_label || '').trim();
  let escalation = 'NORMAL';
  if (!closed && (priority === 'URGENT' || overdueHours >= 24 || slaBreached)) escalation = 'EXECUTIVE';
  else if (!closed && (priority === 'HIGH' || overdueHours > 0 || ownerMissing)) escalation = 'MANAGEMENT';
  return { priority, closed, age_hours: Number(age.toFixed(1)), sla_hours: slaHours, sla_breached: slaBreached, overdue_hours: Number(overdueHours.toFixed(1)), owner_missing: ownerMissing, escalation };
}

function buildExecutiveOversight({ remediationRows = [], drillRows = [], now = new Date() } = {}) {
  const enriched = remediationRows.map((row) => ({ ...row, oversight: classifyItem(row, now) }));
  const open = enriched.filter((x) => !x.oversight.closed);
  const breached = open.filter((x) => x.oversight.sla_breached);
  const overdue = open.filter((x) => x.oversight.overdue_hours > 0);
  const unassigned = open.filter((x) => x.oversight.owner_missing);
  const executive = open.filter((x) => x.oversight.escalation === 'EXECUTIVE');
  const management = open.filter((x) => x.oversight.escalation === 'MANAGEMENT');

  const recentDrills = drillRows.filter((row) => {
    const date = new Date(row.finalized_at || row.created_at || 0).getTime();
    return Number.isFinite(date) && now.getTime() - date <= 90 * 86400000;
  });
  const failedDrills = recentDrills.filter((row) => String(row.final_decision || '').toUpperCase().includes('FAIL'));
  const objectiveMisses = recentDrills.filter((row) => String(row.rpo_objective_status || '').toUpperCase() === 'MISSED' || String(row.rto_objective_status || '').toUpperCase() === 'MISSED');

  let rawRisk = 0;
  for (const item of open) rawRisk += WEIGHTS[item.oversight.priority] || 7;
  rawRisk += breached.length * 8 + overdue.length * 5 + unassigned.length * 4 + failedDrills.length * 10 + objectiveMisses.length * 8;
  const riskScore = Math.min(100, rawRisk);
  const riskLevel = riskScore >= 70 ? 'CRITICAL' : riskScore >= 40 ? 'HIGH' : riskScore >= 20 ? 'ELEVATED' : riskScore > 0 ? 'LOW' : 'CLEAR';

  const closed = enriched.filter((x) => x.oversight.closed);
  const closureHours = closed.map((x) => {
    const a = new Date(x.created_at || 0).getTime();
    const b = new Date(x.closed_at || 0).getTime();
    return Number.isFinite(a) && Number.isFinite(b) && b >= a ? (b - a) / 3600000 : null;
  }).filter((x) => x !== null);
  const mttr = closureHours.length ? closureHours.reduce((a, b) => a + b, 0) / closureHours.length : null;

  const actions = [];
  if (executive.length) actions.push(`${executive.length} recovery action(s) require executive attention now.`);
  if (breached.length) actions.push(`${breached.length} open remediation item(s) exceeded the internal SLA.`);
  if (unassigned.length) actions.push(`${unassigned.length} open item(s) have no accountable owner.`);
  if (failedDrills.length) actions.push(`${failedDrills.length} failed recovery drill(s) were recorded in the last 90 days.`);
  if (objectiveMisses.length) actions.push(`${objectiveMisses.length} drill(s) missed an RPO or RTO objective in the last 90 days.`);
  if (!actions.length) actions.push('No executive recovery exceptions are currently detected. Continue scheduled drills and evidence review.');

  return {
    generated_at: now.toISOString(),
    risk: { score: riskScore, level: riskLevel, explanation: 'Risk combines open remediation priority, SLA breaches, overdue/unassigned actions, failed drills and missed recovery objectives.' },
    summary: {
      open: open.length, executive_escalations: executive.length, management_escalations: management.length,
      sla_breaches: breached.length, overdue: overdue.length, unassigned: unassigned.length,
      closed: closed.length, mttr_hours: mttr === null ? null : number(mttr.toFixed(1)),
      drills_90d: recentDrills.length, failed_drills_90d: failedDrills.length, objective_misses_90d: objectiveMisses.length
    },
    sla_policy_hours: SLA_HOURS,
    actions,
    queue: open
      .sort((a, b) => (b.oversight.escalation === 'EXECUTIVE') - (a.oversight.escalation === 'EXECUTIVE') || b.oversight.overdue_hours - a.oversight.overdue_hours)
      .slice(0, 50)
      .map((row) => ({ id: row.id, title: row.title, priority: row.oversight.priority, status: row.status, owner_label: row.owner_label || null, due_at: row.due_at || null, ...row.oversight })),
    safety: { production_restore_available: false, message: 'Executive oversight is read-only governance. It cannot restore production or alter drill evidence.' }
  };
}

module.exports = { SLA_HOURS, classifyItem, buildExecutiveOversight };
