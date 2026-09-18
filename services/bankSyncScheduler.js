const pool = require('../config/db');
const { scheduledSyncEnabled, selectedProvider } = require('./openBankingProviderService');
const { syncUserBanking } = require('./advancedBankingSyncService');

let timer = null;
let running = false;

async function tick() {
  if (running || !scheduledSyncEnabled()) return;
  running = true;
  try {
    const provider = selectedProvider() || 'BASIQ';
    const [due] = await pool.query(
      `SELECT bc.app_user_id, bc.provider_user_id, MIN(bc.next_sync_at) AS next_sync_at
       FROM bank_connections bc
       WHERE bc.provider=? AND bc.status='ACTIVE' AND bc.provider_user_id IS NOT NULL
         AND bc.archived_at IS NULL AND bc.disconnected_at IS NULL
         AND (bc.next_sync_at IS NULL OR bc.next_sync_at<=NOW())
       GROUP BY bc.app_user_id, bc.provider_user_id
       ORDER BY MIN(bc.next_sync_at) ASC LIMIT 10`, [provider]
    );
    for (const row of due) {
      try {
        await syncUserBanking({ appUserId: Number(row.app_user_id), providerUserId: row.provider_user_id, trigger: 'SCHEDULED', actor: Number(row.app_user_id) });
      } catch (error) {
        console.warn('Scheduled bank sync failed:', error.code || error.message);
      }
    }
  } catch (error) {
    // Startup/migration races are non-fatal. The next interval retries without weakening app readiness.
    console.warn('Bank sync scheduler tick skipped:', error.code || error.message);
  } finally { running = false; }
}

function startBankSyncScheduler() {
  if (timer || !scheduledSyncEnabled()) return { enabled: scheduledSyncEnabled(), started: Boolean(timer) };
  const intervalMs = Math.max(15 * 60 * 1000, Number(process.env.BANK_SYNC_SCHEDULER_INTERVAL_MS || 15 * 60 * 1000));
  const initial = setTimeout(() => tick().catch(() => {}), 60 * 1000);
  initial.unref?.();
  timer = setInterval(() => tick().catch(() => {}), intervalMs);
  timer.unref?.();
  console.log(`Bank sync scheduler enabled (${Math.round(intervalMs / 60000)} minute scan interval).`);
  return { enabled: true, started: true };
}

module.exports = { startBankSyncScheduler, tick };
