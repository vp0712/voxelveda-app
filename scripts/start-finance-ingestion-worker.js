'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { validateSecurityEnvironment } = require('../config/security');
const pool = require('../config/db');
const { verifyDatabaseConnection } = require('../services/databaseRuntimeService');
const { runMigrations } = require('../services/migrationRunner');
const { ensureFinanceSchema } = require('../services/financeSchema');
const { ensureSecurityOperationsSchema } = require('../services/securityOperationsSchema');
const { ensureOperationalTrustSchema } = require('../services/operationalTrustSchema');
const { objectStorageDocumentsEnabled } = require('../services/documentSecurityService');
const { backgroundJobService } = require('../services/backgroundJobService');
const {
  financeStatementQueueHealth,
  startFinanceStatementIngestionWorker,
  stopFinanceStatementIngestionWorker
} = require('../services/financeStatementIngestionWorker');

let heartbeat;
let closing = false;

async function bootstrap() {
  validateSecurityEnvironment();
  await verifyDatabaseConnection(pool);
  const migrations = await runMigrations({ pool });
  await ensureSecurityOperationsSchema();
  await ensureOperationalTrustSchema();
  await ensureFinanceSchema();
  if (process.env.NODE_ENV === 'production'
    && String(process.env.FINANCE_STATEMENT_DURABLE_STORAGE_REQUIRED || 'true').toLowerCase() !== 'false'
    && !objectStorageDocumentsEnabled()) {
    throw Object.assign(new Error('Private durable statement storage is required but unavailable.'), { code: 'FINANCE_DURABLE_STORAGE_REQUIRED' });
  }
  await backgroundJobService.initialize();
  if (!startFinanceStatementIngestionWorker()) throw Object.assign(new Error('Finance ingestion worker is disabled.'), { code: 'FINANCE_INGESTION_WORKER_DISABLED' });
  const health = await financeStatementQueueHealth();
  console.log(`Finance ingestion worker ready: schema=${migrations.schema_version || 'unknown'} queue=${health.queued_jobs || 0} worker=${health.worker_key}`);
  heartbeat = setInterval(async () => {
    try {
      const current = await financeStatementQueueHealth();
      console.log(`Finance ingestion worker heartbeat: queued=${current.queued_jobs || 0} active=${current.active_jobs || 0} failed=${current.failed_jobs || 0}`);
    } catch (error) { console.error(`Finance ingestion worker heartbeat failed: ${error.code || 'HEALTH_FAILED'}`); }
  }, Math.max(60000, Number(process.env.FINANCE_INGESTION_PROCESS_HEARTBEAT_MS || 300000)));
}

async function shutdown(signal, exitCode = 0) {
  if (closing) return;
  closing = true;
  console.log(`${signal} received. Stopping Finance ingestion worker.`);
  if (heartbeat) clearInterval(heartbeat);
  await stopFinanceStatementIngestionWorker().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(exitCode);
}

bootstrap().catch((error) => {
  console.error(`Finance ingestion worker startup failed: ${error.code || 'STARTUP_FAILED'}`);
  shutdown('STARTUP_FAILED', 1);
});
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
