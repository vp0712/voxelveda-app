const { backgroundJobService } = require('./backgroundJobService');

async function processExpiredTrash() {
  // Restoration preserves historical records; automatic destructive retention is disabled.
  return { skipped: true, processed: 0, failed: 0, reason: 'Archive records remain recoverable' };
}

const scheduler = backgroundJobService.createScheduler({
  jobKey: 'trash_retention_purge',
  description: 'Purge expired Trash records that are not under retention hold',
  handler: processExpiredTrash,
  intervalMs: () => Math.max(60000, Number(process.env.TRASH_PURGE_INTERVAL_MS || 60 * 60 * 1000)),
  initialDelayMs: 15000,
  leaseMs: Number(process.env.TRASH_PURGE_LEASE_MS || 15 * 60 * 1000)
});

function purgeExpiredTrash(options = {}) {
  return scheduler.run(options);
}

function startTrashPurgeScheduler() {
  return scheduler.start();
}

function stopTrashPurgeScheduler() {
  scheduler.stop();
}

module.exports = { processExpiredTrash, purgeExpiredTrash, startTrashPurgeScheduler, stopTrashPurgeScheduler };
