const assert = require('assert');
const { assessBackupRestoreStatus, verifyBackupRestoreProvider } = require('../config/backupRestoreAssurance');

const NOW = new Date('2026-09-17T06:00:00.000Z');
const hoursAgo = (hours) => new Date(NOW.getTime() - hours * 3600000).toISOString();
const daysAgo = (days) => new Date(NOW.getTime() - days * 86400000).toISOString();

const healthy = assessBackupRestoreStatus({
  status: 'healthy',
  latest_backup_at: hoursAgo(2),
  latest_restore_test_at: daysAgo(14),
  latest_restore_test_result: 'success'
}, { now: NOW, backupMaxAgeHours: 26, restoreMaxAgeDays: 90 });
assert.equal(healthy.state, 'ready');
assert.equal(healthy.ready, true);

const staleBackup = assessBackupRestoreStatus({
  status: 'ok', latest_backup_at: hoursAgo(40), latest_restore_test_at: daysAgo(10), latest_restore_test_result: 'success'
}, { now: NOW, backupMaxAgeHours: 26, restoreMaxAgeDays: 90 });
assert.equal(staleBackup.state, 'blocked');
assert(staleBackup.checks.some((item) => item.id === 'backup_freshness' && item.status === 'blocked'));

const noRestore = assessBackupRestoreStatus({ status: 'ok', latest_backup_at: hoursAgo(3) }, { now: NOW });
assert.equal(noRestore.state, 'degraded');
assert(noRestore.checks.some((item) => item.id === 'restore_verification' && item.status === 'degraded'));

const staleRestore = assessBackupRestoreStatus({
  status: 'ok', latest_backup_at: hoursAgo(3), latest_restore_test_at: daysAgo(120), latest_restore_test_result: 'success'
}, { now: NOW });
assert.equal(staleRestore.state, 'degraded');

const failedRestore = assessBackupRestoreStatus({
  status: 'ok', latest_backup_at: hoursAgo(3), latest_restore_test_at: daysAgo(1), latest_restore_test_result: 'failed'
}, { now: NOW });
assert.equal(failedRestore.state, 'blocked');

const malformed = assessBackupRestoreStatus(null, { now: NOW });
assert.equal(malformed.state, 'blocked');

(async () => {
  const missingRequired = await verifyBackupRestoreProvider({ NODE_ENV: 'production', BACKUP_ASSURANCE_REQUIRED: 'true' }, { now: NOW });
  assert.equal(missingRequired.state, 'blocked');

  const insecure = await verifyBackupRestoreProvider({ NODE_ENV: 'production', BACKUP_ASSURANCE_REQUIRED: 'true', BACKUP_STATUS_URL: 'http://backup.local/status' }, { now: NOW });
  assert.equal(insecure.state, 'blocked');

  const unavailable = await verifyBackupRestoreProvider({ NODE_ENV: 'production', BACKUP_ASSURANCE_REQUIRED: 'true', BACKUP_STATUS_URL: 'https://backup.example/status' }, {
    now: NOW,
    fetch: async () => ({ ok: false, status: 503 })
  });
  assert.equal(unavailable.state, 'blocked');

  const badJson = await verifyBackupRestoreProvider({ NODE_ENV: 'production', BACKUP_ASSURANCE_REQUIRED: 'true', BACKUP_STATUS_URL: 'https://backup.example/status' }, {
    now: NOW,
    fetch: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } })
  });
  assert.equal(badJson.state, 'blocked');

  let capturedAuthorization = null;
  const providerHealthy = await verifyBackupRestoreProvider({
    NODE_ENV: 'production', BACKUP_ASSURANCE_REQUIRED: 'true', BACKUP_STATUS_URL: 'https://backup.example/status', BACKUP_STATUS_TOKEN: 'top-secret-token', BACKUP_MAX_AGE_HOURS: '26', RESTORE_TEST_MAX_AGE_DAYS: '90'
  }, {
    now: NOW,
    fetch: async (_url, options) => {
      capturedAuthorization = options.headers.authorization;
      return { ok: true, status: 200, json: async () => ({ status: 'ok', latest_backup_at: hoursAgo(1), latest_restore_test_at: daysAgo(7), latest_restore_test_result: 'success' }) };
    }
  });
  assert.equal(providerHealthy.state, 'ready');
  assert.equal(capturedAuthorization, 'Bearer top-secret-token');
  assert(!JSON.stringify(providerHealthy).includes('top-secret-token'));

  console.log('Backup and restore assurance tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
