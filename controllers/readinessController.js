const { detailedReadiness, liveness, publicReadiness } = require('../services/runtimeState');
const { verifyBackupRestoreProvider } = require('../config/backupRestoreAssurance');

exports.health = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return res.status(200).json(liveness());
};

exports.ready = (req, res) => {
  const readiness = publicReadiness();
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return res.status(readiness.ready ? 200 : 503).json(readiness);
};

exports.details = (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  return res.json(detailedReadiness());
};

exports.recovery = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');

  const mandatory = String(process.env.BACKUP_ASSURANCE_REQUIRED || 'false').toLowerCase() === 'true';
  const nativeProviderClaim = String(process.env.BACKUP_STATUS_PROVIDER || 'unverified').trim().toLowerCase();
  const result = await verifyBackupRestoreProvider(process.env);
  const providerConnected = Boolean(String(process.env.BACKUP_STATUS_URL || '').trim());

  const guidance = [];
  if (!providerConnected) {
    guidance.push({
      id: 'railway_backup_schedule',
      status: 'action_required',
      title: 'Enable Railway volume backups',
      detail: 'Configure Daily + Weekly + Monthly backups on the MySQL volume in Railway > MySQL > Backups. This application cannot claim that schedule is enabled until provider evidence is connected.'
    });
    guidance.push({
      id: 'provider_telemetry',
      status: 'action_required',
      title: 'Connect backup evidence',
      detail: 'Connect BACKUP_STATUS_URL to trusted backup telemetry so Voxel Veda can verify the latest successful backup timestamp automatically.'
    });
  }
  if (!result.checks?.some((item) => item.id === 'restore_verification' && item.status === 'ready')) {
    guidance.push({
      id: 'restore_drill',
      status: 'action_required',
      title: 'Prove restore capability',
      detail: 'Restore a backup into an isolated recovery environment, validate critical data and application workflows, then publish the successful restore-test timestamp.'
    });
  }
  if (!mandatory) {
    guidance.push({
      id: 'mandatory_gate',
      status: 'pending',
      title: 'Enable fail-closed recovery gate last',
      detail: 'Set BACKUP_ASSURANCE_REQUIRED=true only after live backup evidence and a successful isolated restore drill are verified.'
    });
  }

  const effectiveState = providerConnected ? result.state : 'unverified';
  return res.json({
    state: effectiveState,
    ready: providerConnected && result.ready,
    mandatory,
    provider_connected: providerConnected,
    provider_claim: nativeProviderClaim,
    summary: providerConnected
      ? result.summary
      : 'Recovery protection is not yet evidence-backed. Do not treat backups as verified until Railway backup scheduling and restore evidence are connected.',
    thresholds: {
      backup_max_age_hours: Number(process.env.BACKUP_MAX_AGE_HOURS || 26),
      restore_test_max_age_days: Number(process.env.RESTORE_TEST_MAX_AGE_DAYS || 90)
    },
    checks: result.checks || [],
    guidance,
    checked_at: result.checked_at || new Date().toISOString()
  });
};
