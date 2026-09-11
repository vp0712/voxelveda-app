const pool = require('../config/db');
const { ensureTrashSchema } = require('./trashSchema');
const { permanentDeleteTrashItem, recordPurgeFailure } = require('./trashService');
const { backgroundJobService } = require('./backgroundJobService');

async function processExpiredTrash() {
  await ensureTrashSchema();
  const batchSize = Math.min(250, Math.max(1, Number(process.env.TRASH_PURGE_BATCH_SIZE || 50)));
  const [items] = await pool.query(
    `SELECT id FROM trash_items
     WHERE restore_status = 'ACTIVE' AND retention_hold = 0 AND purge_at <= NOW()
     ORDER BY purge_at ASC LIMIT ?`,
    [batchSize]
  );
  let processed = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await permanentDeleteTrashItem(item.id, { system: true, reason: '15-day Trash retention expired' });
      processed += 1;
    } catch (error) {
      failed += 1;
      await recordPurgeFailure(item.id, error).catch(() => {});
      console.error(`Trash purge failed for item ${item.id}:`, error.message);
    }
  }
  return { skipped: false, processed, failed };
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
