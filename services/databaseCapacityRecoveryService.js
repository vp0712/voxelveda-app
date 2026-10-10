'use strict';

const crypto = require('node:crypto');
const pool = require('../config/db');
const { retainedEventScope } = require('./securityDataScope');

// Only the current email worker and reversible capacity probe are retained.
// Unknown and retired module job history remains archived in place.
const RETAINED_CAPACITY_JOB_KEYS = Object.freeze(['email_queue_delivery', 'capacity.probe']);
const RETAINED_EMAIL_MODULES = Object.freeze(['auth', 'security', 'contact']);

const CAPACITY_CODES = new Set(['ER_RECORD_FILE_FULL', 'ER_DISK_FULL']);

function isCapacityError(error) {
  const code = String(error?.code || '').toUpperCase();
  const errno = Number(error?.errno || 0);
  const message = String(error?.message || '').toLowerCase();
  return CAPACITY_CODES.has(code)
    || errno === 1114
    || message.includes('table is full')
    || message.includes('no space left on device');
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

async function tableExists(table) {
  const [[row]] = await pool.query(
    'SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?',
    [table]
  );
  return Number(row?.count || 0) > 0;
}

async function databaseFootprint() {
  const [[summary]] = await pool.query(
    `SELECT
       ROUND(COALESCE(SUM(data_length + index_length),0)/1024/1024,2) AS size_mb,
       ROUND(COALESCE(SUM(data_free),0)/1024/1024,2) AS data_free_mb
     FROM information_schema.tables
     WHERE table_schema=DATABASE()`
  );
  const [largest] = await pool.query(
    `SELECT table_name,
            ROUND((COALESCE(data_length,0)+COALESCE(index_length,0))/1024/1024,2) AS size_mb,
            table_rows
       FROM information_schema.tables
      WHERE table_schema=DATABASE()
      ORDER BY (COALESCE(data_length,0)+COALESCE(index_length,0)) DESC
      LIMIT 12`
  );
  return {
    size_mb: Number(summary?.size_mb || 0),
    data_free_mb: Number(summary?.data_free_mb || 0),
    largest: largest.map((row) => ({
      table: row.table_name,
      size_mb: Number(row.size_mb || 0),
      rows: Number(row.table_rows || 0)
    }))
  };
}

async function deleteBatches({ table, where, params = [], orderBy, maxRows = 10000 }) {
  if (!await tableExists(table)) return 0;
  const batchSize = boundedInteger(process.env.DB_CAPACITY_PRUNE_BATCH_SIZE, 1000, 100, 5000);
  const maxBatches = boundedInteger(process.env.DB_CAPACITY_PRUNE_MAX_BATCHES, 50, 1, 200);
  let deleted = 0;
  for (let batch = 0; batch < maxBatches && deleted < maxRows; batch += 1) {
    const limit = Math.min(batchSize, maxRows - deleted);
    const sql = `DELETE FROM \`${table}\` WHERE ${where}${orderBy ? ` ORDER BY ${orderBy}` : ''} LIMIT ${limit}`;
    const [result] = await pool.query(sql, params);
    const affected = Number(result?.affectedRows || 0);
    deleted += affected;
    if (affected < limit) break;
  }
  return deleted;
}

async function capacityProbe() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (await tableExists('security_events')) {
      await connection.query(
        "INSERT INTO security_events (event_type,result,metadata_json) VALUES ('DB_CAPACITY_PROBE','SUCCESS',JSON_OBJECT('temporary',true))"
      );
    }
    if (await tableExists('background_job_runs')) {
      await connection.query(
        `INSERT INTO background_job_runs
         (run_uuid,job_key,lease_token,started_at,completed_at,status,attempt,trigger_source)
         VALUES (?, 'capacity.probe', ?, NOW(3), NOW(3), 'COMPLETED', 1, 'STARTUP')`,
        [crypto.randomUUID(), crypto.randomUUID()]
      );
    }
    await connection.rollback();
    return { writable: true };
  } catch (error) {
    await connection.rollback().catch(() => {});
    return { writable: false, error };
  } finally {
    connection.release();
  }
}

