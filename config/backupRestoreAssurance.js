const DEFAULT_BACKUP_MAX_AGE_HOURS = 26;
const DEFAULT_RESTORE_MAX_AGE_DAYS = 90;
const DEFAULT_TIMEOUT_MS = 5000;

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hoursSince(date, now) {
  return (now.getTime() - date.getTime()) / 3600000;
}

function check(id, status, message, remediation = null, details = {}) {
  return { id, status, message, remediation, ...details };
}

function assessBackupRestoreStatus(payload, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const backupMaxAgeHours = positiveNumber(options.backupMaxAgeHours, DEFAULT_BACKUP_MAX_AGE_HOURS);
  const restoreMaxAgeDays = positiveNumber(options.restoreMaxAgeDays, DEFAULT_RESTORE_MAX_AGE_DAYS);
  const checks = [];

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      state: 'blocked', ready: false, summary: 'Backup provider returned an invalid payload.',
      checks: [check('provider_payload', 'blocked', 'Provider payload is missing or malformed.', 'Fix the backup status integration so it returns valid JSON telemetry.')]
    };
  }

  const providerStatus = String(payload.status || '').trim().toLowerCase();
  if (!['ok', 'healthy', 'ready'].includes(providerStatus)) {
    checks.push(check('provider_status', 'blocked', `Backup provider status is ${providerStatus || 'missing'}.`, 'Resolve the provider health issue before treating backups as recoverable.'));
  } else {
    checks.push(check('provider_status', 'ready', 'Backup provider reports healthy.'));
  }

  const backupAt = parseTimestamp(payload.latest_backup_at || payload.latestBackupAt);
  if (!backupAt) {
    checks.push(check('backup_freshness', 'blocked', 'No valid latest backup timestamp was supplied.', 'Verify scheduled backups and expose latest_backup_at from the provider.'));
  } else {
    const ageHours = hoursSince(backupAt, now);
    if (ageHours < -0.25) {
      checks.push(check('backup_freshness', 'blocked', 'Latest backup timestamp is in the future.', 'Correct provider clock/timestamp telemetry.', { observed_at: backupAt.toISOString() }));
    } else if (ageHours > backupMaxAgeHours) {
      checks.push(check('backup_freshness', 'blocked', `Latest successful backup is ${ageHours.toFixed(1)} hours old; limit is ${backupMaxAgeHours} hours.`, 'Run/repair the backup job and confirm a fresh successful backup.', { observed_at: backupAt.toISOString(), age_hours: Number(ageHours.toFixed(2)), max_age_hours: backupMaxAgeHours }));
    } else {
      checks.push(check('backup_freshness', 'ready', `Latest successful backup is ${ageHours.toFixed(1)} hours old.`, null, { observed_at: backupAt.toISOString(), age_hours: Number(ageHours.toFixed(2)), max_age_hours: backupMaxAgeHours }));
    }
  }

  const restoreAt = parseTimestamp(payload.latest_restore_test_at || payload.latestRestoreTestAt);
  if (!restoreAt) {
    checks.push(check('restore_verification', 'degraded', 'No valid restore-drill timestamp was supplied.', 'Perform a controlled restore test and publish latest_restore_test_at telemetry.'));
  } else {
    const ageDays = hoursSince(restoreAt, now) / 24;
    if (ageDays < -0.02) {
      checks.push(check('restore_verification', 'blocked', 'Latest restore-test timestamp is in the future.', 'Correct provider clock/timestamp telemetry.', { observed_at: restoreAt.toISOString() }));
    } else if (ageDays > restoreMaxAgeDays) {
      checks.push(check('restore_verification', 'degraded', `Latest verified restore drill is ${ageDays.toFixed(1)} days old; limit is ${restoreMaxAgeDays} days.`, 'Run a restore drill against an isolated environment and record the result.', { observed_at: restoreAt.toISOString(), age_days: Number(ageDays.toFixed(2)), max_age_days: restoreMaxAgeDays }));
    } else {
      checks.push(check('restore_verification', 'ready', `Latest verified restore drill is ${ageDays.toFixed(1)} days old.`, null, { observed_at: restoreAt.toISOString(), age_days: Number(ageDays.toFixed(2)), max_age_days: restoreMaxAgeDays }));
    }
  }

  if (payload.latest_restore_test_result && String(payload.latest_restore_test_result).toLowerCase() !== 'success') {
    checks.push(check('restore_result', 'blocked', `Latest restore drill result is ${payload.latest_restore_test_result}.`, 'Investigate the failed restore and repeat the drill until successful.'));
  }

  const state = checks.some((item) => item.status === 'blocked') ? 'blocked' : checks.some((item) => item.status === 'degraded') ? 'degraded' : 'ready';
  return {
    state,
    ready: state === 'ready',
    summary: state === 'ready' ? 'Backups are fresh and restore capability is recently verified.' : state === 'degraded' ? 'Backups are available, but recovery assurance needs attention.' : 'Recovery readiness is blocked; do not claim verified recoverability.',
    checked_at: now.toISOString(),
    checks
  };
}

