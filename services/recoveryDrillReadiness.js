const DEFAULT_RPO_HOURS = 24;
const DEFAULT_RTO_HOURS = 4;

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function statusRank(status) {
  return { blocked: 3, action_required: 2, pending: 1, ready: 0 }[status] ?? 1;
}

function buildStep(id, title, purpose, status, detail, evidence = []) {
  return { id, title, purpose, status, detail, evidence };
}

function buildRecoveryDrillReadiness({ recovery = {}, env = process.env, now = new Date() } = {}) {
  const rpoHours = positiveNumber(env.RECOVERY_RPO_HOURS, DEFAULT_RPO_HOURS);
  const rtoHours = positiveNumber(env.RECOVERY_RTO_HOURS, DEFAULT_RTO_HOURS);
  const checks = Array.isArray(recovery.checks) ? recovery.checks : [];
  const providerConnected = Boolean(recovery.provider_connected);
  const providerReady = Boolean(recovery.ready);
  const backupCheck = checks.find((item) => item.id === 'backup_freshness');
  const restoreCheck = checks.find((item) => item.id === 'restore_verification');
  const restoreResult = checks.find((item) => item.id === 'restore_result');
  const backupReady = backupCheck?.status === 'ready';
  const restoreVerified = restoreCheck?.status === 'ready' && restoreResult?.status !== 'blocked';

  const steps = [
    buildStep(
      'protect_production',
      'Protect production before the drill',
      'Prevent a recovery test from touching live customer or finance data.',
      'ready',
      'Use a separate recovery service/database and separate credentials. Production restore remains intentionally unavailable from this screen.',
      ['Isolated recovery environment name', 'Recovery-only credentials', 'Production write protection confirmation']
    ),
    buildStep(
      'select_backup',
      'Select a verified backup',
      'Use evidence, not a filename or assumption, to choose the restore source.',
      providerConnected && backupReady ? 'ready' : 'action_required',
      providerConnected && backupReady
        ? 'A fresh successful backup is visible in connected telemetry.'
        : 'Connected telemetry does not yet prove a fresh successful backup. Do not start a formal recovery drill from unverified media.',
      ['Backup identifier', 'Successful backup timestamp', 'Provider status evidence']
    ),
    buildStep(
      'restore_isolated',
      'Restore into the isolated recovery environment',
      'Prove that the backup can actually be converted back into a usable database.',
      restoreVerified ? 'ready' : 'pending',
      restoreVerified
        ? 'A recent successful restore drill is present in recovery evidence.'
        : 'A controlled isolated restore still needs to be executed and evidenced.',
      ['Restore start time', 'Restore finish time', 'Restore job result', 'Recovered database identifier']
    ),
    buildStep(
      'validate_integrity',
      'Validate data integrity and application workflows',
      'A database that starts is not enough; critical records and workflows must be usable.',
      restoreVerified ? 'ready' : 'pending',
      restoreVerified
        ? 'Recent restore evidence is available; retain the integrity checklist with the drill evidence pack.'
        : 'After restore, validate authentication, finance reads, document metadata, latest transactions, critical counts, and audit history before calling the drill successful.',
      ['Critical row/count checks', 'Latest-record timestamp checks', 'Authentication smoke test', 'Finance read-only smoke test', 'Audit-log continuity check']
    ),
    buildStep(
      'measure_objectives',
      'Measure recovery objectives',
      'Compare actual recovery performance with the declared RPO and RTO targets.',
      restoreVerified ? 'ready' : 'pending',
      `Targets are RPO ≤ ${rpoHours}h and RTO ≤ ${rtoHours}h. These are targets, not claims of achieved performance until the drill records actual values.`,
      ['Actual data-loss window (RPO)', 'Actual restore duration (RTO)', 'Target comparison']
    ),
    buildStep(
      'close_drill',
      'Close the drill with evidence and actions',
      'Make recovery repeatable and auditable rather than a one-off technical exercise.',
      restoreVerified && providerReady ? 'ready' : 'pending',
      restoreVerified && providerReady
        ? 'Evidence supports a recent successful recovery test. Keep the evidence pack and remediate any observations before the next drill.'
        : 'Record pass/fail, findings, owners, due dates, and the next drill date. Do not enable the mandatory recovery gate until evidence is current and successful.',
      ['Drill decision', 'Findings and owners', 'Evidence-pack location', 'Next drill date']
    )
  ];

  const blockers = steps.filter((step) => statusRank(step.status) >= 2);
  const completed = steps.filter((step) => step.status === 'ready').length;
  const formalDrillReady = providerConnected && backupReady && blockers.length === 0;
  const assuranceVerified = providerReady && restoreVerified;

  let state = 'ready';
  if (!providerConnected || !backupReady) state = 'blocked';
  else if (!assuranceVerified) state = 'action_required';

  const plainLanguage = assuranceVerified
    ? 'Your connected evidence shows a recent usable backup and a recent successful restore test. Continue scheduled drills and keep the evidence current.'
    : providerConnected && backupReady
      ? 'You appear to have a fresh backup, but recoverability is not yet proven. The next important job is an isolated restore drill with integrity checks and timing evidence.'
      : 'You do not yet have enough evidence to rely on recovery. First prove a fresh successful backup through connected telemetry; then run an isolated restore drill.';

  return {
    state,
    generated_at: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
    objectives: {
      rpo_hours: rpoHours,
      rto_hours: rtoHours,
      note: 'Targets only. Actual achieved RPO/RTO must come from a completed drill.'
    },
    progress: {
      completed_steps: completed,
      total_steps: steps.length,
      percent: Math.round((completed / steps.length) * 100)
    },
    gates: {
      provider_connected: providerConnected,
      fresh_backup_verified: backupReady,
      recent_restore_verified: restoreVerified,
      formal_drill_ready: formalDrillReady,
      recovery_assurance_verified: assuranceVerified
    },
    plain_language: plainLanguage,
    steps,
    evidence_pack: [
      'Backup provider health and backup timestamp',
      'Backup identifier used for the drill',
      'Isolated recovery environment identifier',
      'Restore start/finish timestamps and result',
      'Integrity-validation checklist and results',
      'Actual RPO and RTO measurements',
      'Application smoke-test results',
      'Findings, owners, due dates and closure evidence',
      'Final drill decision and next scheduled drill date'
    ],
    safety: {
      production_restore_available: false,
      message: 'This center plans and verifies recovery drills. It never performs a production restore or moves production data automatically.'
    }
  };
}

module.exports = { buildRecoveryDrillReadiness };