async function normalRecovery() {
  const deleted = {};
  const jobScope = `job_key IN (${RETAINED_CAPACITY_JOB_KEYS.map(() => '?').join(',')})`;
  const emailScope = `related_module IN (${RETAINED_EMAIL_MODULES.map(() => '?').join(',')})`;
  const securityScope = retainedEventScope();
  deleted.background_job_runs = await deleteBatches({
    table: 'background_job_runs',
    where: `${jobScope} AND status IN ('COMPLETED','FAILED','RETRY') AND completed_at IS NOT NULL AND completed_at < DATE_SUB(NOW(3), INTERVAL 6 HOUR)`,
    params: RETAINED_CAPACITY_JOB_KEYS,
    orderBy: 'completed_at ASC',
    maxRows: 100000
  });
  deleted.background_job_failures = await deleteBatches({
    table: 'background_job_failures',
    where: `${jobScope} AND failed_at < DATE_SUB(NOW(3), INTERVAL 7 DAY)`,
    params: RETAINED_CAPACITY_JOB_KEYS,
    orderBy: 'failed_at ASC',
    maxRows: 50000
  });
  deleted.background_job_dead_letters = await deleteBatches({
    table: 'background_job_dead_letters',
    where: `${jobScope} AND status='RESOLVED' AND resolved_at IS NOT NULL AND resolved_at < DATE_SUB(NOW(3), INTERVAL 7 DAY)`,
    params: RETAINED_CAPACITY_JOB_KEYS,
    orderBy: 'resolved_at ASC',
    maxRows: 20000
  });
  deleted.security_step_up_required = await deleteBatches({
    table: 'security_events',
    where: `(${securityScope.sql}) AND event_type='STEP_UP_REQUIRED' AND created_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
    params: securityScope.params,
    orderBy: 'id ASC',
    maxRows: 100000
  });
  deleted.security_events = await deleteBatches({
    table: 'security_events',
    where: `(${securityScope.sql}) AND created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)`,
    params: securityScope.params,
    orderBy: 'id ASC',
    maxRows: 100000
  });
  deleted.email_logs = await deleteBatches({
    table: 'email_logs',
    where: `${emailScope} AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)`,
    params: RETAINED_EMAIL_MODULES,
    orderBy: 'id ASC',
    maxRows: 50000
  });
  deleted.email_queue_sent = await deleteBatches({
    table: 'email_queue',
    where: `${emailScope} AND status='SENT' AND sent_at IS NOT NULL AND sent_at < DATE_SUB(NOW(), INTERVAL 30 DAY)`,
    params: RETAINED_EMAIL_MODULES,
    orderBy: 'id ASC',
    maxRows: 50000
  });
  return deleted;
}

async function recoverDatabaseCapacity(options = {}) {
  const enabled = String(process.env.DB_CAPACITY_RECOVERY_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false')).toLowerCase() === 'true';
  if (!enabled && !options.force) return { skipped: true, reason: 'disabled' };

  const before = await databaseFootprint().catch(() => ({ size_mb: null, data_free_mb: null, largest: [] }));
  let deleted = {};
  let probe = await capacityProbe();

  try {
    deleted = await normalRecovery();
  } catch (error) {
    if (!isCapacityError(error)) throw error;
    console.warn(`DB_CAPACITY_NORMAL_PRUNE_BLOCKED code=${error.code || error.errno || 'UNKNOWN'}`);
  }

  probe = await capacityProbe();
  // Never truncate shared tables to manufacture successful startup. Capacity
  // failure after scoped retention must fail readiness and preserve archives.

  const after = await databaseFootprint().catch(() => ({ size_mb: null, data_free_mb: null, largest: [] }));
  const summary = {
    before_size_mb: before.size_mb,
    after_size_mb: after.size_mb,
    data_free_mb: after.data_free_mb,
    deleted,
    emergency_actions: [],
    writable: Boolean(probe.writable),
    top_tables: after.largest.slice(0, 8)
  };
  console.log('DB_CAPACITY_RECOVERY', JSON.stringify(summary));

  if (!probe.writable) {
    const error = new Error('Database remains unable to allocate new rows after safe capacity recovery.');
    error.code = isCapacityError(probe.error) ? 'DATABASE_CAPACITY_EXHAUSTED' : (probe.error?.code || 'DATABASE_WRITE_PROBE_FAILED');
    error.details = summary;
    throw error;
  }
  return summary;
}

module.exports = {
  databaseFootprint,
  isCapacityError,
  recoverDatabaseCapacity,
  _test: { boundedInteger, RETAINED_CAPACITY_JOB_KEYS, RETAINED_EMAIL_MODULES }
};