async function verifyBackupRestoreProvider(env = process.env, dependencies = {}) {
  const production = env.NODE_ENV === 'production';
  const required = String(env.BACKUP_ASSURANCE_REQUIRED || 'false').toLowerCase() === 'true';
  const url = String(env.BACKUP_STATUS_URL || '').trim();
  const timeoutMs = positiveNumber(env.BACKUP_STATUS_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const backupMaxAgeHours = positiveNumber(env.BACKUP_MAX_AGE_HOURS, DEFAULT_BACKUP_MAX_AGE_HOURS);
  const restoreMaxAgeDays = positiveNumber(env.RESTORE_TEST_MAX_AGE_DAYS, DEFAULT_RESTORE_MAX_AGE_DAYS);
  const fetchImpl = dependencies.fetch || global.fetch;

  if (!url) {
    const state = production && required ? 'blocked' : 'degraded';
    return { state, ready: false, summary: 'Backup assurance provider is not configured.', checks: [check('provider_configuration', state, 'BACKUP_STATUS_URL is not configured.', 'Connect Railway/provider backup telemetry before enabling mandatory assurance.')] };
  }

  let parsedUrl;
  try { parsedUrl = new URL(url); } catch {
    return { state: 'blocked', ready: false, summary: 'Backup assurance provider URL is invalid.', checks: [check('provider_configuration', 'blocked', 'BACKUP_STATUS_URL is not a valid URL.', 'Set a valid HTTPS provider URL.')] };
  }
  if (production && parsedUrl.protocol !== 'https:') {
    return { state: 'blocked', ready: false, summary: 'Backup assurance provider transport is insecure.', checks: [check('provider_transport', 'blocked', 'Production backup telemetry must use HTTPS.', 'Use an HTTPS endpoint with valid TLS.')] };
  }
  if (typeof fetchImpl !== 'function') {
    return { state: 'blocked', ready: false, summary: 'No HTTP client is available for backup assurance.', checks: [check('provider_client', 'blocked', 'Fetch implementation is unavailable.', 'Use a supported Node runtime or provide an HTTP client.')] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { accept: 'application/json' };
    const token = String(env.BACKUP_STATUS_TOKEN || '').trim();
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
    if (!response || !response.ok) {
      return { state: 'blocked', ready: false, summary: 'Backup assurance provider is unavailable.', checks: [check('provider_reachability', 'blocked', `Backup provider returned HTTP ${response?.status || 'unknown'}.`, 'Restore provider connectivity/credentials and retry.')] };
    }
    let payload;
    try { payload = await response.json(); } catch {
      return { state: 'blocked', ready: false, summary: 'Backup provider returned malformed JSON.', checks: [check('provider_payload', 'blocked', 'Provider response could not be parsed as JSON.', 'Fix the provider response contract.')] };
    }
    return assessBackupRestoreStatus(payload, { backupMaxAgeHours, restoreMaxAgeDays, now: dependencies.now });
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return { state: 'blocked', ready: false, summary: timedOut ? 'Backup assurance provider timed out.' : 'Backup assurance provider could not be reached.', checks: [check('provider_reachability', 'blocked', timedOut ? `Provider exceeded ${timeoutMs} ms timeout.` : 'Provider request failed.', timedOut ? 'Investigate provider/network latency or adjust the timeout with evidence.' : 'Check provider availability, DNS, TLS and credentials.')] };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { assessBackupRestoreStatus, verifyBackupRestoreProvider, parseTimestamp };
