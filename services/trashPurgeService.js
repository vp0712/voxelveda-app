const pool = require('../config/db');
const { ensureTrashSchema } = require('./trashSchema');
const { permanentDeleteTrashItem, recordPurgeFailure } = require('./trashService');

let purgeTimer = null;
let purgeBusy = false;

async function purgeExpiredTrash() {
  if (purgeBusy) return { skipped: true, processed: 0, failed: 0 };
  purgeBusy = true;
  try {
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
  } finally {
    purgeBusy = false;
  }
}

function startTrashPurgeScheduler() {
  if (purgeTimer) return purgeTimer;
  const intervalMs = Math.max(60_000, Number(process.env.TRASH_PURGE_INTERVAL_MS || 60 * 60 * 1000));
  purgeTimer = setInterval(() => purgeExpiredTrash().catch((error) => console.error('Trash purge worker error:', error.message)), intervalMs);
  purgeTimer.unref();
  setTimeout(() => purgeExpiredTrash().catch((error) => console.error('Initial Trash purge failed:', error.message)), 15_000).unref();
  return purgeTimer;
}

function stopTrashPurgeScheduler() {
  if (!purgeTimer) return;
  clearInterval(purgeTimer);
  purgeTimer = null;
}

module.exports = { purgeExpiredTrash, startTrashPurgeScheduler, stopTrashPurgeScheduler };
